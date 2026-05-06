/**
 * Pure mutator for streaming-widget ops. Given current shape props +
 * one op, returns the next props. No side effects, no editor access.
 *
 * The dispatcher wires this to tldraw's editor.updateShape; tests can
 * call it directly with plain objects.
 *
 * Shape contract: the streaming-friendly mutations operate on a
 * `blocks: GenericBlock[]` array (matches the generic widget). For
 * shapes that don't have a blocks array, only `set-prop` makes sense.
 *
 * Failure mode: an op that targets the wrong block type (e.g.
 * append-rows into a markdown block) is logged + dropped, NOT thrown
 * — a runtime error mid-stream would surface as a tldraw store crash.
 */
import type { WidgetStreamOp } from '../../../src/agent/types';

type AnyBlock = { type: string; [k: string]: unknown };

/**
 * Apply one op to a props object. Returns a NEW props object
 * (immutable-style) so React/tldraw can detect the change cheaply via
 * reference equality. If the op is invalid for the current props
 * (wrong block type, out-of-range index), the mutator returns `null`
 * — the dispatcher should skip the updateShape call in that case.
 */
export function applyOp(
  props: Record<string, unknown>,
  op: WidgetStreamOp,
): Record<string, unknown> | null {
  switch (op.kind) {
    case 'append-text': {
      const blocks = readBlocks(props);
      const target = blocks[op.blockIndex];
      if (!target || target.type !== 'markdown') {
        warn(`append-text on non-markdown block (index=${op.blockIndex})`);
        return null;
      }
      const next = blocks.slice();
      next[op.blockIndex] = {
        ...target,
        content: ((target['content'] as string | undefined) ?? '') + op.text,
      };
      return { ...props, blocks: next };
    }

    case 'append-rows': {
      const blocks = readBlocks(props);
      const target = blocks[op.blockIndex];
      if (!target || target.type !== 'table') {
        warn(`append-rows on non-table block (index=${op.blockIndex})`);
        return null;
      }
      const next = blocks.slice();
      const existingRows = Array.isArray(target['rows'])
        ? (target['rows'] as string[][])
        : [];
      next[op.blockIndex] = {
        ...target,
        rows: [...existingRows, ...op.rows],
      };
      return { ...props, blocks: next };
    }

    case 'append-field': {
      const blocks = readBlocks(props);
      const target = blocks[op.blockIndex];
      if (!target || target.type !== 'kv') {
        warn(`append-field on non-kv block (index=${op.blockIndex})`);
        return null;
      }
      const next = blocks.slice();
      const existingFields = Array.isArray(target['fields'])
        ? (target['fields'] as Array<Record<string, unknown>>)
        : [];
      next[op.blockIndex] = {
        ...target,
        fields: [...existingFields, op.field],
      };
      return { ...props, blocks: next };
    }

    case 'append-block': {
      const blocks = readBlocks(props);
      return { ...props, blocks: [...blocks, op.block as AnyBlock] };
    }

    case 'replace-block': {
      const blocks = readBlocks(props);
      if (op.blockIndex < 0 || op.blockIndex >= blocks.length) {
        warn(`replace-block out of range (index=${op.blockIndex}, len=${blocks.length})`);
        return null;
      }
      const next = blocks.slice();
      next[op.blockIndex] = op.block as AnyBlock;
      return { ...props, blocks: next };
    }

    case 'set-prop': {
      if (op.path.length === 0) {
        warn('set-prop path is empty');
        return null;
      }
      return setIn(props, op.path, op.value) as Record<string, unknown>;
    }

    default: {
      const _exhaustive: never = op;
      warn(`unknown op kind: ${(_exhaustive as { kind: string }).kind}`);
      return null;
    }
  }
}

/**
 * Apply a batch of ops in order. Returns the final props (or `null` if
 * the very first op was invalid AND no later op succeeded). Used by
 * the dispatcher's rAF flush — collapses N ops into one updateShape.
 */
export function applyOps(
  props: Record<string, unknown>,
  ops: WidgetStreamOp[],
): Record<string, unknown> | null {
  let current = props;
  let touched = false;
  for (const op of ops) {
    const next = applyOp(current, op);
    if (next) {
      current = next;
      touched = true;
    }
  }
  return touched ? current : null;
}

/** Read the blocks array out of props in a defensive way. */
function readBlocks(props: Record<string, unknown>): AnyBlock[] {
  const v = props['blocks'];
  return Array.isArray(v) ? (v as AnyBlock[]) : [];
}

/**
 * Immutable deep-set. Walks `path`, copying objects/arrays at each
 * level so the returned tree shares structure with the input where
 * possible. Path elements can be strings (object keys) or numbers
 * (array indices). Missing intermediate keys are created as objects;
 * numeric path elements at missing keys create arrays.
 */
export function setIn(
  obj: unknown,
  path: ReadonlyArray<string | number>,
  value: unknown,
): unknown {
  if (path.length === 0) return value;
  const [head, ...rest] = path;
  const isArrayIndex = typeof head === 'number';
  const container =
    obj && typeof obj === 'object'
      ? Array.isArray(obj)
        ? (obj as unknown[]).slice()
        : { ...(obj as Record<string, unknown>) }
      : isArrayIndex
        ? []
        : {};
  if (isArrayIndex) {
    (container as unknown[])[head as number] = setIn(
      (container as unknown[])[head as number],
      rest,
      value,
    );
  } else {
    (container as Record<string, unknown>)[head as string] = setIn(
      (container as Record<string, unknown>)[head as string],
      rest,
      value,
    );
  }
  return container;
}

function warn(msg: string): void {
  console.warn(`[stream-mutator] ${msg}`);
}
