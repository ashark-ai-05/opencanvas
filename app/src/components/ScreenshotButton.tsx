import { useCallback, useState } from 'react';
import { Camera, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { toPng } from 'html-to-image';
import { getEditor } from '../state/editor-ref';

/**
 * Capture the current canvas viewport as a PNG and download it.
 *
 * Why this exists: every "wow" moment a user has on the canvas needs a
 * shareable artifact. They can already create a /share/<id> link, but
 * a link doesn't drop nicely on Twitter / Slack / a blog post — an
 * image does. The screenshot is the simplest way to give every visitor
 * a thing they can paste anywhere.
 *
 * Capture strategy:
 *   - Target the tldraw root element (`.tl-container`) — that's the
 *     visible canvas surface including widgets and background.
 *   - Use `html-to-image` (toPng) — it walks the DOM, inlines computed
 *     styles, rasterizes into a canvas, exports as a data URL. Works
 *     for the SVG + foreignObject combo our shapes use.
 *   - For tldraw's WebGL/canvas surface, we'd need to call
 *     `editor.getSvg(...)` + render that to PNG. v1 takes the simpler
 *     DOM-snapshot route; if widgets render via SVG/HTML (most do),
 *     it works fine.
 *
 * Failure modes:
 *   - CORS-tainted images from external CDNs in plugin iframes →
 *     html-to-image marks them as failing; we still produce a PNG
 *     with those tiles blanked out. Logged but not blocking.
 *   - Empty canvas → captures empty viewport (acceptable; the welcome
 *     widgets ensure first-visit captures have something).
 */
export function ScreenshotButton() {
  const [capturing, setCapturing] = useState(false);

  const handleScreenshot = useCallback(async () => {
    if (capturing) return;
    setCapturing(true);

    try {
      // Tldraw renders into a `.tl-container` element by convention.
      // Find it in the DOM. Fall back to the editor's root if the
      // class name ever changes.
      const target =
        (document.querySelector('.tl-container') as HTMLElement | null) ??
        (() => {
          const editor = getEditor();
          return editor
            ? (editor.getContainer() as unknown as HTMLElement)
            : null;
        })();

      if (!target) {
        toast.error('Could not find the canvas to capture.');
        setCapturing(false);
        return;
      }

      const dataUrl = await toPng(target, {
        cacheBust: true,
        // Skip third-party plugin iframes — they're cross-origin and
        // tainted-canvas-safe to render but read-back fails. Showing
        // the iframe area as blank is preferable to throwing.
        filter: (node) => {
          if (node instanceof HTMLIFrameElement) return false;
          return true;
        },
        // Higher pixel ratio = sharper share on retina displays + X cards.
        pixelRatio: 2,
        backgroundColor: '#0a0a0a',
      });

      // Convert dataURL → blob → download via anchor click. Works in
      // every browser without needing the File System Access API.
      const blob = await (await fetch(dataUrl)).blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const stamp = new Date()
        .toISOString()
        .replace(/[:.]/g, '-')
        .slice(0, 19);
      a.download = `opencanvas-${stamp}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      // Defer revoke so the click has time to consume the URL.
      setTimeout(() => URL.revokeObjectURL(url), 1000);

      toast.success('Screenshot saved.', {
        description: 'Drop the PNG anywhere — X, Slack, your blog.',
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.error('[screenshot] capture failed:', e);
      toast.error('Screenshot failed', { description: message });
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
