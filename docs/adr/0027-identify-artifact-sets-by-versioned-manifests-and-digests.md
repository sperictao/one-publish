# Identify artifact sets by versioned manifests and digests

Artifact collection and processors construct a manifest candidate, and the persist stage seals one immutable versioned Artifact Manifest after validating every digest. Its entries describe artifact roles, platform and architecture, media type, size, derivation, digest, and storage locator. Delivery, retry, and promotion operate on that sealed manifest rather than filenames or build directories, while One Publish persists metadata and locators instead of copying large binaries into application state.
