import { useCallback, useEffect, useRef, useState } from "react";

/** How long "Copied" stays before the button reads "Copy" again. */
const COPIED_FOR_MS = 1_600;

/**
 * Copying to the clipboard, and saying so for a moment.
 *
 * A browser can refuse, on a page not served securely or without a user's gesture. Then nothing
 * says "Copied", and the line is still there to select by hand.
 */
export function useCopy() {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const copy = useCallback(async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      return;
    }
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), COPIED_FOR_MS);
  }, []);

  return { copied, copy };
}
