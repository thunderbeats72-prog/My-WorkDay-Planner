import type { Sticker, StickerGlyph } from '../lib/stickers';

/**
 * The stamps themselves.
 *
 * Drawn as strokes on a 24-unit grid so they read at 20px in a shelf row and at
 * 44px when one lands. Ink only — `currentColor` — with the success tone
 * available for the two that mean "you cleared something", never as decoration.
 */
export function StickerGlyph({ glyph, size = 24 }: { glyph: StickerGlyph; size?: number }) {
  const common = {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.6,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  };

  switch (glyph) {
    case 'spark':
      return (
        <svg {...common}>
          <path d="M12 3v5.2M12 15.8V21M3 12h5.2M15.8 12H21" />
          <path d="M6.6 6.6l3.2 3.2M14.2 14.2l3.2 3.2M17.4 6.6l-3.2 3.2M9.8 14.2l-3.2 3.2" />
          <circle cx="12" cy="12" r="2.1" fill="currentColor" stroke="none" />
        </svg>
      );
    case 'chevrons':
      return (
        <svg {...common}>
          <path d="M6 6l6 6-6 6" />
          <path d="M13 6l6 6-6 6" />
        </svg>
      );
    case 'rings':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="8.4" />
          <circle cx="12" cy="12" r="5" />
          <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
        </svg>
      );
    case 'check-ring':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="8.6" />
          <path d="M8.2 12.4l2.6 2.6 5-5.4" />
        </svg>
      );
    case 'crescent':
      return (
        <svg {...common}>
          <path d="M16.8 15.6A7.4 7.4 0 1 1 9.4 4.2a6 6 0 0 0 7.4 11.4z" />
          <path d="M18.4 5.4l.5 1.4 1.4.5-1.4.5-.5 1.4-.5-1.4-1.4-.5 1.4-.5z" />
        </svg>
      );
    case 'sunrise':
      return (
        <svg {...common}>
          <path d="M4 17.6h16" />
          <path d="M7.6 17.6a4.4 4.4 0 0 1 8.8 0" />
          <path d="M12 3.4v3M4.9 7.1l2 2M19.1 7.1l-2 2" />
        </svg>
      );
    case 'flag':
      return (
        <svg {...common}>
          <path d="M6.4 21V3.6" />
          <path d="M6.4 4.4h9.4l-1.7 3.4 1.7 3.4H6.4" />
        </svg>
      );
    case 'bars':
      return (
        <svg {...common}>
          <path d="M6 18.6V13M12 18.6V8.2M18 18.6V4.6" />
        </svg>
      );
    default:
      return null;
  }
}

/** A stamp you have already earned, small enough for a shelf row. */
export function StickerChip({ sticker, title }: { sticker: Sticker; title?: string }) {
  return (
    <span className={`sticker-chip tone-${sticker.tone}`} title={title ?? sticker.name}>
      <StickerGlyph glyph={sticker.glyph} size={19} />
    </span>
  );
}
