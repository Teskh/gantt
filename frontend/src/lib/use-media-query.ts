import { useSyncExternalStore } from "react";

// Phones in portrait (narrow) and in landscape (short touch screens) get the
// compact, read-only layout.
export const COMPACT_LAYOUT_QUERY = "(max-width: 767px), (pointer: coarse) and (max-height: 540px)";

// An unfolded iPhone Duo is the only iPhone with both sides of the screen at
// least 520px; regular iPhones stay under 450px on their short side. iPads
// report themselves as Macs, so they never match.
const DUO_UNFOLDED_QUERY = "(pointer: coarse) and (min-width: 520px) and (min-height: 520px)";
const IS_IPHONE = typeof navigator !== "undefined" && /iPhone/.test(navigator.userAgent);

export function useIsDuoUnfolded(): boolean {
  const matches = useMediaQuery(DUO_UNFOLDED_QUERY);
  return IS_IPHONE && matches;
}

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
