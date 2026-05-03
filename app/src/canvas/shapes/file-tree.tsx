import {
  HTMLContainer,
  Rectangle2d,
  ShapeUtil,
  T,
  type RecordProps,
  type TLBaseShape,
} from 'tldraw';
import { useState } from 'react';
import { CardFrame, CardHeader, CardTitle, Tag } from './shared';

type FileNode = {
  name: string;
  type: 'file' | 'directory';
  children?: FileNode[];
  meta?: string;
};

export type FileTreeShape = TLBaseShape<
  'strata:file-tree',
  {
    w: number;
    h: number;
    title: string;
    root: FileNode;
    uri?: string;
  }
>;

// tldraw needs a runtime validator for nested structures. T.any is the
// pragmatic choice here — payloads come from the agent which is itself
// validated by the backend Zod schema (FileTreePayload) before reaching
// the dispatcher, so runtime shape is already guaranteed.
const FileNodeRuntime = T.any as never;

export class FileTreeShapeUtil extends ShapeUtil<FileTreeShape> {
  static override type = 'strata:file-tree' as const;

  static override props: RecordProps<FileTreeShape> = {
    w: T.number,
    h: T.number,
    title: T.string,
    root: FileNodeRuntime,
    uri: T.optional(T.string),
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
          </CardHeader>
          <div className="strata-card-body" style={{ paddingLeft: 8, paddingRight: 8 }}>
            <TreeNode node={shape.props.root} depth={0} initiallyOpen />
          </div>
        </CardFrame>
      </HTMLContainer>
    );
  }

  override indicator(shape: FileTreeShape) {
    return <rect width={shape.props.w} height={shape.props.h} rx={12} />;
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

  return (
    <div style={{ paddingLeft: depth === 0 ? 0 : 12 }}>
      <div
        onClick={isDir ? () => setOpen((o) => !o) : undefined}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '2px 4px',
          borderRadius: 4,
          cursor: isDir ? 'pointer' : 'default',
          fontSize: 12.5,
          color: isDir ? '#fafafa' : '#d4d4d8',
          fontFamily: 'JetBrains Mono, ui-monospace, monospace',
          userSelect: 'none',
          transition: 'background 100ms ease',
        }}
        onMouseEnter={(e) => {
          if (isDir) e.currentTarget.style.background = 'rgba(255,255,255,0.04)';
        }}
        onMouseLeave={(e) => {
          if (isDir) e.currentTarget.style.background = 'transparent';
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
        <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {node.name}
        </span>
        {node.meta && (
          <span style={{ fontSize: 10.5, color: '#52525b' }}>{node.meta}</span>
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
