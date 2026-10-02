/**
 * The pace of the front page, named.
 *
 * Deliberately slow. The piece this takes its cue from transitions its background over four seconds,
 * and the point of that patience is that a person watches rather than glances. A ray that crosses
 * the board in under a second reads as a spinner; one that takes its time reads as something being
 * found out.
 */

/** How long a ray takes to cross one cell. */
export const MS_PER_CELL = 95;

/** The breath between one ray landing and the next being bought. */
export const MS_BETWEEN_RAYS = 650;

/** How long a finished board stays up, so its web of paid-for light can be read. */
export const MS_HOLD_FINISHED = 2_800;

/** The fade from one board to the next. */
export const MS_FADE = 1_100;

/**
 * How long a price stays on screen beside the port it was paid at.
 *
 * It used to start fading the moment it appeared and was gone in 1.4s, so on a short probe it was
 * never fully readable — the one number that explains what is being watched flickered past.
 */
export const MS_PRICE_VISIBLE = 2_400;

/** The share of that time spent arriving, and the point after which it leaves. */
export const PRICE_FADE_IN = 0.08;
export const PRICE_HOLD_UNTIL = 0.7;
