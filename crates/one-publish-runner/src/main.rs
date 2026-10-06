use std::fs;
use std::process::ExitCode;

use one_publish_runner::{
    installed_runner, prepare_from_projection, verify_installed_projection, PreparedAttempt,
    RunnerProjection, TriggerContext, TriggerInput,
};
use publish_adapters::CancellationSignal;

fn main() -> ExitCode {
    let result = run();
    if let Err(error) = &result {
        eprintln!("one-publish-runner: {error}");
    }
    // 被终止信号取消的运行按 shell 惯例以 128+信号值退出：已输出的 Cancelled
    // 结果是证据，退出状态让调用方（set -e、&& 链）停止后续步骤。
    #[cfg(unix)]
    if let Some(signal) = termination::received() {
        return ExitCode::from(128 + signal);
    }
    match result {
        Ok(()) => ExitCode::SUCCESS,
        Err(_) => ExitCode::FAILURE,
    }
}

fn run() -> Result<(), Box<dyn std::error::Error>> {
    let mut args = std::env::args().skip(1);
    let command = args.next().ok_or(
        "usage: one-publish-runner <verify|prepare-from-projection|execute> <path> [arguments]",
    )?;
    let path = args.next().ok_or("projection path is required")?;

    match command.as_str() {
        "verify" => {
            if args.next().is_some() {
                return Err("verify accepts no additional arguments".into());
            }
            let projection: RunnerProjection = serde_json::from_slice(&fs::read(path)?)?;
            verify_installed_projection(&projection)?;
        }
        "prepare-from-projection" => {
            let repository_root = args
                .next()
                .ok_or("prepare-from-projection requires the checkout root")?;
            let trigger = args.next().ok_or(
                "prepare-from-projection requires a trigger descriptor (tag:<tag> or version:<version>)",
            )?;
            if args.next().is_some() {
                return Err(
                    "prepare-from-projection accepts a checkout root and a trigger descriptor"
                        .into(),
                );
            }
            let projection: RunnerProjection = serde_json::from_slice(&fs::read(path)?)?;
            let attempt = prepare_from_projection(
                &projection,
                &TriggerContext {
                    repository_root: repository_root.into(),
                    trigger: parse_trigger(&trigger)?,
                },
            )?;
            println!("{}", serde_json::to_string(&attempt)?);
        }
        "execute" => {
            let attempt_id = args.next().ok_or("execute requires an attempt id")?;
            let platform = args.next();
            if args.next().is_some() {
                return Err(
                    "execute accepts an attempt id and an optional platform affinity".into(),
                );
            }
            let attempt: PreparedAttempt = serde_json::from_slice(&fs::read(path)?)?;
            let runner = installed_runner(&attempt)?.with_cancellation(cancel_on_termination());
            match platform.as_deref() {
                None => {
                    let outcome = runner.execute(&attempt, &attempt_id)?;
                    println!("{}", serde_json::to_string(&outcome)?);
                }
                Some(platform) => {
                    let platform = parse_platform(platform)?;
                    let staging_root =
                        std::path::Path::new(one_publish_runner::SHARD_STAGING_DIRECTORY);
                    // 产物交接（决议 #85）：汇聚段导入 build 段暂存的候选，
                    // build 段把本段候选落盘供外壳上传；段 JSON 只含证据。
                    let staged = if platform == publish_domain::PlanNodePlatform::Any {
                        one_publish_runner::load_staged_artifacts(staging_root)?
                    } else {
                        Vec::new()
                    };
                    let segment = runner.execute_shard(&attempt, &attempt_id, platform, staged)?;
                    if platform != publish_domain::PlanNodePlatform::Any {
                        one_publish_runner::stage_shard_artifacts(
                            staging_root,
                            publish_runner_core::platform_segment_name(platform),
                            &segment.artifacts,
                        )?;
                    }
                    println!("{}", serde_json::to_string(&segment)?);
                }
            }
        }
        _ => return Err(format!("unsupported command {command}").into()),
    }
    Ok(())
}

/// 执行命令把 SIGINT/SIGTERM 转成取消请求；其余命令保持缺省信号处置。
#[cfg(unix)]
fn cancel_on_termination() -> CancellationSignal {
    termination::install()
}

/// Windows 不隔离构建进程树，控制台 Ctrl+C 直接送达构建本身。
#[cfg(not(unix))]
fn cancel_on_termination() -> CancellationSignal {
    CancellationSignal::new()
}

/// 终止信号 → 取消请求（ADR-0041）。构建运行在独立进程组，终端 Ctrl+C 或整组
/// SIGINT 只送达 runner；runner 把它转成取消，由执行端口中断并回收整棵构建
/// 进程树（SIGINT，宽限期后 SIGKILL），再输出 Cancelled 结果。
///
/// 第二个终止信号恢复缺省动作，runner 立即退出：此时构建只收到过 SIGINT，
/// 忽略 SIGINT 的后代可能残留——这是使用者显式要求的强制退出。GitHub Actions
/// 取消先发 SIGINT、7.5 s 后才发 SIGTERM，构建宽限期
/// （`process_tree::TERMINATION_GRACE`）必须短于该窗口，强制回收才不会被抢先。
#[cfg(unix)]
mod termination {
    use std::sync::atomic::{AtomicI32, Ordering};
    use std::sync::OnceLock;

    use publish_adapters::CancellationSignal;

    const SIGNALS: [libc::c_int; 2] = [libc::SIGINT, libc::SIGTERM];

    static CANCELLATION: OnceLock<CancellationSignal> = OnceLock::new();
    static RECEIVED: AtomicI32 = AtomicI32::new(0);

    pub fn install() -> CancellationSignal {
        // 先初始化信号再挂处理器：处理器只读取已就位的 OnceLock。
        let cancellation = CANCELLATION.get_or_init(CancellationSignal::new).clone();
        for signal in SIGNALS {
            set_disposition(
                signal,
                request_cancellation as extern "C" fn(libc::c_int) as libc::sighandler_t,
            );
        }
        cancellation
    }

    /// 首个终止信号的编号；未收到时为 `None`。
    pub fn received() -> Option<u8> {
        u8::try_from(RECEIVED.load(Ordering::SeqCst))
            .ok()
            .filter(|signal| *signal != 0)
    }

    /// 只做原子写与处置复位，二者都异步信号安全：不分配、不加锁、不做 I/O。
    extern "C" fn request_cancellation(signal: libc::c_int) {
        let _ = RECEIVED.compare_exchange(0, signal, Ordering::SeqCst, Ordering::SeqCst);
        if let Some(cancellation) = CANCELLATION.get() {
            cancellation.request();
        }
        for each in SIGNALS {
            set_disposition(each, libc::SIG_DFL);
        }
    }

    fn set_disposition(signal: libc::c_int, handler: libc::sighandler_t) {
        // SAFETY: 以完整初始化的 sigaction 结构安装处置；sigemptyset 与
        // sigaction 都在 POSIX 异步信号安全函数之列，可在处理器内调用。
        unsafe {
            let mut action: libc::sigaction = std::mem::zeroed();
            action.sa_sigaction = handler;
            libc::sigemptyset(&mut action.sa_mask);
            action.sa_flags = libc::SA_RESTART;
            libc::sigaction(signal, &action, std::ptr::null_mut());
        }
    }
}

/// 触发描述符（决议 #89）：tag 推送外壳传 `tag:<完整 tag>`，手动 dispatch
/// 外壳传 `version:<显式版本>`；形态与安装投影的触发策略在规划时互验。
fn parse_trigger(value: &str) -> Result<TriggerInput, Box<dyn std::error::Error>> {
    if let Some(tag) = value.strip_prefix("tag:") {
        return Ok(TriggerInput::Tag(tag.to_string()));
    }
    if let Some(version) = value.strip_prefix("version:") {
        return Ok(TriggerInput::Manual {
            version: version.to_string(),
        });
    }
    Err(format!("unsupported trigger descriptor {value}").into())
}

/// 分片亲和参数（决议 #85）：matrix job 传本平台族，汇聚 job 传 any。
fn parse_platform(
    value: &str,
) -> Result<publish_domain::PlanNodePlatform, Box<dyn std::error::Error>> {
    use publish_domain::PlanNodePlatform;
    Ok(match value {
        "any" => PlanNodePlatform::Any,
        "linux" => PlanNodePlatform::Linux,
        "macos" => PlanNodePlatform::Macos,
        "windows" => PlanNodePlatform::Windows,
        other => return Err(format!("unsupported platform affinity {other}").into()),
    })
}
