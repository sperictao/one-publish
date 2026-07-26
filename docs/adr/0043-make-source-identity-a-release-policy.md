# Make source identity a release policy

Publishing does not always mutate version files or create commits and tags. A release policy chooses whether to use an existing tag, create a version commit and tag, derive a channel build from a fixed revision, or promote an existing Artifact Manifest, while providers own project-version fields and delivery destinations remain independent of source-control operations.
