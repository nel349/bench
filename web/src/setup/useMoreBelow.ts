import { useCallback, useEffect, useRef, useState } from "react";

/** How close to the bottom counts as there, so a pixel of rounding does not keep the cue up. */
const SLACK_PX = 8;

/**
 * Whether a scrolling box has more below what shows, and a way to move on to it.
 *
 * Set up's panel scrolls inside a screen that does not, and at 1280×720 it hid steps 4 and 5 with
 * nothing to say they were there: a Mac draws no scrollbar until something scrolls.
 */
export function useMoreBelow<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [more, setMore] = useState(false);

  useEffect(() => {
    const box = ref.current;
    if (box === null) return;
    const check = () => setMore(box.scrollHeight - box.scrollTop - box.clientHeight > SLACK_PX);
    check();
    box.addEventListener("scroll", check, { passive: true });
    // Where the browser cannot watch the box's size, the cue still follows scrolling.
    const resized = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(check);
    resized?.observe(box);
    return () => { box.removeEventListener("scroll", check); resized?.disconnect(); };
  }, []);

  const showMore = useCallback(() => {
    const box = ref.current;
    if (box) box.scrollBy({ top: box.clientHeight * 0.8, behavior: "smooth" });
  }, []);

  return { ref, more, showMore };
}
