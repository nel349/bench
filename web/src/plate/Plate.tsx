import type { ReactNode } from "react";

/**
 * A plate: the whole screen, a frame on four sides, and one exposure in the middle.
 *
 * This replaces the layout every landing page has — masthead, hero band, then a centred column of
 * stacked sections. That structure survived a change of colours, and it was the part that made the
 * page generic.
 *
 * Here nothing scrolls and there is no column. What is not the image is printed on the frame, the way
 * a strip of film carries its frame number and exposure data in the margin. The frame line is broken
 * wherever text sits on it, so the words are cut into the edge rather than set beside it.
 */
export interface PlateProps {
  readonly top?: { readonly start?: ReactNode; readonly end?: ReactNode };
  readonly bottom?: { readonly start?: ReactNode; readonly middle?: ReactNode; readonly end?: ReactNode };
  /** Read bottom to top, as a film strip's left margin is. */
  readonly left?: ReactNode;
  /** Read top to bottom. */
  readonly right?: ReactNode;
  /** The one line that has to be read, set inside the frame above its bottom edge. */
  readonly caption?: ReactNode;
  readonly children: ReactNode;
}

export function Plate({ top, bottom, left, right, caption, children }: PlateProps) {
  return (
    <div className="plate">
      <div className="grain" aria-hidden="true" />
      <div className="frame" aria-hidden="true" />

      {top?.start && <div className="edge top start">{top.start}</div>}
      {top?.end && <div className="edge top end">{top.end}</div>}
      {left && <div className="edge left">{left}</div>}
      {right && <div className="edge right">{right}</div>}
      {bottom?.start && <div className="edge bottom start">{bottom.start}</div>}
      {bottom?.middle && <div className="edge bottom middle">{bottom.middle}</div>}
      {bottom?.end && <div className="edge bottom end">{bottom.end}</div>}

      <main className="plate-body">{children}</main>
      {caption && <div className="caption" aria-live="polite">{caption}</div>}
    </div>
  );
}
