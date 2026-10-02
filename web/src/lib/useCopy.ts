import { useCallback, useEffect, useRef, useState } from "react";
import { writeClipboard } from "./clipboard.ts";

/** How long "Copied" stays before the button reads "Copy" again. */
const COPIED_FOR_MS = 1_600;

/**
 * Copying to the clipboard, and saying so for a moment.
 *
 * See `writeClipboard` for how it copies on a page that is not served securely. If the browser
 * refuses both ways, nothing says "Copied", and the line is still there to select by hand.
 */
export function useCopy() {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const copy = useCallback(async (text: string) => {
    if (!(await writeClipboard(text))) return;
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), COPIED_FOR_MS);
  }, []);

  return { copied, copy };
}
