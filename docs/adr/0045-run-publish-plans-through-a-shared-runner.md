# Run Publish Plans through a shared runner

Execution backends install thin native wrappers for triggers, runner topology, permissions, secret mapping, approvals, and artifact storage, while a pinned One Publish Runner executes the shared Publish Plan and built-in adapters. Local execution reuses the same runtime core, so adding providers, processors, or destinations does not require reimplementing their behavior in every CI syntax.
