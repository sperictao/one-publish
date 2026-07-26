# Require adapter conformance before registration

Built-in adapters enter the catalog and runner only after passing shared conformance suites for versioned schemas and migrations, capability truthfulness, deterministic and secret-free plan fragments, declared artifact roles, lifecycle mapping, idempotency, digest validation, retention, and recovery. Adapter-specific tests remain local, while contract behavior is verified only through the same interface used by the planner and runner.
