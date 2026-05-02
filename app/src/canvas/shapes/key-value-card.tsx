import {
  HTMLContainer,
  Rectangle2d,
  ShapeUtil,
  T,
  type RecordProps,
  type TLBaseShape,
} from 'tldraw';
import { cardBody, cardFrame, cardHeader, CardTitle, tag } from './shared';

type KeyValuePair = { key: string; value: string };

export type KeyValueCardShape = TLBaseShape<
  'llm-wiki:key-value-card',
  {
    w: number;
    h: number;
    title: string;
    pairs: KeyValuePair[];
    uri?: string;
  }
>;

export class KeyValueCardShapeUtil extends ShapeUtil<KeyValueCardShape> {
  static override type = 'llm-wiki:key-value-card' as const;

  static override props: RecordProps<KeyValueCardShape> = {
    w: T.number,
    h: T.number,
    title: T.string,
    pairs: T.arrayOf(T.object({ key: T.string, value: T.string })),
    uri: T.optional(T.string),
  };

  override getDefaultProps(): KeyValueCardShape['props'] {
    return { w: 320, h: 180, title: 'Untitled', pairs: [] };
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
      <HTMLContainer style={{ ...cardFrame, width: shape.props.w, height: shape.props.h }}>
        <div style={cardHeader}>
          <CardTitle>{shape.props.title}</CardTitle>
          <span style={tag}>data</span>
        </div>
        <div style={cardBody}>
          <dl style={{ margin: 0, display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '4px 12px' }}>
            {shape.props.pairs.map((p, i) => (
              <FragmentRow key={i} k={p.key} v={p.value} />
            ))}
          </dl>
        </div>
      </HTMLContainer>
    );
  }

  override indicator(shape: KeyValueCardShape) {
    return <rect width={shape.props.w} height={shape.props.h} rx={8} />;
  }

  override canResize() {
    return true;
  }
}

function FragmentRow({ k, v }: { k: string; v: string }) {
  return (
    <>
      <dt style={{ color: '#71717a', fontFamily: 'ui-monospace, monospace', fontSize: 12 }}>{k}</dt>
      <dd style={{ margin: 0, color: '#fafafa', wordBreak: 'break-word' }}>{v}</dd>
    </>
  );
}
