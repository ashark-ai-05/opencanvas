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

  it('shows the welcome banner when there are no messages', () => {
    render(<Chat />);
    // EmptyChatBanner displays one of two contextual titles depending
    // on whether the KB has been indexed yet. On a fresh instance it
    // renders the "get started" variant.
    expect(
      screen.getByText(
        /Ask anything to get started|Pick up where you left off/i,
      ),
    ).toBeInTheDocument();
  });
});
