import { useRef } from "react";

const UNSET = Symbol("lazy-ref-unset");

export function useLazyRef<T>(init: () => T): React.MutableRefObject<T> {
  const ref = useRef<T | typeof UNSET>(UNSET);
  /* eslint-disable react-hooks/refs -- 惰性初始化须在首个渲染期同步完成，语义有意为之 */
  if (ref.current === UNSET) {
    ref.current = init();
  }
  /* eslint-enable react-hooks/refs */
  return ref as React.MutableRefObject<T>;
}
