import { create } from 'zustand';
import type { CanvasTemplate } from '../canvas/templates';
import { DEFAULT_TEMPLATE_ID } from '../canvas/templates';

type TemplateStore = {
  activeTemplateId: CanvasTemplate['id'];
  setActiveTemplateId: (id: CanvasTemplate['id']) => void;
};

export const useTemplateStore = create<TemplateStore>((set) => ({
  activeTemplateId: DEFAULT_TEMPLATE_ID,
  setActiveTemplateId: (id) => set({ activeTemplateId: id }),
}));
