use std::process::{Command, Stdio};

/// `dconf read` 的超时上限：无会话总线/容器环境下 dconf 会阻塞在连接上，
/// 无界等待会让窗口设置在启动路径上永久挂起。超限即降级为"无 dconf 配置"。
const DCONF_READ_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(5);

fn render_stdout(stdout: &[u8]) -> String {
    String::from_utf8_lossy(stdout)
        .to_string()
        .replace('\'', "")
        .replace('"', "")
        .replace('\n', "")
}

pub fn read(path: &str) -> Result<String, ()> {
    // 本地 patch：spawn + 有界 try_wait 取代无界 output()——dconf 读出的值
    // 很小（单个 gsettings 键），管道缓冲区不会成为瓶颈，不需要 drain 线程。
    let mut child = Command::new("dconf")
        .args(["read", path])
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|_| ())?;

    let deadline = std::time::Instant::now() + DCONF_READ_TIMEOUT;
    loop {
        match child.try_wait() {
            Ok(Some(_)) => {
                let output = child.wait_with_output().map_err(|_| ())?;
                return Ok(render_stdout(&output.stdout));
            }
            Ok(None) if std::time::Instant::now() < deadline => {
                std::thread::sleep(std::time::Duration::from_millis(25));
            }
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(());
            }
        }
    }
}
