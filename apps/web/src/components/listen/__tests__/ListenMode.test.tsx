import React, { useState } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ListenAudioProvider } from '../ListenAudioProvider';
import { ListenModeSwitch } from '@/components/VideoPagePlayer/ListenModeSwitch';

let mockLang: 'en' | 'ar' = 'en';
let mockFeatures: Record<string, boolean> = { listenMode: false };

jest.mock('@/hooks/useLanguage', () => ({
  useLanguage: () => {
    const en = jest.requireActual('@/lib/i18n/translations/en').EN_TRANSLATIONS;
    const ar = jest.requireActual('@/lib/i18n/translations/ar').AR_TRANSLATIONS;
    return { t: mockLang === 'ar' ? ar : en, lang: mockLang, isRTL: mockLang === 'ar' };
  },
}));

jest.mock('@/hooks/useFeatures', () => ({
  useFeatures: () => ({ ready: true, features: mockFeatures }),
}));

const mockFetchVideoAudio = jest.fn();
jest.mock('@/lib/listen/audio-client', () => ({
  fetchVideoAudio: (...args: unknown[]) => mockFetchVideoAudio(...args),
}));

jest.mock('@/components/common/AppLink', () => ({
  __esModule: true,
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

function Harness({
  onPauseVideo = jest.fn(),
  onResumeVideo = jest.fn(),
}: {
  onPauseVideo?: jest.Mock;
  onResumeVideo?: jest.Mock;
}) {
  const [listenView, setListenView] = useState(false);
  return (
    <ListenAudioProvider>
      <ListenModeSwitch
        videoId="vid-42"
        title={mockLang === 'ar' ? 'سورة الكهف' : 'Surah Al-Kahf'}
        channelName={mockLang === 'ar' ? 'القارئ' : 'Reciter'}
        thumbnailUrl="https://cdn.example/thumb.jpg"
        fallbackPlayUrl="https://cdn.example/master.m3u8"
        duration={600}
        getVideoPlaybackState={() => ({ currentTime: 125, playbackRate: 1.5 })}
        pauseVideo={onPauseVideo}
        resumeVideoAt={onResumeVideo}
        isListenView={listenView}
        onListenViewChange={setListenView}
      />
    </ListenAudioProvider>
  );
}

describe('Web Listen mode & persistent mini bar (E14-S6)', () => {
  beforeEach(() => {
    mockLang = 'en';
    mockFeatures = { listenMode: false };
    mockFetchVideoAudio.mockReset();
    mockFetchVideoAudio.mockResolvedValue({
      videoId: 'vid-42',
      format: 'm4a',
      url: 'https://media.alummahnow.test/pub/vid-42/r1/audio.m4a',
      contentType: 'audio/mp4',
      extracting: false,
    });
    jest.spyOn(window.HTMLMediaElement.prototype, 'play').mockImplementation(() => Promise.resolve());
    jest.spyOn(window.HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('renders nothing at all when listenMode feature switch is OFF', () => {
    render(<Harness />);
    expect(screen.queryByTestId('watch-listen-controls')).toBeNull();
    expect(screen.queryByTestId('listen-mini-bar')).toBeNull();
    expect(screen.queryByTestId('listen-audio-element')).toBeNull();
  });

  it('switches to Listen mode preserving timestamp & speed, shows mini bar, sleep timer, and queue, and returns to video', async () => {
    mockFeatures = { listenMode: true };
    const onPauseVideo = jest.fn();
    const onResumeVideo = jest.fn();

    render(<Harness onPauseVideo={onPauseVideo} onResumeVideo={onResumeVideo} />);
    fireEvent.click(screen.getByTestId('watch-listen-toggle'));

    await waitFor(() => expect(screen.getByTestId('watch-listen-card')).toBeInTheDocument());
    expect(onPauseVideo).toHaveBeenCalledTimes(1);
    expect(mockFetchVideoAudio).toHaveBeenCalledWith('vid-42');

    // Persistent mini bar appears with preserved 1.5× speed
    const miniBar = screen.getByTestId('listen-mini-bar');
    expect(miniBar).toBeInTheDocument();
    expect(screen.getByTestId('listen-speed-button').textContent).toContain('1.5×');

    // Sleep timer popover works
    fireEvent.click(screen.getByTestId('listen-sleep-button'));
    expect(screen.getByTestId('listen-sleep-popover')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('listen-sleep-15'));
    expect(screen.getByTestId('listen-sleep-remaining').textContent).toBe('15:00');

    // Queue drawer opens cleanly
    fireEvent.click(screen.getByTestId('listen-queue-button'));
    expect(screen.getByTestId('listen-queue-empty')).toBeInTheDocument();

    // Returning to video restores timestamp and speed
    fireEvent.click(screen.getByTestId('watch-video-toggle'));
    expect(onResumeVideo).toHaveBeenCalledWith(125, 1.5);
  });

  it('uses Arabic copy with «مرئي» and Eastern Arabic digits (٠–٩) in ar locale', async () => {
    mockLang = 'ar';
    mockFeatures = { listenMode: true };
    render(<Harness />);

    fireEvent.click(screen.getByTestId('watch-listen-toggle'));
    await waitFor(() => expect(screen.getByTestId('watch-listen-card')).toBeInTheDocument());

    const card = screen.getByTestId('watch-listen-card');
    expect(card.textContent).toContain('مشاهدة المرئي');
    expect(card.textContent).not.toContain('فيديو');

    const speedBtn = screen.getByTestId('listen-speed-button');
    expect(speedBtn.textContent).toContain('١.٥×');

    fireEvent.click(screen.getByTestId('listen-sleep-button'));
    expect(screen.getByTestId('listen-sleep-15').textContent).toContain('١٥');
    expect(screen.getByTestId('listen-sleep-30').textContent).toContain('٣٠');
  });
});
