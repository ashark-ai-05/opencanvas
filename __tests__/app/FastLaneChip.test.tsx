import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { FastLaneChip } from '../../app/src/components/FastLaneChip';
import type { FastLaneView } from '../../app/src/hooks/useFastLane';

const base = (over: Partial<FastLaneView>): FastLaneView => ({
  ui: { kind: 'input' },
  resolved: null,
  options: null,
  promote: vi.fn(),
  choose: vi.fn(),
  dismiss: vi.fn(),
  ...over,
});

const resolved = {
  intent: 'timer' as const,
  kind: 'time' as const,
  label: 'Timer',
  icon: 'timer' as const,
  summary: 'Timer 25:00 · Focus',
  payload: { mode: 'timer', durationSec: 1500 },
};

describe('FastLaneChip', () => {
  it('renders nothing for input', () => {
    const { container } = render(<FastLaneChip view={base({})} />);
    expect(container).toBeEmptyDOMElement();
  });
  it('ghost shows the summary and the Tab hint', () => {
    render(<FastLaneChip view={base({ ui: { kind: 'ghost', intent: 'timer' }, resolved })} />);
    expect(screen.getByText('Timer 25:00 · Focus')).toBeInTheDocument();
    expect(screen.getByText(/place instantly/i)).toBeInTheDocument();
  });
  it('committed shows Enter / Mod+Enter hints and a dismiss button', () => {
    const view = base({ ui: { kind: 'committed', intent: 'timer' }, resolved });
    render(<FastLaneChip view={view} />);
    expect(screen.getByText(/ask model/i)).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText(/dismiss instant widget/i));
    expect(view.dismiss).toHaveBeenCalledTimes(1);
  });
  it('choose renders two options and forwards the pick', () => {
    const view = base({
      ui: { kind: 'choose', options: ['event', 'reminder'] },
      options: [
        { intent: 'event', label: 'Event' },
        { intent: 'reminder', label: 'Reminder' },
      ],
    });
    render(<FastLaneChip view={view} />);
    fireEvent.click(screen.getByRole('button', { name: 'Reminder' }));
    expect(view.choose).toHaveBeenCalledWith(1);
  });
  it('incomplete committed data says what is missing', () => {
    render(
      <FastLaneChip
        view={base({ ui: { kind: 'committed', intent: 'timer' }, resolved: { ...resolved, payload: null } })}
      />,
    );
    expect(screen.getByText(/add a duration/i)).toBeInTheDocument();
  });
});
