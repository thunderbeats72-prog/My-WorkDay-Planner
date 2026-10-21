/**
 * The master geometry of the Workday mark, shared by the inline SVG in the app
 * chrome, the generated `public/icon.svg` and every PNG the OS asks for.
 *
 * It lives outside the component so the values can be imported by tests and by
 * the asset generator without pulling React in, and so the logo cannot drift
 * into two different marks again (it once drew 177° in the sidebar and 233° in
 * the tab).
 */

export const MARK = {
  size: 512,
  radius: 132,
  stroke: 30,
  /** The part of the day already lived, in degrees. */
  arcDegrees: 233,
  /** Dash length that draws exactly `arcDegrees` of the ring. */
  dash: 537,
  /** The dash pattern repeats once per turn, leaving the gap. */
  gap: 829,
  pinRadius: 17,
  pinStroke: 9,
  /** The pin sits at 12 o'clock, where the arc begins. */
  pinY: 124,
  /** Near-black tile. Never navy. */
  tile: '#0B0B0D',
} as const;
