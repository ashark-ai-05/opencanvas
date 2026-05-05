import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { Chat } from '../../app/src/components/Chat';

describe('Chat (smoke)', () => {
  it('renders input and send button', () => {
    render(<Chat />);
    expect(screen.getByPlaceholderText(/ask opencanvas anything/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/send/i)).toBeInTheDocument();
  });

  it('shows the welcome message when there are no messages', () => {
    render(<Chat />);
    expect(screen.getByText(/Ask anything about your knowledge/i)).toBeInTheDocument();
  });
});
