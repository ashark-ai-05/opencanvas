import { useEffect, useState } from 'react';
import { useUiStore } from '../state/ui-store';

/**
 * Slim 1px bar that lives at the very top of the floating chat. Pulses
 * a violet→fuchsia gradient while the agent is streaming, fades back
 * to a flat zinc line otherwise.
 *
 * Spec: REPLICATION-PROMPT.md §13 — `ChatStatusBar`.
 */
export function ChatStatusBar() {
  const busy = useUiStore((s) => s.chatBusy);
  const [linger, setLinger] = useState(false);

  // Hold the active state for 600ms after the stream ends so the
  // animation has time to read as "completed" rather than disappearing
  // the moment the last chunk lands.
  useEffect(() => {
    if (busy) {
      setLinger(true);
      return;
    }
    const t = setTimeout(() => setLinger(false), 600);
    return () => clearTimeout(t);
  }, [busy]);

  return (
    <div
      aria-hidden
      className={linger ? 'opencanvas-header-pulse' : ''}
      style={{
        height: 2,
        background: linger ? undefined : 'rgba(255,255,255,0.04)',
      }}
    />
  );
}
