# Version and migrate adapter settings explicitly

Publish configurations record the contract version and each adapter's settings version, and adapters provide explicit stepwise migrations to their current schema. Unsupported or missing adapters leave configurations viewable and exportable but blocked, while successful migrations are previewed and saved atomically without rewriting historical release snapshots.
