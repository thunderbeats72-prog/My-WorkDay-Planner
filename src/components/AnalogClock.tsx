import { useEffect, useState } from 'react';

const FACE = 100; // internal viewBox units; everything scales from here

/**
 * A minimal analogue clock.
 *
 * Three hands, a hairline dial and four tick marks — no numerals, no chrome.
 * It ticks once a second but only re-renders when the second actually changes,
 * and it stays perfectly legible at 28px. Reduced-motion users get a sweeping
 * second hand instead of a stepping one (both are CSS transforms, so the cost
 * is one composited layer at most).
 */
export function AnalogClock({ size = 36 }: { size?: number }) {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    let timer = 0;
    const tick = () => setNow(new Date());
    timer = window.setInterval(tick, 1000);
    const onVisible = () => {
      if (document.visibilityState === 'visible') tick();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  const seconds = now.getSeconds();
  const minutes = now.getMinutes() + seconds / 60;
  const hours = (now.getHours() % 12) + minutes / 60;

  const hourAngle = hours * 30;
  const minuteAngle = minutes * 6;
  const secondAngle = seconds * 6;

  const label = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');

  return (
    <span className="clock-wrap" title={`Local time ${label}`}>
    <span className="analog-clock" style={{ width: size, height: size }} role="img" aria-label={`Local time ${label}`}>
      <svg viewBox={`0 0 ${FACE} ${FACE}`} width={size} height={size} focusable="false" aria-hidden="true">
        <circle cx="50" cy="50" r="46" className="clock-face" />
        {/* Hour marks: only the quarters, as hairlines. */}
        {[0, 90, 180, 270].map((angle) => (
          <line
            key={angle}
            x1="50"
            y1="9"
            x2="50"
            y2={angle % 180 === 0 ? '15' : '14'}
            className="clock-tick"
            transform={`rotate(${angle} 50 50)`}
          />
        ))}
        <line x1="50" y1="50" x2="50" y2="29" className="clock-hand clock-hour" transform={`rotate(${hourAngle} 50 50)`} />
        <line x1="50" y1="50" x2="50" y2="19" className="clock-hand clock-minute" transform={`rotate(${minuteAngle} 50 50)`} />
        <g transform={`rotate(${secondAngle} 50 50)`}>
          <line x1="50" y1="56" x2="50" y2="16" className="clock-hand clock-second" />
        </g>
        <circle cx="50" cy="50" r="2.6" className="clock-pin" />
      </svg>
    </span>
    <span className="clock-readout" aria-hidden="true">
      {hh}:{mm}
    </span>
    </span>
  );
}
