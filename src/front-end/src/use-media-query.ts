import { useEffect, useState } from "react";

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
 * Reads synchronously on first render so the initial paint is already correct —
 * initialising to `false` and correcting in the effect makes a phone render the
 * desktop layout for one frame, which is visible as a sideways lurch.
 */
export function useIsMobile(): boolean {
  const query = `(max-width: ${MOBILE_BREAKPOINT - 1}px)`;
  const [isMobile, setIsMobile] = useState(() => window.matchMedia(query).matches);

  useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    setIsMobile(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [query]);

  return isMobile;
}
