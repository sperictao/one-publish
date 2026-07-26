# Require idempotency probes for retryable delivery

Every retryable external side effect derives an idempotency identity from the attempt, plan node, release identity, Artifact Manifest digest, and delivery route. Destination adapters probe existing target state before acting, reuse only matching content, reject identity or digest conflicts, and explicitly mark operations that cannot be queried as unsafe for automatic retry.
