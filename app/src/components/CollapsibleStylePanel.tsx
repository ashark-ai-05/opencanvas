import { useState } from 'react';
import { ChevronLeft } from 'lucide-react';
import { DefaultStylePanel, DefaultStylePanelContent, useRelevantStyles } from 'tldraw';

/**
 * Replacement for tldraw's default StylePanel that's collapsible — the
 * default panel hogs ~220px of right-edge real estate even when nothing
 * is selected. We render the real panel inside a slide-in container
 * with a chevron tab; default state is collapsed so the canvas reads as
 * full-bleed.
 *
 * Spec: REPLICATION-PROMPT.md §13 — `CollapsibleStylePanel`.
 */
export function CollapsibleStylePanel() {
  const [open, setOpen] = useState(false);
  const styles = useRelevantStyles();
  // No selection → no relevant styles → don't render the chevron either,
  // so an empty canvas stays clean.
  if (!styles && !open) return null;

  return (
    <div className="opencanvas-style-panel" data-open={open ? 'true' : 'false'}>
      <button
        type="button"
        className="opencanvas-style-panel-toggle"
        title={open ? 'Hide style panel' : 'Show style panel'}
        onClick={() => setOpen((v) => !v)}
      >
        <ChevronLeft
          className="size-4"
          style={{
            transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
            transition: 'transform 160ms ease',
          }}
        />
      </button>
      {open && styles && (
        <DefaultStylePanel>
          <DefaultStylePanelContent styles={styles} />
        </DefaultStylePanel>
      )}
    </div>
  );
}
