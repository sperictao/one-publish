# Detect automation conflicts by release and destination namespace

Automation bindings conflict only when their trigger and release policies can produce the same release identity in the same delivery-destination namespace. Workflow filenames and provider types are backend implementation details, so binding installation and updates report the exact overlapping identity and destination scope instead of enforcing one automation per repository.
