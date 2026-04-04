use std::ffi::OsStr;
use std::process::Command as StdCommand;

use tokio::process::Command as TokioCommand;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[cfg(windows)]
fn apply_windows_background_mode(command: &mut StdCommand) {
    command.creation_flags(CREATE_NO_WINDOW);
}

#[cfg(not(windows))]
fn apply_windows_background_mode(_command: &mut StdCommand) {}

pub fn new_std_command(program: impl AsRef<OsStr>) -> StdCommand {
    let mut command = StdCommand::new(program);
    apply_windows_background_mode(&mut command);
    command
}

pub fn new_tokio_command(program: impl AsRef<OsStr>) -> TokioCommand {
    let mut command = TokioCommand::new(program);
    apply_windows_background_mode(command.as_std_mut());
    command
}
