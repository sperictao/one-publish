# Keep configuration management separate from manual execution

The middle publish-configuration module owns configuration CRUD, immutable revisions, automation bindings, and health states for every adapter type. Selecting a row changes only the configuration shown for manual planning, while the right execution area displays release inputs, the resulting Publish Plan, attempt progress, and receipts without becoming a second configuration or automation center.
