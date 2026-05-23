import type { CanvasSnapshotShape } from '../canvas/snapshot';

let current: CanvasSnapshotShape = {
  activeTemplateId: 'ask-anything',
  widgets: [],
};

export function setLatestSnapshot(snap: CanvasSnapshotShape): void {
  current = snap;
}

export function getLatestSnapshot(): CanvasSnapshotShape {
  return current;
}
