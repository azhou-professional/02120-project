// Colour scale for Monte-Carlo trials (dark theme).
// Diverging around the PDOP threshold: teal (good) -> neutral at the threshold -> orange (bad).
// The scale runs from PDOP 1 to 2x the threshold and is clamped outside that range.
// Trials with fewer than 4 satellites (PDOP undefined) get their own violet.
const TEAL = [0x19, 0x9e, 0x70];
const NEUTRAL = [0xc3, 0xc2, 0xb7];
const ORANGE = [0xd9, 0x59, 0x26];
const UNDEFINED = [0x90, 0x85, 0xe9];
// A finished flash stays on the globe as the same colour times FADE (a darkened version of
// its PDOP colour). Lower = darker, but too dark disappears against the dark-blue Earth.
export const FADE = 0.6;

const MIN_THRESHOLD = 1.1;                         // PDOP is never below ~1; keeps the scale well defined
const mix = (a, b, f) => a.map((v, i) => v + (b[i] - v) * f);
const css = (c) => `rgb(${c.map(Math.round).join(",")})`;

export const rgb01 = (c) => c.map((v) => v / 255);
export const cssColor = (c) => css(c);
export const UNDEFINED_RGB = UNDEFINED;

/** Colour (0-255 triple) for a trial with the given PDOP (null = undefined). */
export function trialColor(pdop, threshold) {
  if (pdop === null) return UNDEFINED;
  const thr = Math.max(threshold, MIN_THRESHOLD);
  const x = Math.min(Math.max(pdop, 1), 2 * thr);
  return x <= thr ? mix(TEAL, NEUTRAL, (x - 1) / (thr - 1)) : mix(NEUTRAL, ORANGE, (x - thr) / thr);
}

/** CSS gradient for the legend bar, with the neutral stop where PDOP = threshold.
 *  `scale` < 1 gives the darkened version used for earlier trials. */
export function legendGradient(threshold, scale = 1) {
  const thr = Math.max(threshold, MIN_THRESHOLD);
  const mid = ((thr - 1) / (2 * thr - 1)) * 100;
  const c = (col) => css(col.map((v) => v * scale));
  return `linear-gradient(to right, ${c(TEAL)}, ${c(NEUTRAL)} ${mid}%, ${c(ORANGE)})`;
}
