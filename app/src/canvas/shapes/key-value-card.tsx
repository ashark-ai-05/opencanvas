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
import { CardActions, CardBody, CardFrame, CardHeader, CardTitle, Tag } from './shared';

type KeyValuePair = { key: string; value: string };

export type KeyValueCardShape = TLBaseShape<
  'opencanvas:key-value-card',
  {
    w: number;
    h: number;
    title: string;
    fields: KeyValuePair[];
    uri?: string;
    source?: string;
    sources?: SourcePill[];
  }
>;

export class KeyValueCardShapeUtil extends ShapeUtil<KeyValueCardShape> {
  static override type = 'opencanvas:key-value-card' as const;

  static override props: RecordProps<KeyValueCardShape> = {
    w: T.number,
    h: T.number,
    title: T.string,
    fields: T.arrayOf(T.object({ key: T.string, value: T.string })),
    uri: T.optional(T.string),
    source: T.optional(T.string),
    sources: T.optional(T.any),
  };

  override getDefaultProps(): KeyValueCardShape['props'] {
    return { w: 320, h: 180, title: 'Untitled', fields: [] };
  }

  override getGeometry(shape: KeyValueCardShape) {
    return new Rectangle2d({
      width: shape.props.w,
      height: shape.props.h,
      isFilled: true,
    });
  }

  override component(shape: KeyValueCardShape) {
    return (
      <HTMLContainer>
        <CardFrame shape={shape}>
          <CardHeader>
            <CardTitle>{shape.props.title}</CardTitle>
            <Tag>data</Tag>
            <CardActions shape={shape} />
          </CardHeader>
          <CardBody>
            <dl
              style={{
                margin: 0,
                display: 'grid',
                gridTemplateColumns: 'minmax(80px, auto) 1fr',
                rowGap: 6,
                columnGap: 14,
              }}
            >
              {shape.props.fields.map((p, i) => (
                <Row
                  key={i}
                  k={p.key}
                  v={p.value}
                  url={(p as { url?: string }).url}
                />
              ))}
            </dl>
          </CardBody>
        </CardFrame>
      </HTMLContainer>
    );
  }

  override indicator(shape: KeyValueCardShape) {
    return <rect width={shape.props.w} height={shape.props.h} rx={12} />;
  }

  override onResize(shape: KeyValueCardShape, info: Parameters<typeof resizeBox>[1]) {
    return resizeBox(shape, info);
  }

  override canResize() {
    return true;
  }
}

function Row({ k, v, url }: { k: string; v: string; url?: string }) {
  return (
    <>
      <dt
        style={{
          color: 'var(--color-muted)',
          fontFamily: 'ui-monospace, monospace',
          fontSize: 12,
          letterSpacing: 0.02,
          alignSelf: 'baseline',
        }}
      >
        {k}
      </dt>
      <dd style={{ margin: 0, color: 'var(--color-fg)', wordBreak: 'break-word' }}>
        {url ? (
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            className="opencanvas-row-link"
            title={`Open ${url}`}
          >
            {v}
          </a>
        ) : (
          v
        )}
      </dd>
    </>
  );
}
