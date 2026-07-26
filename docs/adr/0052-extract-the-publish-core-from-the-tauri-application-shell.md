# Extract the publish core from the Tauri application shell

Before adding Electron or Wails, One Publish moves domain contracts, deterministic planning, runner execution, and built-in adapter registration into independent Rust workspace modules plus a standalone runner CLI. The Tauri desktop crate remains the local control-plane shell for state, configuration UI, automation reconciliation, and thin commands rather than the home of provider-specific release orchestration.
