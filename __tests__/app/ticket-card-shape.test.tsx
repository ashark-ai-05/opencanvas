import { describe, it, expect } from 'vitest';
import { TicketCardShapeUtil } from '../../app/src/canvas/shapes/ticket-card';

describe('TicketCardShapeUtil', () => {
  it('declares opencanvas:ticket', () => {
    expect(TicketCardShapeUtil.type).toBe('opencanvas:ticket');
  });

  it('requires ticketId and title', () => {
    expect(TicketCardShapeUtil.props.ticketId).toBeDefined();
    expect(TicketCardShapeUtil.props.title).toBeDefined();
  });
});
