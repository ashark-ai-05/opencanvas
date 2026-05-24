import { useCallback, useState } from 'react';
import { Camera, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { getEditor } from '../state/editor-ref';
import { exportCanvasAsPng } from '../canvas/export';

/**
 * Capture the canvas as a PNG and download it.
 *
 * Uses tldraw's native `editor.toImage()` (via `exportCanvasAsPng`) — it
 * renders the canvas the same way the editor does, so we don't run into
 * the CORS-tainted-image failures that DOM rasterizers (html-to-image,
 * dom-to-image) hit when widgets reference external assets.
 */
export function ScreenshotButton() {
  const [capturing, setCapturing] = useState(false);

  const handleScreenshot = useCallback(async () => {
    if (capturing) return;
    setCapturing(true);

    try {
      const editor = getEditor();
      if (!editor) {
        toast.error('Canvas not ready yet.');
        return;
      }

      const stamp = new Date()
        .toISOString()
        .replace(/[:.]/g, '-')
        .slice(0, 19);
      const ok = await exportCanvasAsPng(editor, `opencanvas-${stamp}.png`);

      if (!ok) {
        toast.error('Nothing to capture', {
          description: 'Add a widget to the canvas first.',
        });
        return;
      }

      toast.success('Screenshot saved.', {
        description: 'Drop the PNG anywhere — X, Slack, your blog.',
      });
    } catch (e) {
      console.error('[screenshot] capture failed:', e);
      toast.error('Screenshot failed', { description: describeError(e) });
    } finally {
      setCapturing(false);
    }
  }, [capturing]);

  return (
    <button
      type="button"
      onClick={handleScreenshot}
      disabled={capturing}
      title="Save a PNG of the canvas"
      className="opencanvas-header-btn"
      aria-label="Save screenshot"
    >
      {capturing ? (
        <Loader2 className="size-3.5 animate-spin" />
      ) : (
        <Camera className="size-3.5" />
      )}
    </button>
  );
}

// Error objects come in many shapes — Errors with messages, Events from
// image/canvas load failures (no `.message`, `String()` gives the useless
// `[object Event]`), strings, and structured objects. Pick out something
// the user can act on, or admit the failure is opaque.
function describeError(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (e instanceof Event) {
    const target = e.target as { src?: string; nodeName?: string } | null;
    if (target?.src) return `Failed loading ${target.src}`;
    return `${e.type ?? 'error'} event from ${target?.nodeName ?? 'unknown'}`;
  }
  if (typeof e === 'string') return e;
  try {
    return JSON.stringify(e);
  } catch {
    return 'Unknown error';
  }
}
