import { useEffect, useState } from "react";
import QRCode from "qrcode";

export interface QrCodeProps {
  /** What the code opens when scanned. */
  readonly text: string;
  /** What it is, for a screen reader and for an image that fails to draw. */
  readonly label: string;
}

/** Dark on light, as a phone's camera reads best; the page's own colours would be read worse. */
const COLORS = { dark: "#05030c", light: "#f4f2ff" } as const;

/**
 * A code for a phone to scan, drawn as an image.
 *
 * For a step done on the phone while the page is open on a laptop: an address typed letter by
 * letter into a phone is where people give up. Drawn as SVG in the page, so nothing is fetched from
 * anywhere to draw it. Until it is drawn there is nothing on screen, and the address beside it still
 * says where to go.
 */
export function QrCode({ text, label }: QrCodeProps) {
  const [svg, setSvg] = useState<string | null>(null);
  useEffect(() => {
    let current = true;
    QRCode.toString(text, { type: "svg", margin: 1, errorCorrectionLevel: "M", color: COLORS })
      .then((drawn) => { if (current) setSvg(drawn); })
      // A code that cannot be drawn leaves the typed address, which is enough to go on.
      .catch((cause: unknown) => console.warn("[qr] could not draw a code", cause));
    return () => { current = false; };
  }, [text]);
  if (svg === null) return null;
  return <img className="qr" src={`data:image/svg+xml;utf8,${encodeURIComponent(svg)}`} alt={label} />;
}
