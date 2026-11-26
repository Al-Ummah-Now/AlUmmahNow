import { waitFor } from '@testing-library/react';
import { createVideoPlayer } from '../videojs-setup';

// jsdom has a CSS object but does not implement CSS.supports, which Video.js checks on ready.
Object.defineProperty(window.CSS, 'supports', { configurable: true, value: () => false });

it.each([
  ['ar', '٠٪\u061c', '٣٨٪\u061c', '١٠٠٪\u061c'],
  ['en', '0%', '38%', '100%'],
] as const)('uses whole, localized percentages for Video.js load progress in %s', async (language, zero, partial, full) => {
  const video = document.createElement('video');
  video.load = jest.fn();
  document.body.append(video);
  const player = createVideoPlayer(video, { controls: true, language }) as ReturnType<typeof createVideoPlayer> & {
    bufferedEnd(): number;
    trigger(event: string): void;
  };
  try {
    const bar = player.el().querySelector<HTMLElement>('.vjs-load-progress')!;
    const text = bar.querySelector('.vjs-control-text-loaded-percentage');
    expect(text?.textContent).toBe(zero);

    jest.spyOn(player, 'duration').mockReturnValue(100);
    const bufferedEnd = jest.spyOn(player, 'bufferedEnd').mockReturnValue(37.67);
    player.trigger('progress');
    await waitFor(() => expect(text?.textContent).toBe(partial));
    expect(bar.style.width).toBe('37.67%');

    bufferedEnd.mockReturnValue(100);
    player.trigger('progress');
    await waitFor(() => expect(text?.textContent).toBe(full));
  } finally {
    player.dispose();
  }
});
