use std::fs;
use std::process::ExitCode;

use one_publish_runner::{
    installed_runner, prepare_from_projection, verify_installed_projection, PreparedAttempt,
    RunnerProjection, TriggerContext,
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
            let tag = args.next();
            if args.next().is_some() {
                return Err(
                    "prepare-from-projection accepts a checkout root and an optional tag".into(),
                );
            }
            let projection: RunnerProjection = serde_json::from_slice(&fs::read(path)?)?;
            let attempt = prepare_from_projection(
                &projection,
                &TriggerContext {
                    repository_root: repository_root.into(),
                    tag,
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
                    let events =
                        installed_runner(&attempt)?.execute_shard(&attempt, &attempt_id, platform)?;
                    println!("{}", serde_json::to_string(&events)?);
                }
            }
        }
        _ => return Err(format!("unsupported command {command}").into()),
    }
    Ok(())
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
