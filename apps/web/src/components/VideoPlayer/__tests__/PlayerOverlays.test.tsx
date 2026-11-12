/**
 * The end screen's countdown (docs/specs/VIDEO-PLAYER.md section 5, End screen): it runs in real
 * seconds, advances at zero, pauses on hover and on focus the viewer moves, stops on a key, a press,
 * Escape or Cancel, moves focus to Play now only from the body or the player, and is announced once.
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { AUTO_ADVANCE_SECONDS, EndScreen } from '../PlayerOverlays';
import { EN_TRANSLATIONS as en } from '@/lib/video/i18n/translations/en';

let clock = 0;

beforeEach(() => {
  jest.useFakeTimers();
  clock = 0;
  jest.spyOn(performance, 'now').mockImplementation(() => clock);
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
  document.body.innerHTML = '';
});

/** Advance the fake clock and the timers together, in the countdown's 100ms ticks */
function elapse(ms: number) {
  for (let t = 0; t < ms; t += 100) {
    act(() => {
      clock += 100;
      jest.advanceTimersByTime(100);
    });
  }
}

function renderEnd(opts: { upNext?: boolean } = {}) {
  const go = jest.fn();
  const onReplay = jest.fn();
  const upNext = opts.upNext === false ? null : { title: 'Next talk', channel: 'Channel', go };
  const view = render(
    <div className="video-js">
      <EndScreen upNext={upNext} onReplay={onReplay} t={en} dir="ltr" />
    </div>,
  );
  const seconds = () => screen.queryByText(/^[0-9]$/)?.textContent ?? null;
  return { go, onReplay, seconds, ...view };
}

describe('EndScreen', () => {
  it('the countdown running out is an automatic advance; Play now is the viewer\'s choice', () => {
    const { go } = renderEnd();
    elapse(AUTO_ADVANCE_SECONDS * 1000);
    expect(go).toHaveBeenCalledWith({ auto: true });
    const second = renderEnd();
    fireEvent.click(screen.getAllByTestId('player-play-next')[1]);
    expect(second.go).toHaveBeenCalledWith();
  });

  it('autoplay off: no countdown, and more videos beside Watch again', () => {
    const go = jest.fn();
    const pick = jest.fn();
    render(
      <div className="video-js">
        <EndScreen
          upNext={{ title: 'Next talk', channel: 'Channel', go }}
          onReplay={jest.fn()}
          suggestions={[{ id: 's1', title: 'Another talk', channel: 'C', go: pick }, { id: 's2', title: 'Third talk', channel: 'C', go: jest.fn() }, { id: 's3', title: 'Hidden', channel: 'C', go: jest.fn() }]}
          t={en}
          dir="ltr"
          autoAdvanceSeconds={0}
        />
      </div>,
    );
    elapse(10_000);
    expect(go).not.toHaveBeenCalled();
    expect(screen.queryByTestId('player-next-ring')).toBeNull();
    const items = screen.getAllByTestId('player-end-suggestion');
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveAccessibleName('Play Another talk');
    fireEvent.click(items[0]);
    expect(pick).toHaveBeenCalled();
    expect(screen.getByTestId('player-watch-again')).toBeInTheDocument();
  });

  it('suggestions wait while the countdown runs', () => {
    render(
      <div className="video-js">
        <EndScreen upNext={{ title: 'Next', channel: 'C', go: jest.fn() }} onReplay={jest.fn()} suggestions={[{ id: 's1', title: 'S', channel: 'C', go: jest.fn() }]} t={en} dir="ltr" />
      </div>,
    );
    expect(screen.queryByTestId('player-end-suggestions')).toBeNull();
    fireEvent.click(screen.getByTestId('player-cancel-next'));
    expect(screen.getByTestId('player-end-suggestions')).toBeInTheDocument();
  });

  it('counts real seconds and plays the next video at zero', () => {
    const { go, seconds } = renderEnd();
    expect(AUTO_ADVANCE_SECONDS).toBe(3);
    expect(seconds()).toBe(String(AUTO_ADVANCE_SECONDS));
    elapse(1_000);
    expect(seconds()).toBe(String(AUTO_ADVANCE_SECONDS - 1));
    expect(go).not.toHaveBeenCalled();
    elapse((AUTO_ADVANCE_SECONDS - 1) * 1000);
    expect(go).toHaveBeenCalledTimes(1);
    elapse(2_000);
    expect(go).toHaveBeenCalledTimes(1);
  });

  it('focuses Play now and announces the countdown once', () => {
    const { seconds } = renderEnd();
    expect(screen.getByTestId('player-play-next')).toHaveFocus();
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('Next video in 3 seconds');
    elapse(1_000);
    expect(seconds()).toBe('2');
    expect(status).toHaveTextContent('Next video in 3 seconds');
  });

  it('leaves focus alone when the viewer is elsewhere on the page', () => {
    const field = document.createElement('input');
    document.body.appendChild(field);
    field.focus();
    renderEnd();
    expect(field).toHaveFocus();
  });

  it('pauses while the pointer is on the card', () => {
    const { go, seconds } = renderEnd();
    const card = document.querySelector('.vjs-fanous-next-card')!;
    fireEvent.pointerEnter(card);
    elapse(10_000);
    expect(seconds()).toBe('3');
    expect(go).not.toHaveBeenCalled();
    fireEvent.pointerLeave(card);
    elapse(1_000);
    expect(seconds()).toBe('2');
  });

  it('pauses while focus the viewer moved is inside', () => {
    const { seconds } = renderEnd();
    act(() => screen.getByTestId('player-watch-again').focus());
    elapse(3_000);
    expect(seconds()).toBe('3');
  });

  it.each([
    ['a key', () => fireEvent.keyDown(screen.getByTestId('player-play-next'), { key: 'Tab' })],
    ['Escape', () => fireEvent.keyDown(screen.getByTestId('player-play-next'), { key: 'Escape' })],
    ['a press', () => fireEvent.pointerDown(screen.getByTestId('player-end-screen'))],
    ['Cancel', () => fireEvent.click(screen.getByTestId('player-cancel-next'))],
  ])('stops for %s and keeps the screen', (_name, act_) => {
    const { go, seconds } = renderEnd();
    act_();
    expect(seconds()).toBeNull();
    expect(screen.queryByTestId('player-cancel-next')).toBeNull();
    elapse(10_000);
    expect(go).not.toHaveBeenCalled();
    expect(screen.getByTestId('player-play-next')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('');
  });

  it('ignores a bare modifier key', () => {
    const { seconds } = renderEnd();
    fireEvent.keyDown(screen.getByTestId('player-play-next'), { key: 'Shift' });
    expect(seconds()).toBe('3');
  });

  it('Watch again stops the countdown and replays', () => {
    const { go, onReplay } = renderEnd();
    fireEvent.click(screen.getByTestId('player-watch-again'));
    expect(onReplay).toHaveBeenCalledTimes(1);
    elapse(10_000);
    expect(go).not.toHaveBeenCalled();
  });

  it('shows only Watch again without a next video', () => {
    const { onReplay } = renderEnd({ upNext: false });
    expect(screen.getAllByRole('button')).toHaveLength(1);
    fireEvent.click(screen.getByTestId('player-replay'));
    expect(onReplay).toHaveBeenCalled();
  });
});
