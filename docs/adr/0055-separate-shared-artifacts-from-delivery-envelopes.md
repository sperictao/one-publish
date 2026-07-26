# Separate shared artifacts from delivery envelopes

All delivery routes consume one sealed Artifact Manifest, while target-specific paths, headers, release bodies, download indexes, and store submission forms are generated as route-owned Delivery Envelopes during staging. A destination may derive an envelope deterministically from the manifest, release inputs, and route settings, but it cannot mutate shared artifact bytes or create a replacement manifest; files intended for reuse across routes must be produced by an Artifact Processor before sealing.
