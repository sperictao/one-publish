import { useRef } from "react";

const UNSET = Symbol("lazy-ref-unset");

export function useLazyRef<T>(init: () => T): React.MutableRefObject<T> {
 const ref = useRef<T | typeof UNSET>(UNSET);
 if (ref.current === UNSET) {
 ref.current = init();
 }
 return ref as React.MutableRefObject<T>;
}
