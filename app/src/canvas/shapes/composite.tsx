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
  CopyAction,
  Tag,
  type SourcePill,
} from './shared';

/**
 * Composite shape — ONE card with multiple typed sections. Each section
 * has a `kind` (any non-composite widget kind) and a `payload` matching
 * that kind's schema. The renderer dispatches each section to a tiny
 * inline renderer; the underlying shape is one resizable card.
 *
 * Spec: REPLICATION-PROMPT.md §12 — composite cannot nest composite.
 */

type SectionKind =
  | 'markdown'
  | 'code-block'
  | 'ticket'
  | 'web-embed'
  | 'key-value-card'
  | 'table'
  | 'timeline'
  | 'file-tree'
  | 'tasks'
  | 'kanban'
  | 'sticky-note';

export type CompositeSection = {
  heading?: string;
  kind: SectionKind;
  payload: Record<string, unknown>;
};

export type CompositeShape = TLBaseShape<
  'strata:composite',
  {
    w: number;
    h: number;
    title: string;
    sections: CompositeSection[];
    source?: string;
    sources?: SourcePill[];
  }
>;

export class CompositeShapeUtil extends ShapeUtil<CompositeShape> {
  static override type = 'strata:composite' as const;

  static override props: RecordProps<CompositeShape> = {
    w: T.number,
    h: T.number,
    title: T.string,
    sections: T.any,
    source: T.optional(T.string),
    sources: T.optional(T.any),
  };

  override getDefaultProps(): CompositeShape['props'] {
    return { w: 480, h: 480, title: 'Composite', sections: [] };
  }

  override getGeometry(shape: CompositeShape) {
    return new Rectangle2d({
      width: shape.props.w,
      height: shape.props.h,
      isFilled: true,
    });
  }

  override component(shape: CompositeShape) {
    const sections = Array.isArray(shape.props.sections)
      ? shape.props.sections
      : [];
    const fullText = sections
      .map((s) => `${s.heading ? `# ${s.heading}\n` : ''}${describeSection(s)}`)
      .join('\n\n');

    return (
      <HTMLContainer>
        <CardFrame shape={shape}>
          <CardHeader>
            <CardTitle>{shape.props.title}</CardTitle>
            <Tag accent>{sections.length} sections</Tag>
            <CardActions
              shape={shape}
              extras={<CopyAction text={fullText} label="composite" />}
            />
          </CardHeader>
          <CardBody>
            <div className="strata-composite">
              {sections.map((section, i) => (
                <div key={i} className="strata-composite-section">
                  {section.heading && (
                    <div className="strata-composite-section-heading">
                      {section.heading}
                    </div>
                  )}
                  <SectionRenderer section={section} />
                </div>
              ))}
            </div>
          </CardBody>
        </CardFrame>
      </HTMLContainer>
    );
  }

  override indicator(shape: CompositeShape) {
    return <rect width={shape.props.w} height={shape.props.h} rx={12} />;
  }

  override onResize(shape: CompositeShape, info: Parameters<typeof resizeBox>[1]) {
    return resizeBox(shape, info);
  }

  override canResize() {
    return true;
  }
}

function describeSection(section: CompositeSection): string {
  const p = section.payload as Record<string, unknown>;
  switch (section.kind) {
    case 'markdown':
      return String(p['body'] ?? '');
    case 'code-block':
      return String(p['code'] ?? '');
    case 'ticket':
      return `${String(p['ticketId'])} ${String(p['title'])} (${String(p['status'])})`;
    case 'key-value-card': {
      const fields = Array.isArray(p['fields']) ? p['fields'] : [];
      return fields
        .map((f) => {
          const fr = f as Record<string, unknown>;
          return `${fr['key']}: ${fr['value']}`;
        })
        .join('\n');
    }
    default:
      try {
        return JSON.stringify(p, null, 2);
      } catch {
        return '';
      }
  }
}

function SectionRenderer({ section }: { section: CompositeSection }) {
  const p = section.payload as Record<string, unknown>;
  switch (section.kind) {
    case 'markdown':
      return (
        <div className="strata-markdown">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {String(p['body'] ?? '')}
          </ReactMarkdown>
        </div>
      );
    case 'code-block':
      return (
        <pre className="strata-codeblock">
          <code>{String(p['code'] ?? '')}</code>
        </pre>
      );
    case 'ticket':
      return (
        <div className="strata-composite-ticket">
          <strong>{String(p['ticketId'] ?? '')}</strong> —{' '}
          <span>{String(p['title'] ?? '')}</span>
          <div className="strata-tag-row">
            <Tag>{String(p['status'] ?? '')}</Tag>
            {p['priority'] !== undefined && <Tag>{String(p['priority'])}</Tag>}
            {p['assignee'] !== undefined && <Tag>{String(p['assignee'])}</Tag>}
          </div>
          {p['description'] !== undefined && (
            <div className="strata-markdown">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {String(p['description'])}
              </ReactMarkdown>
            </div>
          )}
        </div>
      );
    case 'key-value-card': {
      const fields = Array.isArray(p['fields']) ? p['fields'] : [];
      return (
        <table className="strata-kv">
          <tbody>
            {fields.map((f, i) => {
              const fr = f as { key: string; value: string; url?: string };
              return (
                <tr key={i}>
                  <td className="strata-kv-key">{fr.key}</td>
                  <td className="strata-kv-value">
                    {fr.url ? (
                      <a href={fr.url} target="_blank" rel="noopener noreferrer">
                        {fr.value}
                      </a>
                    ) : (
                      fr.value
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      );
    }
    case 'web-embed':
      return (
        <a
          className="strata-web-embed-link"
          href={String(p['url'] ?? '#')}
          target="_blank"
          rel="noopener noreferrer"
        >
          {String(p['title'] ?? p['url'])}
        </a>
      );
    default:
      return (
        <pre className="strata-composite-fallback">
          {JSON.stringify(p, null, 2)}
        </pre>
      );
  }
}
