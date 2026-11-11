import { useCallback, useSyncExternalStore } from "react";

/**
 * Below this width the app switches to its single-column layout.
 *
 * 768 rather than the mockup's 390: a tablet in portrait has room for the
 * desktop board but not for a 340px sidebar beside it, so it wants the phone
 * layout too.
 */
export const MOBILE_BREAKPOINT = 768;

/**
 * Layout lives in inline style objects, which cannot hold a media query. This
 * is how a breakpoint reaches them: a boolean the style value branches on.
 *
 * ── Why useSyncExternalStore and not useState + useEffect ──────────────────
 *
 * `matchMedia` is an external store, which is precisely what this hook is for.
 * The previous version seeded state from `matchMedia` during render and then
 * re-read it inside an effect, because the viewport can change between those
 * two moments and a subscription registered in an effect would miss it.
 *
 * That second read was a `setState` in an effect body — one extra render on
 * every mount of every component using it, which here is most of them. This
 * does the same job with no extra render: React reads the snapshot during
 * render AND re-checks it when it subscribes, which is the exact gap the
 * manual version was patching by hand.
 *
 * Reading synchronously on first render is what keeps the initial paint
 * correct; initialising to `false` and correcting afterwards makes a phone
 * render the desktop layout for one frame, visible as a sideways lurch.
 */
export function useIsMobile(): boolean {
  const query = `(max-width: ${MOBILE_BREAKPOINT - 1}px)`;

  const subscribe = useCallback(
    (onChange: () => void) => {
      const mq = window.matchMedia(query);
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    },
    [query],
  );

  // Returns a boolean, so React's snapshot comparison is by value — no risk of
  // the "getSnapshot should be cached" loop that catches callers returning a
  // fresh object each time.
  const getSnapshot = useCallback(() => window.matchMedia(query).matches, [query]);

  return useSyncExternalStore(subscribe, getSnapshot);
}
