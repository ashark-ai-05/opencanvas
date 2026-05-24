import { useCallback, useEffect, useRef, useState } from 'react';
import { Mic, MicOff } from 'lucide-react';

/**
 * Microphone button for the chat input. Uses the browser's
 * SpeechRecognition API (`webkitSpeechRecognition` in Chromium /
 * Safari prefixes, `SpeechRecognition` in the spec). Streams
 * interim + final transcripts back to the chat input via the
 * `onTranscript` callback as the user speaks.
 *
 * UX:
 *   - Press once: starts listening. Button turns red + pulses.
 *   - Press again: stops listening. Final transcript stays in input.
 *   - On error or `end` event: stops listening; preserves whatever
 *     was captured so far.
 *
 * If the API isn't available (Firefox, older browsers), the button
 * renders nothing — no broken UX, the user can still type normally.
 *
 * Why a separate component: the Web Speech surface is finicky
 * (callbacks fire out of order, `end` fires on the same tick as
 * `result`, the constructor varies by vendor). Isolating it here
 * keeps Chat.tsx readable.
 */
interface BrowserSpeechRecognition {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
}

interface SpeechRecognitionEvent {
  resultIndex: number;
  results: ArrayLike<SpeechRecognitionResult>;
}

interface SpeechRecognitionResult {
  isFinal: boolean;
  readonly length: number;
  [index: number]: { transcript: string };
}

interface SpeechRecognitionErrorEvent {
  error: string;
  message?: string;
}

interface WindowWithSpeech extends Window {
  SpeechRecognition?: { new (): BrowserSpeechRecognition };
  webkitSpeechRecognition?: { new (): BrowserSpeechRecognition };
}

function getRecognitionCtor(): { new (): BrowserSpeechRecognition } | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as WindowWithSpeech;
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function VoiceInputButton({
  /**
   * Called whenever the recognition produces a new transcript chunk.
   * `text` is the FULL captured-this-session transcript (not a delta),
   * so the caller can replace the trailing portion of the input field
   * deterministically.
   */
  onTranscript,
  /** Called once when recording starts — for the parent to remember
   *  the input value at the time of start (so it can restore on stop). */
  onStart,
  /** Called when recording ends (manual stop, silence timeout, or error). */
  onEnd,
  disabled = false,
}: {
  onTranscript: (text: string) => void;
  onStart?: () => void;
  onEnd?: () => void;
  disabled?: boolean;
}) {
  const [supported] = useState(() => getRecognitionCtor() !== null);
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef<BrowserSpeechRecognition | null>(null);

  // Tear down recognition cleanly on unmount.
  useEffect(() => {
    return () => {
      try {
        recognitionRef.current?.abort();
      } catch {
        /* ignore */
      }
    };
  }, []);

  const start = useCallback(() => {
    const Ctor = getRecognitionCtor();
    if (!Ctor) return;
    const r = new Ctor();
    r.continuous = true;
    r.interimResults = true;
    r.lang = navigator.language || 'en-US';

    let finalSoFar = '';

    r.onstart = () => {
      setListening(true);
      onStart?.();
    };
    r.onresult = (event) => {
      // Accumulate finals, but always emit the latest interim too so
      // the user sees text show up live as they speak.
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i]!;
        const transcript = result[0]?.transcript ?? '';
        if (result.isFinal) {
          finalSoFar += (finalSoFar ? ' ' : '') + transcript.trim();
        } else {
          interim += transcript;
        }
      }
      const combined = (finalSoFar + (interim ? ' ' + interim.trim() : '')).trim();
      onTranscript(combined);
    };
    r.onerror = (event) => {
      // 'no-speech' fires when the user starts then stops without
      // saying anything; treat as a benign stop.
      if (event.error !== 'no-speech' && event.error !== 'aborted') {
        console.warn('[voice-input] recognition error:', event.error, event.message);
      }
    };
    r.onend = () => {
      setListening(false);
      recognitionRef.current = null;
      onEnd?.();
    };

    recognitionRef.current = r;
    try {
      r.start();
    } catch (e) {
      // start() throws "InvalidStateError" if called while already started;
      // happens during fast double-taps. Silently no-op.
      console.warn('[voice-input] start failed:', e);
      setListening(false);
      recognitionRef.current = null;
    }
  }, [onStart, onEnd, onTranscript]);

  const stop = useCallback(() => {
    try {
      recognitionRef.current?.stop();
    } catch {
      /* ignore */
    }
  }, []);

  if (!supported) return null;

  return (
    <button
      type="button"
      onClick={listening ? stop : start}
      disabled={disabled}
      aria-label={listening ? 'Stop voice input' : 'Speak'}
      title={listening ? 'Stop voice input' : 'Speak (browser voice → text)'}
      className="px-3 py-2.5 rounded-xl text-[var(--color-fg)] border border-white/8 transition-colors flex items-center justify-center"
      style={{
        background: listening
          ? 'rgba(244, 63, 94, 0.18)'
          : 'var(--color-bg-3, rgba(255,255,255,0.04))',
        borderColor: listening
          ? 'rgba(244, 63, 94, 0.5)'
          : 'rgba(255, 255, 255, 0.08)',
        color: listening ? '#fda4af' : 'inherit',
      }}
    >
      {listening ? (
        <MicOff
          className="size-4"
          style={{
            animation: 'opencanvas-pulse 1.4s ease-in-out infinite',
          }}
        />
      ) : (
        <Mic className="size-4" />
      )}
    </button>
  );
}
