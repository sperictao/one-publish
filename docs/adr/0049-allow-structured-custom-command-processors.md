# Allow structured custom-command processors

Project-specific escape hatches use an explicit Custom Command Processor with program and arguments, working directory, environment references, stage, platform, side-effect declarations, and artifact inputs and outputs. Raw shell strings and undeclared mutations are rejected, so custom gates can extend a provider without replacing release identity, artifact manifests, delivery receipts, or plan visibility.
