# Coordinate concurrency through resource leases

Publish attempts acquire renewable leases for the concrete resources declared by their plans, such as repository writes, release-and-destination namespaces, and artifact identities. Disjoint local builds, stable, nightly, and promotion attempts may run concurrently, while lease loss fails explicitly instead of relying on a repository-wide mutex or continuing with uncertain ownership.
