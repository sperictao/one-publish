# Map destination states onto a common delivery lifecycle

Delivery destinations preserve their native state while mapping it onto Pending, Staged, Submitted, Published, and explicit failure terminal states. Destinations may skip unsupported intermediate stages, but only Published satisfies a required route, and every adapter declares the irreversible transition where rollback is no longer promised.
