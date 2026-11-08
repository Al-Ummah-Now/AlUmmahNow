/**
 * Embed frames and the watch page share dialog (docs/embeds/README.md).
 */
import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import EmbedPlayer from '../EmbedPlayer';
import UnavailableFrame from '../UnavailableFrame';
import ShareDialog from '@/components/video/ShareDialog';
import { parseEmbedParams } from '@/lib/embed/params';
import type { EmbedVideo } from '@/lib/embed/content';

jest.mock('@/lib/logger-client', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));

// The real player needs Video.js + MSE; record the props the frame passes instead
jest.mock('@/components/VideoPagePlayer/VideoPlayerWithChapters', () => ({
  VideoPlayerWithChapters: (props: Record<string, unknown>) => (
    <div
      data-testid="mock-player"
      data-video={String(props.videoId)}
      data-start={String(props.startTime)}
      data-muted={String(props.muted)}
      data-autoplay={String(props.autoplay)}
      data-lang={String(props.lang)}
      data-context={JSON.stringify(props.analyticsContext)}
      data-websocket={String(props.enableWebSocket)}
    />
  ),
}));

const video = (id: string, extra: Partial<EmbedVideo> = {}): EmbedVideo => ({
  id,
  title: `Title ${id}`,
  titleLocalized: { en: `Title ${id}`, ar: `عنوان ${id}` },
  playUrl: `https://vz.example/${id}/playlist.m3u8`,
  poster: `https://vz.example/${id}/thumbnail.jpg`,
  duration: 75,
  channelName: 'QA Channel',
  ...extra,
});

const postMessage = jest.fn();
const realParent = window.parent;

function embedInto(referrer: string) {
  Object.defineProperty(window, 'parent', { configurable: true, value: { postMessage } });
  Object.defineProperty(document, 'referrer', { configurable: true, value: referrer });
}

afterEach(() => {
  postMessage.mockReset();
  Object.defineProperty(window, 'parent', { configurable: true, value: realParent });
  Object.defineProperty(document, 'referrer', { configurable: true, value: '' });
});

describe('EmbedPlayer', () => {
  it('shows a facade first and loads the player on press, at the start position', () => {
    render(<EmbedPlayer videos={[video('v1')]} params={parseEmbedParams({ start: '30' })} />);
    expect(screen.queryByTestId('mock-player')).toBeNull();
    expect(screen.getByTestId('embed-title')).toHaveTextContent('Title v1');
    expect(screen.getByTestId('embed-watch-link')).toHaveAttribute('href', '/en/video/v1?t=30');
    expect(screen.getByTestId('embed-watch-link')).toHaveAttribute('target', '_blank');

    fireEvent.click(screen.getByTestId('embed-facade'));
    const player = screen.getByTestId('mock-player');
    expect(player).toHaveAttribute('data-start', '30');
    expect(player).toHaveAttribute('data-autoplay', 'true');
    expect(player).toHaveAttribute('data-muted', 'false');
    expect(player).toHaveAttribute('data-websocket', 'false');
  });

  it('autoplay=1 loads the player at once, muted, tagged as an embed view', () => {
    embedInto('https://www.alummahnow.net/articles/eid');
    render(<EmbedPlayer videos={[video('v1')]} params={parseEmbedParams({ autoplay: '1' })} />);
    const player = screen.getByTestId('mock-player');
    expect(player).toHaveAttribute('data-muted', 'true');
    expect(JSON.parse(player.getAttribute('data-context')!)).toEqual({ source: 'embed', embedOrigin: 'https://www.alummahnow.net' });
  });

  it('renders Arabic right to left with the Arabic title', () => {
    render(<EmbedPlayer videos={[video('v1')]} params={parseEmbedParams({ lang: 'ar' })} />);
    const main = screen.getByTestId('embed-player');
    expect(main).toHaveAttribute('dir', 'rtl');
    expect(main).toHaveAttribute('lang', 'ar');
    expect(screen.getByTestId('embed-title')).toHaveTextContent('عنوان v1');
    expect(screen.getByTestId('embed-watch-link')).toHaveTextContent('شاهد على الأمة الآن');
  });

  it('posts ready to the embedding origin only', () => {
    embedInto('https://host.example/page?x=1');
    render(<EmbedPlayer videos={[video('v1')]} params={parseEmbedParams({})} />);
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'aun:v1:event', event: 'ready', videoId: 'v1', duration: 75 }),
      'https://host.example',
    );
  });

  it('answers commands only from the partner origin', () => {
    embedInto('https://host.example/page');
    render(<EmbedPlayer videos={[video('v1')]} params={parseEmbedParams({})} />);
    postMessage.mockClear();
    const send = (origin: string) => act(() => {
      const event = new MessageEvent('message', { data: { type: 'aun:v1:command', command: 'play' }, origin });
      Object.defineProperty(event, 'source', { value: window.parent });
      window.dispatchEvent(event);
    });
    send('https://evil.example');
    expect(screen.queryByTestId('mock-player')).toBeNull();
    send('https://host.example');
    expect(screen.getByTestId('mock-player')).toBeInTheDocument();
  });

  it('plays a playlist from the requested index and lists its videos', () => {
    render(
      <EmbedPlayer
        videos={[video('a'), video('b'), video('c')]}
        params={parseEmbedParams({ index: '1' })}
        playlist={{ id: 'p1', title: 'Series' }}
      />,
    );
    expect(screen.getByTestId('embed-player')).toHaveAttribute('data-video-id', 'b');
    fireEvent.click(screen.getByTestId('embed-playlist-toggle'));
    const list = screen.getByTestId('embed-playlist');
    expect(list).toHaveTextContent('Series');
    fireEvent.click(screen.getByText('Title c'));
    expect(screen.getByTestId('mock-player')).toHaveAttribute('data-video', 'c');
  });
});

describe('UnavailableFrame', () => {
  it('shows the localized unavailable frame and reports it to the parent', () => {
    embedInto('https://host.example/');
    render(<UnavailableFrame lang="ar" origin={null} contentId="private1" />);
    const frame = screen.getByTestId('embed-unavailable');
    expect(frame).toHaveAttribute('dir', 'rtl');
    expect(frame).toHaveTextContent('هذا الفيديو غير متاح');
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'error', videoId: 'private1', error: { code: 'unavailable' } }),
      'https://host.example',
    );
  });
});

describe('ShareDialog', () => {
  const writeText = jest.fn().mockResolvedValue(undefined);
  beforeAll(() => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  });
  beforeEach(() => writeText.mockClear());

  const open = (time = 0) => {
    render(<ShareDialog videoId="v1" title="Tafsir" lang="en" getCurrentTime={() => time} />);
    fireEvent.click(screen.getByTestId('share-button'));
  };

  it('copies the watch link', async () => {
    open();
    const link = `${window.location.origin}/en/video/v1`;
    expect(screen.getByTestId('share-link')).toHaveValue(link);
    await act(async () => { fireEvent.click(screen.getByTestId('share-copy-link')); });
    expect(writeText).toHaveBeenCalledWith(link);
    expect(screen.getByTestId('share-copy-link')).toHaveTextContent('Copied');
  });

  it('copies the link at the current time when asked', async () => {
    open(754.4);
    fireEvent.click(screen.getByTestId('share-at-time'));
    expect(screen.getByText('Start at 12:34')).toBeInTheDocument();
    await act(async () => { fireEvent.click(screen.getByTestId('share-copy-link')); });
    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/en/video/v1?t=754`);
  });

  it('copies the 560×315 embed snippet by default and the responsive one on request', async () => {
    open();
    const src = `${window.location.origin}/embed/v/v1`;
    await act(async () => { fireEvent.click(screen.getByTestId('share-copy-embed')); });
    expect(writeText).toHaveBeenLastCalledWith(expect.stringContaining(`<iframe src="${src}" width="560" height="315"`));
    fireEvent.click(screen.getByTestId('share-size-responsive'));
    await act(async () => { fireEvent.click(screen.getByTestId('share-copy-embed')); });
    expect(writeText).toHaveBeenLastCalledWith(expect.stringContaining('aspect-ratio:16/9'));
  });
});
