//! 终止信号取消（ADR-0041）：构建位于独立进程组，终端 Ctrl+C 只送达 runner
//! 所在的进程组；runner 必须把它转成取消请求，回收整棵构建进程树并输出
//! Cancelled 结果，而不是自己死掉、留下孤儿构建。
#![cfg(unix)]

use std::collections::BTreeMap;
use std::io::Read;
use std::os::unix::fs::PermissionsExt;
use std::os::unix::process::CommandExt;
use std::path::Path;
use std::process::{Child, Command, Stdio};
use std::thread;
use std::time::{Duration, Instant};

use one_publish_runner::{
    current_runtime_revision, prepare_from_projection, RunnerProjection, TriggerContext,
    TriggerInput, RUNNER_PROJECTION_VERSION,
};
use publish_domain::{
    AdapterBinding, AdapterIdentity, AdapterKind, AdapterSelection, AdapterSettings,
    AutomationTriggerPolicy, DeliveryRoute, PlanNodePlatform, PublishAttemptStatus,
};
use publish_runner_core::{platform_segment_name, reduce_publish_events, ShardOutcome};
use serde_json::Value;

const BUILD_PID_ENV: &str = "ONE_PUBLISH_TEST_BUILD_PID";
/// 假构建驱动：记录组长 PID 后替换为待测构建。前台 sleep 响应 SIGINT；
/// 非交互 sh 的后台 sleep 忽略 SIGINT，只能被强制终止。
const FAKE_DRIVER: &str = "#!/bin/sh\n\
echo $$ > \"$ONE_PUBLISH_TEST_BUILD_PID\"\n\
exec sh -c 'sleep 30 & sleep 30; wait'\n";

/// 验收：构建运行中向 runner 进程组发送 SIGINT（等同终端 Ctrl+C），runner 在
/// 10 秒内以 130 退出，构建的子进程与孙进程无一存活，输出的段归约为 Cancelled。
#[test]
fn sigint_cancels_the_running_build_and_prints_a_cancelled_outcome() {
    let checkout = fixture_checkout();
    let work = tempfile::tempdir().expect("create runner work directory");
    let driver_dir = work.path().join("bin");
    std::fs::create_dir(&driver_dir).expect("create fake driver directory");
    let driver = driver_dir.join("pnpm");
    std::fs::write(&driver, FAKE_DRIVER).expect("write fake pnpm driver");
    std::fs::set_permissions(&driver, std::fs::Permissions::from_mode(0o755))
        .expect("make fake pnpm driver executable");

    let attempt = prepare_from_projection(
        &fixture_projection(),
        &TriggerContext {
            repository_root: checkout.path().to_path_buf(),
            trigger: TriggerInput::Tag("v1.0.0".to_string()),
        },
    )
    .expect("plan the fixture attempt on site");
    let attempt_path = work.path().join("prepared-attempt.json");
    std::fs::write(
        &attempt_path,
        serde_json::to_vec(&attempt).expect("serialize prepared attempt"),
    )
    .expect("write prepared attempt");
    let pid_file = work.path().join("build.pid");
    let path = format!(
        "{}:{}",
        driver_dir.display(),
        std::env::var("PATH").unwrap_or_default()
    );

    let mut runner = Command::new(env!("CARGO_BIN_EXE_one-publish-runner"))
        .arg("execute")
        .arg(&attempt_path)
        .arg("attempt-signal-cancel")
        .arg(platform_segment_name(PlanNodePlatform::host()))
        .current_dir(checkout.path())
        .env("PATH", path)
        .env(BUILD_PID_ENV, &pid_file)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        // 独立进程组模拟终端前台作业：整组 SIGINT 不会波及测试进程本身。
        .process_group(0)
        .spawn()
        .expect("start the runner");

    let leader = wait_for_pid_file(&pid_file, &mut runner);
    let descendants = wait_for_children(leader, 2);
    signal_group(runner.id(), libc::SIGINT);
    let signalled = Instant::now();

    let status = wait_with_deadline(&mut runner, leader, Duration::from_secs(10));
    assert!(signalled.elapsed() < Duration::from_secs(10));
    let stdout = read_pipe(runner.stdout.take());
    let stderr = read_pipe(runner.stderr.take());
    assert_eq!(
        status.code(),
        Some(128 + libc::SIGINT),
        "runner must exit with 128+SIGINT after a cancelled run: {}",
        String::from_utf8_lossy(&stderr)
    );

    let segment: ShardOutcome = serde_json::from_slice(&stdout).unwrap_or_else(|error| {
        panic!(
            "runner must print a decodable segment ({error}): {}",
            String::from_utf8_lossy(&stdout)
        )
    });
    let projection = reduce_publish_events(&segment.events, &attempt.prepared.plan.routes)
        .expect("reduce the printed segment");
    assert_eq!(projection.status, PublishAttemptStatus::Cancelled);
    assert!(!segment
        .events
        .iter()
        .any(|event| event.kind == "plan_node_failed"));
    for pid in std::iter::once(leader).chain(descendants) {
        assert_process_gone(pid);
    }
}

fn fixture_checkout() -> tempfile::TempDir {
    let checkout = tempfile::tempdir().expect("create fixture checkout");
    let root = checkout.path();
    std::fs::create_dir(root.join("src-tauri")).expect("create src-tauri");
    std::fs::write(
        root.join("src-tauri/tauri.conf.json"),
        r#"{"productName":"signal-fixture","version":"1.0.0","identifier":"com.example.signal"}"#,
    )
    .expect("write tauri config");
    std::fs::write(
        root.join("package.json"),
        r#"{"name":"signal-fixture","private":true,"packageManager":"pnpm@9.0.0"}"#,
    )
    .expect("write package.json");
    for args in [
        &["init", "--quiet", "-b", "main"][..],
        &["config", "user.name", "One Publish Tests"],
        &["config", "user.email", "tests@one-publish.invalid"],
        &["add", "--all"],
        &["commit", "--quiet", "-m", "fixture"],
    ] {
        let output = Command::new("git")
            .arg("-C")
            .arg(root)
            .args(args)
            .output()
            .expect("run git fixture command");
        assert!(
            output.status.success(),
            "git {args:?} failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }
    checkout
}

fn fixture_projection() -> RunnerProjection {
    let adapters = AdapterSelection {
        project_provider: AdapterBinding::new(
            "project",
            AdapterIdentity::new(
                AdapterKind::ProjectProvider,
                publish_adapters::TAURI_PROVIDER_ID,
                1,
            ),
            AdapterSettings::new(1)
                .with_value(
                    "config_path",
                    Value::String("src-tauri/tauri.conf.json".to_string()),
                )
                .with_value("build_driver", Value::String("pnpm".to_string())),
        ),
        artifact_processors: vec![AdapterBinding::new(
            "checksums",
            AdapterIdentity::new(
                AdapterKind::ArtifactProcessor,
                publish_adapters::CHECKSUM_PROCESSOR_ID,
                1,
            ),
            AdapterSettings::new(1),
        )],
        execution_backend: AdapterBinding::new(
            "backend",
            AdapterIdentity::new(
                AdapterKind::ExecutionBackend,
                publish_adapters::GITHUB_ACTIONS_BACKEND_ID,
                1,
            ),
            AdapterSettings::new(1),
        ),
        artifact_store: AdapterBinding::new(
            "store",
            AdapterIdentity::new(AdapterKind::ArtifactStore, "temporary-artifact-store", 1),
            AdapterSettings::new(1),
        ),
        delivery_routes: vec![DeliveryRoute::required(AdapterBinding::new(
            "local-delivery",
            AdapterIdentity::new(
                AdapterKind::DeliveryDestination,
                publish_adapters::LOCAL_DESTINATION_ID,
                1,
            ),
            AdapterSettings::new(1),
        ))],
    };
    let runtime_revision = current_runtime_revision(
        adapters
            .ordered_bindings()
            .into_iter()
            .map(|binding| binding.adapter.clone()),
    )
    .expect("seal fixture runtime revision");
    RunnerProjection {
        version: RUNNER_PROJECTION_VERSION,
        binding_id: "binding-signal".to_string(),
        configuration_id: "configuration-1".to_string(),
        configuration_revision_id: "configuration-revision-1".to_string(),
        trigger_policy: AutomationTriggerPolicy::TagPush {
            tag_prefix: "v".to_string(),
        },
        runtime_revision,
        release_input: BTreeMap::new(),
        adapters,
        secret_bindings: BTreeMap::new(),
    }
}

fn signal_group(leader: u32, signal: libc::c_int) {
    let group = libc::pid_t::try_from(leader).expect("process id fits pid_t");
    assert!(group > 0);
    // SAFETY: 只向测试自己创建的进程组投递信号。
    unsafe {
        libc::killpg(group, signal);
    }
}

/// 等待 runner 退出；超时则强制回收 runner 与构建两个进程组再失败。
fn wait_with_deadline(
    runner: &mut Child,
    build_leader: u32,
    deadline: Duration,
) -> std::process::ExitStatus {
    let started = Instant::now();
    loop {
        if let Some(status) = runner.try_wait().expect("poll the runner") {
            return status;
        }
        if started.elapsed() >= deadline {
            signal_group(runner.id(), libc::SIGKILL);
            signal_group(build_leader, libc::SIGKILL);
            let _ = runner.wait();
            panic!("runner did not exit within {deadline:?} after SIGINT");
        }
        thread::sleep(Duration::from_millis(50));
    }
}

fn read_pipe(pipe: Option<impl Read>) -> Vec<u8> {
    let mut content = Vec::new();
    pipe.expect("piped runner stream")
        .read_to_end(&mut content)
        .expect("read runner stream");
    content
}

fn wait_for_pid_file(path: &Path, runner: &mut Child) -> u32 {
    for _ in 0..200 {
        if let Some(pid) = std::fs::read_to_string(path)
            .ok()
            .and_then(|contents| contents.trim().parse().ok())
        {
            return pid;
        }
        if let Some(status) = runner.try_wait().expect("poll the runner") {
            panic!(
                "runner exited with {status} before the build started: {}",
                String::from_utf8_lossy(&read_pipe(runner.stderr.take()))
            );
        }
        thread::sleep(Duration::from_millis(50));
    }
    panic!("build did not start");
}

/// 轮询直到 `parent` 派生出至少 `count` 个直接子进程，返回其 PID。
fn wait_for_children(parent: u32, count: usize) -> Vec<u32> {
    for _ in 0..100 {
        let output = Command::new("ps")
            .args(["-A", "-o", "pid=,ppid="])
            .output()
            .expect("list processes");
        let children = String::from_utf8_lossy(&output.stdout)
            .lines()
            .filter_map(|line| {
                let mut fields = line.split_whitespace();
                let pid = fields.next()?.parse::<u32>().ok()?;
                let ppid = fields.next()?.parse::<u32>().ok()?;
                (ppid == parent).then_some(pid)
            })
            .collect::<Vec<_>>();
        if children.len() >= count {
            return children;
        }
        thread::sleep(Duration::from_millis(50));
    }
    panic!("build {parent} did not start {count} children");
}

/// 进程已退出（不存在或仅剩待回收的僵尸）；给信号投递留出短暂余量。
fn assert_process_gone(pid: u32) {
    for _ in 0..20 {
        let output = Command::new("ps")
            .args(["-o", "stat=", "-p", &pid.to_string()])
            .output()
            .expect("inspect process");
        let state = String::from_utf8_lossy(&output.stdout);
        if state.trim().is_empty() || state.trim_start().starts_with('Z') {
            return;
        }
        thread::sleep(Duration::from_millis(100));
    }
    panic!("process {pid} survived runner cancellation");
}
