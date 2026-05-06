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
import { useState } from 'react';
import { CardActions, CardFrame, CardHeader, CardTitle, Tag } from './shared';

type FileNode = {
  name: string;
  type: 'file' | 'directory';
  children?: FileNode[];
  meta?: string;
  /** Optional source URL — when present on a file node, the row becomes
   *  a clickable link that opens the source in a new tab. */
  url?: string;
};

export type FileTreeShape = TLBaseShape<
  'opencanvas:file-tree',
  {
    w: number;
    h: number;
    title: string;
    root: FileNode;
    uri?: string;
    source?: string;
    sources?: SourcePill[];
  }
>;

// tldraw needs a runtime validator for nested structures. T.any is the
// pragmatic choice here — payloads come from the agent which is itself
// validated by the backend Zod schema (FileTreePayload) before reaching
// the dispatcher, so runtime shape is already guaranteed.
const FileNodeRuntime = T.any as never;

export class FileTreeShapeUtil extends ShapeUtil<FileTreeShape> {
  static override type = 'opencanvas:file-tree' as const;

  static override props: RecordProps<FileTreeShape> = {
    w: T.number,
    h: T.number,
    title: T.string,
    root: FileNodeRuntime,
    uri: T.optional(T.string),
    source: T.optional(T.string),
    sources: T.optional(T.any),
  };

  override getDefaultProps(): FileTreeShape['props'] {
    return {
      w: 360,
      h: 360,
      title: 'Files',
      root: { name: '/', type: 'directory', children: [] },
    };
  }

  override getGeometry(shape: FileTreeShape) {
    return new Rectangle2d({
      width: shape.props.w,
      height: shape.props.h,
      isFilled: true,
    });
  }

  override component(shape: FileTreeShape) {
    const fileCount = countFiles(shape.props.root);
    return (
      <HTMLContainer>
        <CardFrame shape={shape}>
          <CardHeader>
            <CardTitle>{shape.props.title}</CardTitle>
            <Tag>{fileCount} {fileCount === 1 ? 'file' : 'files'}</Tag>
            <CardActions shape={shape} />
          </CardHeader>
          <div className="opencanvas-card-body" style={{ paddingLeft: 8, paddingRight: 8 }}>
            <TreeNode node={shape.props.root} depth={0} initiallyOpen />
          </div>
        </CardFrame>
      </HTMLContainer>
    );
  }

  override indicator(shape: FileTreeShape) {
    return <rect width={shape.props.w} height={shape.props.h} rx={12} />;
  }

  override onResize(shape: FileTreeShape, info: Parameters<typeof resizeBox>[1]) {
    return resizeBox(shape, info);
  }

  override canResize() {
    return true;
  }
}

function countFiles(n: FileNode): number {
  if (n.type === 'file') return 1;
  return (n.children ?? []).reduce((acc, c) => acc + countFiles(c), 0);
}

function TreeNode({
  node,
  depth,
  initiallyOpen,
}: {
  node: FileNode;
  depth: number;
  initiallyOpen?: boolean;
}) {
  const isDir = node.type === 'directory';
  const [open, setOpen] = useState(initiallyOpen ?? depth < 2);
  const children = isDir ? node.children ?? [] : [];

  const fileUrl = !isDir && typeof node.url === 'string' ? node.url : null;
  const handleRowClick = (e: React.MouseEvent) => {
    if (isDir) {
      setOpen((o) => !o);
      return;
    }
    if (fileUrl) {
      e.stopPropagation();
      window.open(fileUrl, '_blank', 'noopener,noreferrer');
    }
  };
  const interactive = isDir || !!fileUrl;

  return (
    <div style={{ paddingLeft: depth === 0 ? 0 : 12 }}>
      <div
        onClick={interactive ? handleRowClick : undefined}
        onMouseDown={fileUrl ? (e) => e.stopPropagation() : undefined}
        onPointerDown={fileUrl ? (e) => e.stopPropagation() : undefined}
        title={fileUrl ?? undefined}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '2px 4px',
          borderRadius: 4,
          cursor: interactive ? 'pointer' : 'default',
          fontSize: 12.5,
          color: isDir ? '#fafafa' : '#d4d4d8',
          fontFamily: 'JetBrains Mono, ui-monospace, monospace',
          userSelect: 'none',
          transition: 'background 100ms ease',
        }}
        onMouseEnter={(e) => {
          if (interactive) e.currentTarget.style.background = 'rgba(255,255,255,0.04)';
        }}
        onMouseLeave={(e) => {
          if (interactive) e.currentTarget.style.background = 'transparent';
        }}
      >
        <span
          aria-hidden
          style={{
            display: 'inline-block',
            width: 10,
            color: '#52525b',
            transform: isDir && open ? 'rotate(90deg)' : 'rotate(0deg)',
            transition: 'transform 120ms ease',
          }}
        >
          {isDir ? '▶' : ' '}
        </span>
        <span style={{ color: isDir ? '#a78bfa' : '#71717a', fontSize: 11 }}>
          {isDir ? '📁' : '📄'}
        </span>
        <span
          style={{
            flex: 1,
            minWidth: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            color: fileUrl ? '#a5b4fc' : undefined,
          }}
        >
          {node.name}
        </span>
        {node.meta && (
          <span style={{ fontSize: 10.5, color: '#52525b' }}>{node.meta}</span>
        )}
        {fileUrl && (
          <span aria-hidden style={{ fontSize: 10, color: '#71717a' }}>
            ↗
          </span>
        )}
      </div>
      {isDir && open && children.length > 0 && (
        <div>
          {children.map((c, i) => (
            <TreeNode key={i} node={c} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}
