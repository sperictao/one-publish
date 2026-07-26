# Use one execution backend per release attempt

Each release attempt is owned and tracked by one execution backend, although that backend may schedule multiple hosted or self-hosted runners across platforms and network zones. Moving verified artifacts between backends is modeled as artifact promotion in a new attempt, avoiding a distributed state machine that spans unrelated CI systems and local processes.
