use std::fs;
use std::process::ExitCode;

use one_publish_runner::{
    installed_runner, prepare_from_projection, verify_installed_projection, PreparedAttempt,
    RunnerProjection, TriggerContext, TriggerInput,
};

fn main() -> ExitCode {
    match run() {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("one-publish-runner: {error}");
            ExitCode::FAILURE
        }
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
            match platform.as_deref() {
                None => {
                    let outcome = installed_runner(&attempt)?.execute(&attempt, &attempt_id)?;
                    println!("{}", serde_json::to_string(&outcome)?);
                }
                Some(platform) => {
                    let platform = parse_platform(platform)?;
                    let segment =
                        installed_runner(&attempt)?.execute_shard(&attempt, &attempt_id, platform)?;
                    println!("{}", serde_json::to_string(&segment)?);
                }
            }
        }
        _ => return Err(format!("unsupported command {command}").into()),
    }
    Ok(())
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
