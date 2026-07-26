# Classify failures before automatic retry

Adapters return versioned failure categories with their native error code, retry safety, and optional retry-after instead of asking the runner to parse messages. Automatic retry is limited to eligible transient or rate-limited failures whose side effects support an idempotency probe and whose retry policy remains active; authentication, authorization, validation, conflict, policy, unsupported, rejected, and unknown failures become explicit blocking states.
