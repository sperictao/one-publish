# Drive adapter configuration through versioned schemas

Each project provider, artifact processor, execution backend, artifact store, and delivery destination supplies a versioned settings schema, defaults, validation, and a read-only summary that the shared publish-configuration editor composes. Frontend-specific extensions are limited to registered field controls when the schema cannot express an interaction; adapters do not own whole configuration pages.
