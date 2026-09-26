import { Sparkles } from 'lucide-react';

export type LocalNoteMeta = { local: 'fast-lane'; originalText: string };

/** True for the transcript line a fast-lane placement leaves behind. */
export function isLocalNote(m: { metadata?: unknown }): m is { metadata: LocalNoteMeta } {
  const meta = m.metadata as Partial<LocalNoteMeta> | undefined;
  return meta?.local === 'fast-lane' && typeof meta.originalText === 'string';
}

/** Messages that must never be sent to the model or indexed. */
export function notLocalNote<T extends { metadata?: unknown }>(m: T): boolean {
  return !isLocalNote(m);
}

/** The subset of `msgs` that may leave the client — sent to the model or indexed. */
export function outboundMessages<T extends { metadata?: unknown }>(msgs: readonly T[]): T[] {
  return msgs.filter(notLocalNote);
}

export function FastLaneNote({ text, onAsk }: { text: string; onAsk: (text: string) => void }) {
  return (
    <div className="opencanvas-fastlane-note">
      <button type="button" onClick={() => onAsk(text)} className="opencanvas-fastlane-note-ask">
        <Sparkles className="size-3" /> Ask the model instead
      </button>
    </div>
  );
}
