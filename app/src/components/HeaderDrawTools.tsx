import { Hand, MousePointer2, PenLine, Eraser } from 'lucide-react';
import { useUiStore } from '../state/ui-store';
import { getTools } from '../state/tools-ref';
import { HeaderIconButton } from './HeaderCanvasControls';

/**
 * Tldraw tool switcher in the header. Reads pressed state from
 * `ui-store.handToolActive` (mirrored by ToolsBridge so we don't need
 * a live tldraw subscription up here).
 *
 */
export function HeaderDrawTools() {
  const handActive = useUiStore((s) => s.handToolActive);

  const select = (id: string) => {
    const tools = getTools();
    if (!tools) return;
    tools.selectTool(id);
  };
  const currentId = (() => {
    const tools = getTools();
    return tools?.getCurrentToolId();
  })();

  return (
    <div className="flex items-center gap-1">
      <HeaderIconButton
        title="Select"
        pressed={!handActive && currentId === 'select'}
        onClick={() => select('select')}
      >
        <MousePointer2 className="size-3.5" />
      </HeaderIconButton>
      <HeaderIconButton
        title="Pan (hand)"
        pressed={handActive}
        onClick={() => select('hand')}
      >
        <Hand className="size-3.5" />
      </HeaderIconButton>
      <HeaderIconButton
        title="Draw"
        pressed={currentId === 'draw'}
        onClick={() => select('draw')}
      >
        <PenLine className="size-3.5" />
      </HeaderIconButton>
      <HeaderIconButton
        title="Eraser"
        pressed={currentId === 'eraser'}
        onClick={() => select('eraser')}
      >
        <Eraser className="size-3.5" />
      </HeaderIconButton>
    </div>
  );
}
