import {
  HTMLContainer,
  Rectangle2d,
  ShapeUtil,
  T,
  type RecordProps,
  type TLBaseShape,
} from 'tldraw';
import { CardFrame, CardHeader, CardTitle, Tag } from './shared';

type Column = {
  key: string;
  label?: string;
  /** tldraw runtime stores this as `string`; we narrow at render. */
  align?: string;
  mono?: boolean;
};

export type TableShape = TLBaseShape<
  'strata:table',
  {
    w: number;
    h: number;
    title: string;
    columns: Column[];
    rows: string[][];
    uri?: string;
  }
>;

export class TableShapeUtil extends ShapeUtil<TableShape> {
  static override type = 'strata:table' as const;

  static override props: RecordProps<TableShape> = {
    w: T.number,
    h: T.number,
    title: T.string,
    columns: T.arrayOf(
      T.object({
        key: T.string,
        label: T.optional(T.string),
        align: T.optional(T.string),
        mono: T.optional(T.boolean),
      }),
    ),
    rows: T.arrayOf(T.arrayOf(T.string)),
    uri: T.optional(T.string),
  };

  override getDefaultProps(): TableShape['props'] {
    return { w: 520, h: 280, title: 'Table', columns: [], rows: [] };
  }

  override getGeometry(shape: TableShape) {
    return new Rectangle2d({
      width: shape.props.w,
      height: shape.props.h,
      isFilled: true,
    });
  }

  override component(shape: TableShape) {
    const { columns, rows } = shape.props;
    return (
      <HTMLContainer>
        <CardFrame shape={shape}>
          <CardHeader>
            <CardTitle>{shape.props.title}</CardTitle>
            <Tag>{rows.length} {rows.length === 1 ? 'row' : 'rows'}</Tag>
          </CardHeader>
          <div className="strata-card-body" style={{ padding: 0 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr>
                  {columns.map((c, i) => (
                    <th
                      key={i}
                      style={{
                        textAlign: (c.align as 'left' | 'right' | 'center' | undefined) ?? 'left',
                        padding: '8px 12px',
                        fontWeight: 600,
                        fontSize: 10.5,
                        textTransform: 'uppercase',
                        letterSpacing: 0.04,
                        color: '#a1a1aa',
                        borderBottom: '1px solid var(--color-line)',
                        position: 'sticky',
                        top: 0,
                        background: 'var(--color-bg-3)',
                      }}
                    >
                      {c.label ?? c.key}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, ri) => (
                  <tr
                    key={ri}
                    style={{
                      borderBottom: '1px solid var(--color-line)',
                    }}
                  >
                    {columns.map((c, ci) => (
                      <td
                        key={ci}
                        style={{
                          padding: '7px 12px',
                          textAlign: (c.align as 'left' | 'right' | 'center' | undefined) ?? 'left',
                          fontFamily: c.mono
                            ? 'JetBrains Mono, ui-monospace, monospace'
                            : 'inherit',
                          fontSize: c.mono ? 11.5 : 12.5,
                          color: '#e4e4e7',
                          verticalAlign: 'top',
                        }}
                      >
                        {row[ci] ?? ''}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardFrame>
      </HTMLContainer>
    );
  }

  override indicator(shape: TableShape) {
    return <rect width={shape.props.w} height={shape.props.h} rx={12} />;
  }

  override canResize() {
    return true;
  }
}
