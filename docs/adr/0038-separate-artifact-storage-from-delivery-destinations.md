# Separate artifact storage from delivery destinations

Execution backends persist artifact sets through registered Artifact Store adapters with content-addressed locators and explicit retention, independently of user-facing delivery destinations. This keeps failed-route retry, asynchronous review, and cross-backend promotion tied to the original bytes; expired artifacts make an attempt unresumable rather than triggering a silent rebuild under the same identity.
