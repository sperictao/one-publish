# Bind automation to immutable configuration revisions

Saving a publish-configuration edit creates a new immutable revision, while installed automation continues referencing its previous revision until the user previews and applies an explicit binding update. Manual runs may use the latest revision, but remote stable or nightly behavior cannot change because of an unconfirmed local edit or failed workflow synchronization.
