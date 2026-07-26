# Resolve credential references through the execution backend

All five adapter families declare credential requirements, while publish configurations bind those requirements only to non-secret references. The selected execution backend resolves references from its supported secret stores, and exports, plans, manifests, history, and logs retain only references and redacted validation results.
