const SIZES = { sm: 32, md: 40, lg: 56 } as const;

/**
 * The app mark: a quiet "day arc" — a nearly-complete ring with a gap and a
 * single pin at its start — on a flat near-black tile.
 *
 * Deliberately free of gradients, glows or sparks: the mark should read as a
 * precision instrument at 16px and as a considered logo at 96px. The arc is
 * the day; the gap is what is still left of it.
 */
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
      <svg viewBox="0 0 512 512" width={px} height={px} focusable="false">
        <rect width="512" height="512" rx="112" fill="#0B0B0D" />
        <rect
          x="3"
          y="3"
          width="506"
          height="506"
          rx="109"
          fill="none"
          stroke="#FFFFFF"
          strokeOpacity="0.1"
          strokeWidth="6"
        />
        {/* Track: the whole day, barely there. */}
        <circle cx="256" cy="256" r="132" fill="none" stroke="#FFFFFF" strokeOpacity="0.16" strokeWidth="30" />
        {/* Arc: the part of the day already lived. 268° starting at 12 o'clock. */}
        <circle
          cx="256"
          cy="256"
          r="132"
          fill="none"
          stroke="#FFFFFF"
          strokeWidth="30"
          strokeLinecap="round"
          strokeDasharray="407 422"
          transform="rotate(-90 256 256)"
        />
        {/* The pin: now. */}
        <circle cx="256" cy="124" r="17" fill="#0B0B0D" stroke="#FFFFFF" strokeWidth="9" />
      </svg>
    </span>
  );
}
