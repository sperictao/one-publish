# Keep installed automation independent of the desktop control plane

One Publish acts as the control plane for configuration, planning, installation, and observation, while installed remote automation contains a fixed non-secret plan revision and resolves credentials from its own backend. Automation runs without the desktop app or local state being available, and the control plane later synchronizes runs, artifact manifests, and delivery receipts from the backend.
