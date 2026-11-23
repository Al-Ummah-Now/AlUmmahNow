import { act, render, screen } from '@testing-library/react';
import UndoToastHost from '../UndoToastHost';
import { dismissUndoToast, showUndoToast } from '@/lib/undo-toast';

describe('UndoToastHost scroll room', () => {
  afterEach(() => act(() => dismissUndoToast()));

  it('adds room at the page end while the toast shows, so the last item can scroll clear of it', () => {
    render(<UndoToastHost />);
    expect(screen.queryByTestId('t-room')).toBeNull();
    act(() => { showUndoToast({ message: 'Post deleted', dismissLabel: 'Dismiss', testId: 't' }); });
    const room = screen.getByTestId('t-room');
    expect(room).toHaveAttribute('aria-hidden', 'true');
    // jsdom lays nothing out: the toast measures 0, so the room is the 16px gap alone
    expect(room.style.height).toBe('16px');
    act(() => dismissUndoToast());
    expect(screen.queryByTestId('t-room')).toBeNull();
  });
});
