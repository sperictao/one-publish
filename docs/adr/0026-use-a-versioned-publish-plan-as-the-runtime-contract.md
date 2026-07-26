# Use a versioned Publish Plan as the runtime contract

All adapters contribute structured fragments to one versioned Publish Plan covering source inspection, version preparation, build, artifact collection, verification, delivery, publication, and observation. Execution backends run or render that plan, while UI, history, cancellation, and retry depend only on the plan contract rather than provider-specific commands or workflow YAML.
