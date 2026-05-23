import { ASK_ANYTHING_TEMPLATE } from './ask-anything';
import { TELL_ME_ABOUT_X_TEMPLATE } from './tell-me-about-x';
import { WHATS_NEW_SINCE_Y_TEMPLATE } from './whats-new-since-y';
import { TRACE_X_EVERYWHERE_TEMPLATE } from './trace-x-everywhere';
import type { CanvasTemplate } from './types';

export {
  ASK_ANYTHING_TEMPLATE,
  TELL_ME_ABOUT_X_TEMPLATE,
  WHATS_NEW_SINCE_Y_TEMPLATE,
  TRACE_X_EVERYWHERE_TEMPLATE,
};

export const TEMPLATES: CanvasTemplate[] = [
  ASK_ANYTHING_TEMPLATE,
  TELL_ME_ABOUT_X_TEMPLATE,
  WHATS_NEW_SINCE_Y_TEMPLATE,
  TRACE_X_EVERYWHERE_TEMPLATE,
];

export const TEMPLATES_BY_ID: Record<CanvasTemplate['id'], CanvasTemplate> = {
  'ask-anything':       ASK_ANYTHING_TEMPLATE,
  'tell-me-about-x':    TELL_ME_ABOUT_X_TEMPLATE,
  'whats-new-since-y':  WHATS_NEW_SINCE_Y_TEMPLATE,
  'trace-x-everywhere': TRACE_X_EVERYWHERE_TEMPLATE,
};

export const DEFAULT_TEMPLATE_ID: CanvasTemplate['id'] = 'ask-anything';

export type { CanvasTemplate };
export type { ShapePlacement, TemplateLayout, Slot } from './types';
