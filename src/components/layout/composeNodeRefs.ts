export function composeNodeRefs<TNode extends HTMLElement>(
  ...refs: Array<((node: TNode | null) => void) | undefined>
): (node: TNode | null) => void {
  return (node) => {
    for (const ref of refs) {
      ref?.(node);
    }
  };
}
