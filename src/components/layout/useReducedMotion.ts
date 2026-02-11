import { useEffect, useRef } from "react";

/**
 * Tracks the `prefers-reduced-motion: reduce` media query.
 * Returns a stable ref whose `.current` is always up-to-date.
 */
export function useReducedMotion(): React.MutableRefObject<boolean> {
  const ref = useRef(false);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }

    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => {
      ref.current = mediaQuery.matches;
    };

    update();

    if (typeof mediaQuery.addEventListener === "function") {
      mediaQuery.addEventListener("change", update);
      return () => {
        mediaQuery.removeEventListener("change", update);
      };
    }

    mediaQuery.addListener(update);
    return () => {
      mediaQuery.removeListener(update);
    };
  }, []);

  return ref;
}
