import {
  Bell,
  CalendarDays,
  Calculator,
  Clock,
  ListChecks,
  Ruler,
  StickyNote,
  Timer,
  Watch,
  X,
} from 'lucide-react';
import type { ComponentType } from 'react';
import type { FastLaneView } from '../hooks/useFastLane';
import type { IconName } from '../intent/registry';
import type { CardIntent } from '../intent/types';

const ICONS: Record<IconName, ComponentType<{ className?: string }>> = {
  timer: Timer,
  stopwatch: Watch,
  clock: Clock,
  list: ListChecks,
  bell: Bell,
  calendar: CalendarDays,
  note: StickyNote,
  calculator: Calculator,
  ruler: Ruler,
};

/** What a committed-but-incomplete parse still needs. */
const MISSING: Record<CardIntent, string> = {
  timer: 'add a duration',
  stopwatch: '',
  clock: '',
  todo: 'add a second item',
  reminder: 'add what to remember',
  event: 'add a day or time',
  note: 'add the note text',
  calc: 'finish the expression',
  convert: 'name both units',
};

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
const MOD = isMac ? '⌘' : 'Ctrl';

/**
 * Live preview of what the fast lane will place. Presentational: every
 * action goes back through the FastLaneView callbacks.
 */
export function FastLaneChip({ view }: { view: FastLaneView }) {
  const { ui, resolved, options } = view;

  if (ui.kind === 'choose' && options) {
    return (
      <div className="opencanvas-fastlane-chip is-choose" role="group" aria-label="Did you mean">
        <span className="opencanvas-fastlane-muted">Did you mean</span>
        {options.map((o, i) => (
          <button
            key={o.intent}
            type="button"
            className="opencanvas-fastlane-option"
            onClick={() => view.choose(i as 0 | 1)}
          >
            {o.label}
          </button>
        ))}
        <span className="opencanvas-fastlane-muted"><kbd>←</kbd><kbd>→</kbd></span>
      </div>
    );
  }

  if ((ui.kind !== 'ghost' && ui.kind !== 'committed') || !resolved) return null;

  const Icon = ICONS[resolved.icon];
  const ghost = ui.kind === 'ghost';
  const incomplete = resolved.payload === null;

  return (
    <div
      className={`opencanvas-fastlane-chip ${ghost ? 'is-ghost' : 'is-committed'}`}
      role="status"
      aria-live="polite"
    >
      <Icon className="size-3" />
      <span className="opencanvas-fastlane-summary">{resolved.summary}</span>
      {incomplete ? (
        <span className="opencanvas-fastlane-muted">{MISSING[resolved.intent] || 'incomplete'}</span>
      ) : ghost ? (
        <span className="opencanvas-fastlane-muted"><kbd>⇥</kbd> place instantly</span>
      ) : (
        <span className="opencanvas-fastlane-muted">
          <kbd>↵</kbd> place · <kbd>{MOD}↵</kbd> ask model
        </span>
      )}
      <button
        type="button"
        className="opencanvas-fastlane-dismiss"
        onClick={view.dismiss}
        aria-label="Dismiss instant widget"
        title="Dismiss (Esc)"
      >
        <X className="size-3" />
      </button>
    </div>
  );
}
