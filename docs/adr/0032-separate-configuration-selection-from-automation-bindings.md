# Separate configuration selection from automation bindings

Selecting a publish configuration changes only the UI context and manual execution source. Repository automation is installed through explicit bindings between a fixed configuration revision, the execution backend fixed by that revision, a trigger policy, and a backend external identity; the binding cannot override adapter settings. Multiple non-conflicting bindings may coexist, so selecting a local configuration cannot disable stable or nightly automation.
