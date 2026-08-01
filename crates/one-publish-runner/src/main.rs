use std::fs;
use std::process::ExitCode;

use one_publish_runner::{
    installed_runner, verify_installed_projection, PreparedAttempt, RunnerProjection,
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
    let command = args
        .next()
        .ok_or("usage: one-publish-runner <verify|execute> <path> [attempt-id]")?;
    let path = args.next().ok_or("projection path is required")?;

    match command.as_str() {
        "verify" => {
            if args.next().is_some() {
                return Err("verify accepts no additional arguments".into());
            }
            let projection: RunnerProjection = serde_json::from_slice(&fs::read(path)?)?;
            verify_installed_projection(&projection)?;
        }
        "execute" => {
            let attempt_id = args.next().ok_or("execute requires an attempt id")?;
            if args.next().is_some() {
                return Err("execute accepts exactly one attempt id".into());
            }
            let attempt: PreparedAttempt = serde_json::from_slice(&fs::read(path)?)?;
            let outcome = installed_runner(&attempt)?.execute(&attempt, &attempt_id)?;
            println!("{}", serde_json::to_string(&outcome)?);
        }
        _ => return Err(format!("unsupported command {command}").into()),
    }
    Ok(())
}
