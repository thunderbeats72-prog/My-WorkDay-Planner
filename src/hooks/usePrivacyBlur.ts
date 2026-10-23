import { useEffect, useState } from 'react';
import { PRIVACY_IDLE_MS, privacyAttribute, shouldBlur } from '../lib/privacy';

/**
 * Applies the privacy wash to the document while it is switched on.
 *
 * Activity listeners reset an idle clock; `visibilitychange` blurs the instant
 * the tab is hidden (and unblurs on return, still subject to idle); a slow
 * interval re-evaluates as idle time creeps up with no events at all. The
 * attribute lands on `<body>` so one CSS block can wash every sensitive
 * surface at once, and `prefers-reduced-motion` governs the fade like every
 * other transition in the product.
 */
export function usePrivacyBlur(enabled: boolean, thresholdMs = PRIVACY_IDLE_MS): boolean {
  // State exists only for the enabled path; disabled renders `false` without
  // a render-and-setState round trip.
  const [blurred, setBlurred] = useState(false);

  useEffect(() => {
    if (!enabled) {
      document.body?.setAttribute('data-private', privacyAttribute(false));
      return;
    }

    let lastActivity = Date.now();

    const evaluate = () => {
      const next = shouldBlur({
        enabled,
        hidden: document.hidden,
        idleMs: Date.now() - lastActivity,
        thresholdMs,
      });
      setBlurred((current) => (current === next ? current : next));
      document.body?.setAttribute('data-private', privacyAttribute(next));
    };

    const noteActivity = () => {
      lastActivity = Date.now();
      evaluate();
    };

    const events: (keyof WindowEventMap)[] = ['pointerdown', 'pointermove', 'keydown', 'wheel'];
    for (const name of events) window.addEventListener(name, noteActivity, { passive: true });
    document.addEventListener('visibilitychange', evaluate);
    // Idle grows without firing an event — this is the tick that notices.
    const interval = window.setInterval(evaluate, 5_000);

    evaluate();
    return () => {
      for (const name of events) window.removeEventListener(name, noteActivity);
      document.removeEventListener('visibilitychange', evaluate);
      window.clearInterval(interval);
      document.body?.setAttribute('data-private', privacyAttribute(false));
    };
  }, [enabled, thresholdMs]);

  return enabled ? blurred : false;
}
