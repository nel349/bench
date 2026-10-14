import { NetworkSwitch } from "./NetworkSwitch.tsx";

export interface MastheadProps {
  /** Where the name goes: the front page, which is a view on one page and a path from the other. */
  readonly home: string;
}

/** The start of the frame's top edge on every page: the name, and beside it which network this is. */
export function Masthead({ home }: MastheadProps) {
  return (
    <>
      <a className="brand" href={home}>BENCH<b>//</b></a>
      <NetworkSwitch />
    </>
  );
}
