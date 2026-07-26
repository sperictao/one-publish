# Process artifacts between build and delivery

Signing, notarization, checksums, SBOMs, attestations, and framework update metadata are implemented as registered Artifact Processor adapters between provider build output and delivery. Processors consume and derive declared artifact roles through a manifest candidate that is sealed before delivery, allowing platform and generic processing to be reused across Tauri, Electron, Wails, and multiple delivery destinations without gaining upload responsibility.
