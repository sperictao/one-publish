# Start with built-in publish adapters

One Publish first exposes internal registered adapter interfaces for project providers, artifact processors, execution backends, artifact stores, and delivery destinations, with Tauri, Electron, Wails, signing, local execution and storage, GitHub Actions, GitHub Release, and file-server delivery implemented in process. External plugin loading is deferred until a real extension ecosystem justifies a versioned ABI, permission isolation, signing, and crash containment.
