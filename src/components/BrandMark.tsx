/**
 * The app mark: a quiet "day arc" — a nearly-complete ring with a gap and a
 * single pin at its start — on a flat near-black tile.
 *
 * Deliberately free of gradients, glows or sparks: the mark should read as a
 * precision instrument at 16px and as a considered logo at 96px. The arc is
 * the day; the gap is what is still left of it.
 *
 * The geometry comes from `lib/brandGeometry` so the mark here, the tab icon
 * and the generated PNGs cannot drift into different logos. `pnpm brand:icons`
 * regenerates the assets from the same module.
 */

import { MARK } from '../lib/brandGeometry';

const SIZES = { sm: 32, md: 40, lg: 56 } as const;

export function BrandMark({
  size = 'md',
  className = '',
  decorative = true,
}: {
  size?: keyof typeof SIZES;
  className?: string;
  decorative?: boolean;
}) {
  const px = SIZES[size];

  return (
    <span
      className={`brand-mark brand-mark-${size} ${className}`.trim()}
      style={{ width: px, height: px }}
      aria-hidden={decorative ? 'true' : undefined}
      role={decorative ? undefined : 'img'}
      aria-label={decorative ? undefined : 'My Workday Planner'}
    >
      <svg viewBox={`0 0 ${MARK.size} ${MARK.size}`} width={px} height={px} focusable="false">
        <rect width={MARK.size} height={MARK.size} rx="112" fill={MARK.tile} />
        <rect
          x="3"
          y="3"
          width={MARK.size - 6}
          height={MARK.size - 6}
          rx="109"
          fill="none"
          stroke="#FFFFFF"
          strokeOpacity="0.1"
          strokeWidth="6"
        />
        {/* Track: the whole day, barely there. */}
        <circle
          cx={MARK.size / 2}
          cy={MARK.size / 2}
          r={MARK.radius}
          fill="none"
          stroke="#FFFFFF"
          strokeOpacity="0.16"
          strokeWidth={MARK.stroke}
        />
        {/* Arc: the part of the day already lived. */}
        <circle
          cx={MARK.size / 2}
          cy={MARK.size / 2}
          r={MARK.radius}
          fill="none"
          stroke="#FFFFFF"
          strokeWidth={MARK.stroke}
          strokeLinecap="round"
          strokeDasharray={`${MARK.dash} ${MARK.gap}`}
          transform={`rotate(-90 ${MARK.size / 2} ${MARK.size / 2})`}
        />
        {/* The pin: now. */}
        <circle
          cx={MARK.size / 2}
          cy={MARK.pinY}
          r={MARK.pinRadius}
          fill={MARK.tile}
          stroke="#FFFFFF"
          strokeWidth={MARK.pinStroke}
        />
      </svg>
    </span>
  );
}
