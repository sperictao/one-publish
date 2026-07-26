# Project local configuration into remote automation

Local publish-configuration revisions remain the only editable source of truth, while automation installation derives a read-only runtime projection for the selected backend. Public plan data may be rendered into managed files, sensitive non-secret settings use protected backend variables, credentials use secrets, and projection digests detect drift without allowing remote state to be imported as an editable configuration.
