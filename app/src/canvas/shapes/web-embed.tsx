import type { SourcePill } from './shared';
import {
  HTMLContainer,
  Rectangle2d,
  ShapeUtil,
  T,
  type RecordProps,
  type TLBaseShape,
} from 'tldraw';
import { resizeBox } from 'tldraw';
import { CardActions, CardFrame, CardHeader, CardTitle, OpenUrlAction, Tag } from './shared';

export type WebEmbedShape = TLBaseShape<
  'opencanvas:web-embed',
  {
    w: number;
    h: number;
    url: string;
    title?: string;
    snippet?: string;
    source?: string;
    sources?: SourcePill[];
  }
>;

export class WebEmbedShapeUtil extends ShapeUtil<WebEmbedShape> {
  static override type = 'opencanvas:web-embed' as const;

  static override props: RecordProps<WebEmbedShape> = {
    w: T.number,
    h: T.number,
    url: T.string,
    title: T.optional(T.string),
    snippet: T.optional(T.string),
    source: T.optional(T.string),
    sources: T.optional(T.any),
  };

  override getDefaultProps(): WebEmbedShape['props'] {
    return { w: 480, h: 320, url: 'about:blank' };
  }

  override getGeometry(shape: WebEmbedShape) {
    return new Rectangle2d({
      width: shape.props.w,
      height: shape.props.h,
      isFilled: true,
    });
  }

  override component(shape: WebEmbedShape) {
    let host: string;
    try {
      host = new URL(shape.props.url).host || shape.props.url;
    } catch {
      host = shape.props.url;
    }
    const showSnippet = !!shape.props.snippet && shape.props.snippet.length > 0;
    return (
      <HTMLContainer>
        <CardFrame shape={shape}>
          <CardHeader>
            <CardTitle>{shape.props.title ?? host}</CardTitle>
            <Tag>{host}</Tag>
            <CardActions
              shape={shape}
              extras={<OpenUrlAction url={shape.props.url} />}
            />
          </CardHeader>
          {showSnippet ? (
            <div className="opencanvas-card-body" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <p style={{ margin: 0, color: 'var(--color-fg-2)' }}>{shape.props.snippet}</p>
              <a
                href={shape.props.url}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  color: '#c4b5fd',
                  fontSize: 12,
                  textDecoration: 'none',
                  borderTop: '1px solid rgba(63,63,70,0.5)',
                  paddingTop: 8,
                  marginTop: 'auto',
                }}
              >
                Open {host} ↗
              </a>
            </div>
          ) : (
            <div
              className="opencanvas-card-body"
              style={{ position: 'relative', padding: 0, display: 'flex' }}
            >
              <iframe
                src={shape.props.url}
                /* allow-scripts: most embeds need it.
                   allow-same-origin: lets the iframe access its OWN
                     origin's storage / fetch — needed for Maps,
                     TradingView, Notion embeds, etc.
                   allow-popups: clicking a link opens in a new tab
                     instead of trying to navigate the iframe.
                   allow-forms: search-bar embeds, login flows.
                   allow-popups-to-escape-sandbox: lets the popup
                     drop the sandbox so the new tab is a normal
                     browsing context. */
                sandbox="allow-scripts allow-same-origin allow-popups allow-forms allow-popups-to-escape-sandbox"
                referrerPolicy="no-referrer-when-downgrade"
                allow="autoplay; clipboard-write; encrypted-media; picture-in-picture"
                loading="lazy"
                style={{
                  border: 'none',
                  width: '100%',
                  height: '100%',
                  background: 'var(--color-bg)',
                  flex: 1,
                  borderBottomLeftRadius: 14,
                  borderBottomRightRadius: 14,
                }}
                onPointerDown={(e) => e.stopPropagation()}
                title={shape.props.title ?? host}
              />
              {/* X-Frame-Options escape hatch: many sites refuse to be
                  iframed and the widget appears blank. A floating
                  "open in browser" pill is always visible at the
                  bottom-right so users can recover. */}
              <a
                href={shape.props.url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                onPointerDown={(e) => e.stopPropagation()}
                className="opencanvas-web-embed-escape"
                title={`Open ${host} in a new tab`}
              >
                Open ↗
              </a>
            </div>
          )}
        </CardFrame>
      </HTMLContainer>
    );
  }

  override indicator(shape: WebEmbedShape) {
    return <rect width={shape.props.w} height={shape.props.h} rx={12} />;
  }

  override onResize(shape: WebEmbedShape, info: Parameters<typeof resizeBox>[1]) {
    return resizeBox(shape, info);
  }

  override canResize() {
    return true;
  }
}
