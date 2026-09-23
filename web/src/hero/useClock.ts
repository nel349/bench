import { useEffect, useRef, useState } from "react";

/**
 * Milliseconds since `key` last changed, advanced once per animation frame.
 *
 * Reset by changing the key, which is how one board hands over to the next without the component
 * keeping its own timers. Paused when the tab is hidden — a browser already throttles frames there,
 * and resuming mid-flight would jump a ray across the board.
 */
export function useClock(key: string | number, running: boolean): number {
  const [elapsed, setElapsed] = useState(0);
  const origin = useRef<number | null>(null);

  useEffect(() => {
    origin.current = null;
    setElapsed(0);
    if (!running) return;

    let frame = 0;
    const tick = (now: number) => {
      if (origin.current === null) origin.current = now;
      setElapsed(now - origin.current);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [key, running]);

  return elapsed;
}

/** Whether the person has asked for less motion. Honoured by showing a finished board instead. */
export function usePrefersReducedMotion(): boolean {
  const query = "(prefers-reduced-motion: reduce)";
  const [reduced, setReduced] = useState(() =>
    typeof window !== "undefined" && window.matchMedia(query).matches);

  useEffect(() => {
    const media = window.matchMedia(query);
    const changed = () => setReduced(media.matches);
    media.addEventListener("change", changed);
    return () => media.removeEventListener("change", changed);
  }, []);

  return reduced;
}
