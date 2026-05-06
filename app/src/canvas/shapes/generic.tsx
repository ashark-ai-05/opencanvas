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
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  CardActions,
  CardBody,
  CardFrame,
  CardHeader,
  CardTitle,
  Tag,
  readStreaming,
} from './shared';

/**
 * Universal fallback widget. Renders a list of typed blocks (markdown,
 * table, kv, embed, json) in source order. The block schemas mirror the
 * specialized payloads — same field names, same semantics — so the
 * classifier can pull bits from any payload and stitch them together.
 *
 * tldraw's prop validator uses `T.any` for the blocks array because the
 * discriminated-union surface is too dynamic for the static validator
 * (and the agent-side zod schema already enforces shape correctness
 * before the directive ever reaches the dispatcher).
 */
type Column = {
  key: string;
  label?: string;
  align?: 'left' | 'right' | 'center';
  mono?: boolean;
};
type GenericBlock =
  | { type: 'markdown'; content: string }
  | {
      type: 'table';
      columns: Column[];
      rows: string[][];
      rowLinks?: Array<string | null>;
    }
  | {
      type: 'kv';
      fields: Array<{ key: string; value: string; url?: string }>;
    }
  | { type: 'embed'; url: string; height?: number }
  | { type: 'json'; data: unknown };

export type GenericShape = TLBaseShape<
  'opencanvas:generic',
  {
    w: number;
    h: number;
    title: string;
    subtitle?: string;
    blocks: GenericBlock[];
    uri?: string;
    source?: string;
    sources?: SourcePill[];
  }
>;

export class GenericShapeUtil extends ShapeUtil<GenericShape> {
  static override type = 'opencanvas:generic' as const;

  static override props: RecordProps<GenericShape> = {
    w: T.number,
    h: T.number,
    title: T.string,
    subtitle: T.optional(T.string),
    blocks: T.any,
    uri: T.optional(T.string),
    source: T.optional(T.string),
    sources: T.optional(T.any),
  };

  override getDefaultProps(): GenericShape['props'] {
    return {
      w: 380,
      h: 260,
      title: 'Widget',
      blocks: [{ type: 'markdown', content: '' }],
    };
  }

  override getGeometry(shape: GenericShape) {
    return new Rectangle2d({
      width: shape.props.w,
      height: shape.props.h,
      isFilled: true,
    });
  }

  override component(shape: GenericShape) {
    const blocks = Array.isArray(shape.props.blocks) ? shape.props.blocks : [];
    const streaming = readStreaming(shape.meta);
    const liveCount = streaming.active ? liveCounterFor(blocks) : null;
    return (
      <HTMLContainer>
        <CardFrame shape={shape}>
          <CardHeader>
            <CardTitle>{shape.props.title}</CardTitle>
            {streaming.active ? (
              <Tag>
                <span className="opencanvas-generic-streaming-pulse" />
                streaming{liveCount ? ` · ${liveCount}` : '…'}
              </Tag>
            ) : (
              <Tag>{labelForBlocks(blocks)}</Tag>
            )}
            <CardActions shape={shape} />
          </CardHeader>
          <CardBody>
            {shape.props.subtitle && (
              <div className="opencanvas-generic-subtitle">
                {shape.props.subtitle}
              </div>
            )}
            {streaming.error && (
              <div className="opencanvas-generic-error" title={streaming.error}>
                ⚠ stream interrupted — partial content shown
              </div>
            )}
            <div
              className="opencanvas-generic-blocks"
              data-streaming={streaming.active ? 'true' : 'false'}
            >
              {blocks.map((b, i) => (
                <BlockRenderer
                  key={i}
                  block={b}
                  streaming={streaming.active}
                  isLast={i === blocks.length - 1}
                />
              ))}
            </div>
          </CardBody>
        </CardFrame>
      </HTMLContainer>
    );
  }

  override indicator(shape: GenericShape) {
    return <rect width={shape.props.w} height={shape.props.h} rx={12} />;
  }

  override onResize(shape: GenericShape, info: Parameters<typeof resizeBox>[1]) {
    return resizeBox(shape, info);
  }

  override canResize() {
    return true;
  }
}

function labelForBlocks(blocks: GenericBlock[]): string {
  if (blocks.length === 0) return 'empty';
  if (blocks.length === 1) return blocks[0]!.type;
  return `${blocks.length} blocks`;
}

/**
 * Tiny progress hint shown in the header while streaming. Picks the
 * most informative metric from the most-recently-touched block.
 */
function liveCounterFor(blocks: GenericBlock[]): string | null {
  for (let i = blocks.length - 1; i >= 0; i--) {
    const b = blocks[i]!;
    if (b.type === 'markdown') {
      const len = b.content?.length ?? 0;
      if (len > 0) return `${len} chars`;
    } else if (b.type === 'table') {
      return `${b.rows?.length ?? 0} rows`;
    } else if (b.type === 'kv') {
      return `${b.fields?.length ?? 0} fields`;
    }
  }
  return null;
}

function BlockRenderer({
  block,
  streaming,
  isLast,
}: {
  block: GenericBlock;
  streaming: boolean;
  isLast: boolean;
}) {
  switch (block.type) {
    case 'markdown':
      return (
        <div
          className="opencanvas-generic-block opencanvas-markdown"
          data-streaming={streaming && isLast ? 'true' : 'false'}
        >
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{block.content}</ReactMarkdown>
          {streaming && isLast && (
            <span className="opencanvas-generic-caret" aria-hidden>
              ▍
            </span>
          )}
        </div>
      );
    case 'table':
      return <TableBlock block={block} streaming={streaming && isLast} />;
    case 'kv':
      return <KVBlock block={block} streaming={streaming && isLast} />;
    case 'embed':
      return <EmbedBlock block={block} />;
    case 'json':
      return <JsonBlock block={block} />;
    default: {
      // Unknown block type — render as JSON so nothing is silently lost.
      return <JsonBlock block={{ type: 'json', data: block }} />;
    }
  }
}

function TableBlock({
  block,
  streaming = false,
}: {
  block: Extract<GenericBlock, { type: 'table' }>;
  streaming?: boolean;
}) {
  const { columns, rows, rowLinks } = block;
  return (
    <div className="opencanvas-generic-block">
      <table className="opencanvas-generic-table">
        <thead>
          <tr>
            {columns.map((c, i) => (
              <th
                key={i}
                style={{
                  textAlign:
                    (c.align as 'left' | 'right' | 'center' | undefined) ?? 'left',
                  fontFamily: c.mono
                    ? 'JetBrains Mono, ui-monospace, monospace'
                    : 'inherit',
                }}
              >
                {c.label ?? c.key}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => {
            const link =
              Array.isArray(rowLinks) && typeof rowLinks[ri] === 'string'
                ? (rowLinks[ri] as string)
                : null;
            return (
              <tr
                key={ri}
                onClick={
                  link
                    ? (e) => {
                        e.stopPropagation();
                        window.open(link, '_blank', 'noopener,noreferrer');
                      }
                    : undefined
                }
                onPointerDown={link ? (e) => e.stopPropagation() : undefined}
                className={link ? 'opencanvas-table-row--linked' : undefined}
                style={{ cursor: link ? 'pointer' : undefined }}
              >
                {columns.map((c, ci) => (
                  <td
                    key={ci}
                    style={{
                      textAlign:
                        (c.align as 'left' | 'right' | 'center' | undefined) ??
                        'left',
                      fontFamily: c.mono
                        ? 'JetBrains Mono, ui-monospace, monospace'
                        : 'inherit',
                    }}
                  >
                    {row[ci] ?? ''}
                  </td>
                ))}
              </tr>
            );
          })}
          {streaming && (
            <tr className="opencanvas-generic-table-skeleton" aria-hidden>
              {columns.map((_, ci) => (
                <td key={ci}>
                  <span className="opencanvas-generic-skeleton-bar" />
                </td>
              ))}
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function KVBlock({
  block,
  streaming = false,
}: {
  block: Extract<GenericBlock, { type: 'kv' }>;
  streaming?: boolean;
}) {
  return (
    <dl
      className="opencanvas-generic-block opencanvas-generic-kv"
      data-streaming={streaming ? 'true' : 'false'}
    >
      {block.fields.map((f, i) => (
        <div key={i} className="opencanvas-generic-kv-row">
          <dt>{f.key}</dt>
          <dd>
            {f.url ? (
              <a
                href={f.url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                onPointerDown={(e) => e.stopPropagation()}
                className="opencanvas-row-link"
              >
                {f.value}
              </a>
            ) : (
              f.value
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function EmbedBlock({
  block,
}: {
  block: Extract<GenericBlock, { type: 'embed' }>;
}) {
  return (
    <div className="opencanvas-generic-block opencanvas-generic-embed">
      <iframe
        src={block.url}
        title={block.url}
        sandbox="allow-scripts allow-same-origin allow-popups"
        loading="lazy"
        style={{
          width: '100%',
          height: block.height ?? 240,
          border: 0,
          borderRadius: 6,
          background: 'rgba(255,255,255,0.02)',
        }}
        onPointerDown={(e) => e.stopPropagation()}
      />
      <div className="opencanvas-generic-embed-foot">
        <a
          href={block.url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
          className="opencanvas-row-link"
        >
          {block.url}
        </a>
      </div>
    </div>
  );
}

function JsonBlock({
  block,
}: {
  block: Extract<GenericBlock, { type: 'json' }>;
}) {
  let pretty: string;
  try {
    pretty = JSON.stringify(block.data, null, 2);
  } catch {
    pretty = String(block.data);
  }
  return (
    <pre className="opencanvas-generic-block opencanvas-generic-json">
      {pretty}
    </pre>
  );
}
