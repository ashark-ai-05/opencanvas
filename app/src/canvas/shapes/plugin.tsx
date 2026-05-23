import type { SourcePill } from './shared';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  HTMLContainer,
  Rectangle2d,
  ShapeUtil,
  T,
  type RecordProps,
  type TLBaseShape,
} from 'tldraw';
import { resizeBox } from 'tldraw';
import { CardActions, CardFrame, CardHeader, CardTitle, Tag } from './shared';
import { usePluginRegistry } from '../../state/plugin-registry-store';

/**
 * Plugin widget — renders a registered external kind in a sandboxed
 * iframe. The iframe's srcdoc comes from the registry descriptor; the
 * widget's `props` are bridged in two ways:
 *
 *   1. window.opencanvas.props is set BEFORE DOMContentLoaded by a
 *      tiny shim prepended to srcdoc. The plugin can read it
 *      synchronously on first paint.
 *   2. window.postMessage({ type: 'opencanvas:props', props }) on
 *      every prop change after first mount. Plugins listen for this
 *      to react to live updates (e.g. live-data refreshes).
 *
 * Sandbox is `allow-scripts` by default. Plugins can opt in to
 * additional flags (allow-same-origin, allow-forms, allow-popups)
 * via descriptor.renderer.sandbox — those are real security knobs
 * so we don't add them silently.
 */
export type PluginShape = TLBaseShape<
  'opencanvas:plugin',
  {
    w: number;
    h: number;
    pluginKind: string;
    props: Record<string, unknown>;
    title?: string;
    source?: string;
    sources?: SourcePill[];
  }
>;

export class PluginShapeUtil extends ShapeUtil<PluginShape> {
  static override type = 'opencanvas:plugin' as const;

  static override props: RecordProps<PluginShape> = {
    w: T.number,
    h: T.number,
    pluginKind: T.string,
    props: T.any,
    title: T.optional(T.string),
    source: T.optional(T.string),
    sources: T.optional(T.any),
  };

  override getDefaultProps(): PluginShape['props'] {
    return { w: 360, h: 240, pluginKind: '', props: {} };
  }

  override getGeometry(shape: PluginShape) {
    return new Rectangle2d({
      width: shape.props.w,
      height: shape.props.h,
      isFilled: true,
    });
  }

  override component(shape: PluginShape) {
    return <PluginBody shape={shape} />;
  }

  override indicator(shape: PluginShape) {
    return <rect width={shape.props.w} height={shape.props.h} rx={12} />;
  }

  override onResize(shape: PluginShape, info: Parameters<typeof resizeBox>[1]) {
    return resizeBox(shape, info);
  }

  override canResize() {
    return true;
  }
}

function PluginBody({ shape }: { shape: PluginShape }) {
  const { pluginKind, props, title } = shape.props;
  const descriptor = usePluginRegistry((s) => s.byKind[pluginKind]);
  const hydrated = usePluginRegistry((s) => s.hydrated);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [frameReady, setFrameReady] = useState(false);

  // Capture the props at first iframe mount. The shim bakes these in
  // as window.opencanvas.props synchronously; subsequent updates are
  // pushed via postMessage. We deliberately DON'T include `props` in
  // the srcdoc memo deps — re-deriving srcdoc on every prop change
  // would change the <iframe srcDoc> attribute, force a full reload,
  // and the page would flash white on every refresh tick (one of the
  // visible "flakiness" sources).
  const initialPropsRef = useRef(props);
  const srcdoc = useMemo(() => {
    if (!descriptor || descriptor.renderer.type !== 'iframe') return null;
    return wrapSrcdoc(descriptor.renderer.srcdoc, initialPropsRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [descriptor]);

  // After the iframe has loaded, push every prop update via postMessage
  // so the iframe re-renders in place — no reload, no flash.
  useEffect(() => {
    if (!frameReady) return;
    const win = iframeRef.current?.contentWindow;
    if (!win) return;
    win.postMessage({ type: 'opencanvas:props', props }, '*');
  }, [props, frameReady]);

  if (!descriptor) {
    return (
      <HTMLContainer>
        <CardFrame shape={shape}>
          <CardHeader>
            <CardTitle>{title ?? pluginKind}</CardTitle>
            <Tag>plugin</Tag>
            <CardActions shape={shape} />
          </CardHeader>
          <div className="opencanvas-card-body opencanvas-plugin-empty">
            {hydrated ? (
              <>
                <div className="opencanvas-plugin-empty-title">
                  Plugin not registered
                </div>
                <div className="opencanvas-plugin-empty-body">
                  No renderer for <code>{pluginKind}</code>. Register it via
                  <code>POST /v1/canvas/widget-kinds</code>.
                </div>
              </>
            ) : (
              <div className="opencanvas-plugin-empty-body">
                Loading plugin registry…
              </div>
            )}
          </div>
        </CardFrame>
      </HTMLContainer>
    );
  }

  return (
    <HTMLContainer>
      <CardFrame shape={shape}>
        <CardHeader>
          <CardTitle>{title ?? descriptor.label ?? pluginKind}</CardTitle>
          <Tag>{pluginKind}</Tag>
          <CardActions shape={shape} />
        </CardHeader>
        <div className="opencanvas-card-body opencanvas-plugin-body">
          <iframe
            ref={iframeRef}
            srcDoc={srcdoc ?? ''}
            sandbox={descriptor.renderer.sandbox ?? 'allow-scripts'}
            title={pluginKind}
            onLoad={() => setFrameReady(true)}
            onPointerDown={(e) => e.stopPropagation()}
            style={{
              width: '100%',
              height: '100%',
              border: 0,
              borderRadius: 6,
              background: 'rgba(255,255,255,0.02)',
            }}
          />
        </div>
      </CardFrame>
    </HTMLContainer>
  );
}

/**
 * Inject the prop bridge shim at the top of the user-supplied srcdoc.
 * The shim:
 *   - sets window.opencanvas.props synchronously so plugins can read
 *     props before DOMContentLoaded
 *   - listens for postMessage updates and re-emits them as a custom
 *     'opencanvas:props' DOM event on the document, so plugins can
 *     subscribe via document.addEventListener
 *   - keeps a back-reference to the latest props on
 *     window.opencanvas.props, replacing on each update
 */
function wrapSrcdoc(srcdoc: string, props: Record<string, unknown>): string {
  const initial = JSON.stringify(props);
  const shim = `
<script>
(function () {
  window.opencanvas = window.opencanvas || {};
  window.opencanvas.props = ${initial};
  window.addEventListener('message', function (event) {
    var data = event && event.data;
    if (!data || data.type !== 'opencanvas:props') return;
    window.opencanvas.props = data.props;
    document.dispatchEvent(new CustomEvent('opencanvas:props', { detail: data.props }));
  });
})();
</script>`;
  return shim + srcdoc;
}
