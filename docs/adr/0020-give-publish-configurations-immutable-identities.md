# Give publish configurations immutable identities

All editable provider configurations receive immutable identities instead of using mutable names as storage keys. Existing local configurations are migrated once, while names remain unique within a repository and continue to serve only as user-facing labels.
