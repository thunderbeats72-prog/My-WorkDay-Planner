import { useId } from 'react';

const SIZES = { sm: 32, md: 40, lg: 56 } as const;

/**
 * The app mark: a midnight-glass tile with a soft blue aura, a bright "W"
 * monogram and a single fresh-green spark. Rendered inline so it stays crisp
 * at every size and picks up the surrounding layout, with unique gradient ids
 * per instance so several marks can live on the same page.
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
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const px = SIZES[size];
  const id = (name: string) => `${name}-${uid}`;

  return (
    <span
      className={`brand-mark brand-mark-${size} ${className}`.trim()}
      style={{ width: px, height: px }}
      aria-hidden={decorative ? 'true' : undefined}
      role={decorative ? undefined : 'img'}
      aria-label={decorative ? undefined : 'My Workday Planner'}
    >
      <svg viewBox="0 0 512 512" width={px} height={px} focusable="false">
        <defs>
          <linearGradient id={id('tile')} x1="46" y1="12" x2="472" y2="506" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#1E3A6B" />
            <stop offset="0.48" stopColor="#132542" />
            <stop offset="1" stopColor="#070E1B" />
          </linearGradient>
          <radialGradient id={id('aura')} cx="0" cy="0" r="1" gradientTransform="translate(120 58) rotate(38) scale(340)">
            <stop offset="0" stopColor="#7FA8FF" stopOpacity="0.55" />
            <stop offset="0.48" stopColor="#3E6FE8" stopOpacity="0.14" />
            <stop offset="1" stopColor="#3E6FE8" stopOpacity="0" />
          </radialGradient>
          <radialGradient id={id('aura2')} cx="0" cy="0" r="1" gradientTransform="translate(430 470) rotate(-140) scale(300)">
            <stop offset="0" stopColor="#2FBF9B" stopOpacity="0.3" />
            <stop offset="1" stopColor="#2FBF9B" stopOpacity="0" />
          </radialGradient>
          <linearGradient id={id('glass')} x1="256" y1="0" x2="256" y2="232" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#FFFFFF" stopOpacity="0.22" />
            <stop offset="1" stopColor="#FFFFFF" stopOpacity="0" />
          </linearGradient>
          <linearGradient id={id('mono')} x1="130" y1="150" x2="392" y2="386" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#FFFFFF" />
            <stop offset="0.6" stopColor="#FBFDFF" />
            <stop offset="1" stopColor="#D3E2FF" />
          </linearGradient>
          <linearGradient id={id('spark')} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#A7F5DF" />
            <stop offset="1" stopColor="#46C8F2" />
          </linearGradient>
          <filter id={id('bevel')} x="-30%" y="-30%" width="160%" height="160%">
            <feDropShadow dx="0" dy="8" stdDeviation="9" floodColor="#060C18" floodOpacity="0.5" />
          </filter>
        </defs>
        <rect width="512" height="512" rx="120" fill={`url(#${id('tile')})`} />
        <rect width="512" height="512" rx="120" fill={`url(#${id('aura')})`} />
        <rect width="512" height="512" rx="120" fill={`url(#${id('aura2')})`} />
        <path
          d="M0 120C0 53.7 53.7 0 120 0h272c66.3 0 120 53.7 120 120v22c-76 42-168 66-256 66S76 184 0 142v-22Z"
          fill={`url(#${id('glass')})`}
        />
        <rect x="6" y="6" width="500" height="500" rx="115" fill="none" stroke="#FFFFFF" strokeOpacity="0.2" strokeWidth="9" />
        <rect x="16" y="16" width="480" height="480" rx="106" fill="none" stroke="#FFFFFF" strokeOpacity="0.06" strokeWidth="4" />
        <g filter={`url(#${id('bevel')})`}>
          <path
            d="M124 164 181 351.5c3.4 10.8 18.8 11.4 23.1 0.9L256 235.2l51.8 117.2c4.3 10.5 19.7 9.9 23.1-0.9L388 164"
            fill="none"
            stroke={`url(#${id('mono')})`}
            strokeWidth="43"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </g>
        <path d="M408 92.6 416.2 115.8 439.4 124 416.2 132.2 408 155.4 399.8 132.2 376.6 124 399.8 115.8Z" fill={`url(#${id('spark')})`} />
      </svg>
    </span>
  );
}
