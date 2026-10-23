/**
 * Dictation for one text field.
 *
 * Quick add on Today and the title field in the New task sheet should behave
 * exactly the same way — same language, same repair of what was heard, same
 * sentences when something goes wrong. Keeping that in a hook means the two
 * surfaces cannot drift apart, and the only thing either of them owns is where
 * the text goes.
 *
 * The hook composes: whatever was already in the field stays, and the spoken
 * words are appended to it. That is why the base is captured once, when
 * listening starts — the field is being rewritten on every interim result, and
 * reading it back would otherwise duplicate the words already appended.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  dictationErrorText,
  dictationSupported,
  ensureMicrophone,
  startDictation,
  type Dictation,
} from '../lib/speech';

export interface DictationController {
  /** False in browsers with no SpeechRecognition at all — hide the button. */
  supported: boolean;
  listening: boolean;
  /** One honest sentence about what the microphone is doing, or what it heard. */
  note: string | null;
  /** A failure worth showing even when the field already has text. */
  error: string | null;
  toggle: () => void;
  stop: () => void;
}

export function useDictation({
  value,
  onChange,
  lang,
  onFinish,
}: {
  /** The current text of the field. */
  value: string;
  onChange: (next: string) => void;
  /** BCP-47 tag; empty means “follow the device”. */
  lang?: string;
  /** Called once when listening ends — put the caret back in the field. */
  onFinish?: () => void;
}): DictationController {
  const [listening, setListening] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const session = useRef<Dictation | null>(null);
  const starting = useRef(false);
  const base = useRef('');
  const heard = useRef(false);
  const valueRef = useRef(value);
  const changeRef = useRef(onChange);
  const finishRef = useRef(onFinish);
  const langRef = useRef(lang);

  useEffect(() => {
    valueRef.current = value;
    changeRef.current = onChange;
    finishRef.current = onFinish;
    langRef.current = lang;
  }, [value, onChange, onFinish, lang]);

  const compose = useCallback((spoken: string) => {
    const prefix = base.current.trim();
    const next = `${prefix ? `${prefix} ` : ''}${spoken}`.replace(/\s+/g, ' ').trimStart();
    changeRef.current(next);
  }, []);

  const stop = useCallback(() => {
    session.current?.stop();
  }, []);

  const toggle = useCallback(() => {
    if (session.current) {
      session.current.stop();
      return;
    }
    if (starting.current) return;
    if (!dictationSupported()) {
      setNote(null);
      setError('This browser cannot dictate — type the line instead.');
      return;
    }
    setError(null);
    starting.current = true;
    void (async () => {
      try {
        /* The permission prompt belongs in front of the listener, not behind a
           generic recognition error a second later. */
        setNote('Checking the microphone…');
        const access = await ensureMicrophone();
        if (access === 'denied') {
          setNote(null);
          setError(dictationErrorText('not-allowed'));
          return;
        }
        if (access === 'missing') {
          setNote(null);
          setError(dictationErrorText('no-microphone'));
          return;
        }
        base.current = valueRef.current;
        heard.current = false;
        setNote('Listening… tap the mic when you are done.');
        setListening(true);
        session.current = startDictation({
          lang: langRef.current,
          onPartial: compose,
          onFinal: (text) => {
            heard.current = heard.current || text.trim().length > 0;
            compose(text);
          },
          onError: (kind) => {
            setNote(null);
            setError(dictationErrorText(kind));
          },
          onEnd: () => {
            session.current = null;
            setListening(false);
            setNote(heard.current ? 'Heard it — check the words before saving.' : null);
            finishRef.current?.();
          },
        });
      } catch {
        session.current = null;
        setListening(false);
        setNote(null);
        setError(dictationErrorText('unknown'));
      } finally {
        starting.current = false;
      }
    })();
  }, [compose]);

  useEffect(
    () => () => {
      session.current?.stop();
      session.current = null;
    },
    [],
  );

  return { supported: dictationSupported(), listening, note, error, toggle, stop };
}
