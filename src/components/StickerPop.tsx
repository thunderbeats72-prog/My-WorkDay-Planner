import { useEffect } from 'react';
import { StickerGlyph } from './StickerStamp';
import type { Sticker } from '../lib/stickers';

export interface StickerMoment {
  /** Changes on every completion, so the same sticker replays its animation. */
  key: number;
  sticker: Sticker;
  caption: string;
}

/**
 * One stamp, one line, then gone.
 *
 * It lands where the eye already is after ticking something off — bottom
 * centre on a laptop, under the header on a phone — and leaves on its own.
 * Nothing to dismiss, nothing to read twice, and nothing covering the undo
 * button in the corner.
 *
 * Both the entrance and the exit are CSS. The only timer here decides when the
 * element is removed; if a frame is dropped, nothing is ever stranded on
 * screen, because `forwards` holds it invisible until removal.
 */
export function StickerPop({ moment, onDone }: { moment: StickerMoment | null; onDone: () => void }) {
  useEffect(() => {
    if (!moment) return;
    const timer = window.setTimeout(onDone, 3500);
    return () => window.clearTimeout(timer);
  }, [moment, onDone]);

  if (!moment) return null;

  return (
    // The key restarts the CSS animation when a second sticker lands while the
    // first is still on its way out.
    <div key={moment.key} className={`sticker-pop tone-${moment.sticker.tone}`} role="status" aria-live="polite">
      <span className="sticker-stamp" aria-hidden="true">
        <StickerGlyph glyph={moment.sticker.glyph} size={26} />
      </span>
      <span className="sticker-copy">
        <strong>{moment.sticker.name}</strong>
        <span>{moment.caption}</span>
      </span>
    </div>
  );
}
