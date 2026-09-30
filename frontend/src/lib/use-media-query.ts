import { useSyncExternalStore } from "react";

// Phones in portrait (narrow) and in landscape (short touch screens) get the
// compact, read-only layout.
export const COMPACT_LAYOUT_QUERY = "(max-width: 767px), (pointer: coarse) and (max-height: 540px)";

export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const media = window.matchMedia(query);
      media.addEventListener("change", onChange);
      return () => media.removeEventListener("change", onChange);
    },
    () => window.matchMedia(query).matches,
    () => false
  );
}
