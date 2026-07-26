# Compose publish plans through capabilities

Project providers, artifact processors, execution backends, artifact stores, and delivery destinations declare standardized requirements and capabilities rather than referencing one another by type. A plan composer validates those declarations against the shared artifact contract and reports missing capabilities, preventing a growing matrix of Tauri-to-GitHub, Electron-to-SFTP, or Wails-to-storage special cases.
