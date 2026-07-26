---
status: superseded by ADR-0032
---

# Use the current publish configuration for Tauri activation

Tauri release configurations use the same catalog and selection model as other provider configurations instead of maintaining a separate release-center list or active-configuration pointer. Selecting or updating the current GitHub-target configuration becomes effective only after its managed workflow is confirmed and synchronized, so cancellation or failure preserves both the previous configuration and workflow; deleting it likewise removes local state only after managed-workflow detachment succeeds. Later workflow drift is exposed as a blocking health state on the current configuration and is repaired through the ordinary update action.
