import { useEffect, useState } from "react";

/**
 * Which plate is showing, carried in the URL's hash so a view can be linked to and survives a
 * reload. Three views of one rig, not three pages: the frame stays put and the image inside changes.
 */
export const VIEWS = ["rig", "gigs", "ledger"] as const;
export type View = (typeof VIEWS)[number];

const read = (): View => {
  const wanted = window.location.hash.replace(/^#/, "");
  return (VIEWS as readonly string[]).includes(wanted) ? (wanted as View) : "rig";
};

export function useView(): View {
  const [view, setView] = useState<View>(read);
  useEffect(() => {
    const changed = () => setView(read());
    window.addEventListener("hashchange", changed);
    return () => window.removeEventListener("hashchange", changed);
  }, []);
  return view;
}
