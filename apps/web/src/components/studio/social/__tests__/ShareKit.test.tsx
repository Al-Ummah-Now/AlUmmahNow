import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { STUDIO_AR, STUDIO_EN } from '@al-ummah/shared-types';
import { ShareKit } from '../ShareKit';

let mockStudio = STUDIO_EN;
jest.mock('@/hooks/useLanguage', () => ({ useLanguage: () => ({ t: { studio: mockStudio } }) }));
jest.mock('@/lib/logger-client', () => ({ logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() } }));
jest.mock('@/lib/studio/social-client', () => ({ socialClient: { shareKit: jest.fn() } }));
jest.mock('@/lib/studio/content-client', () => ({ fetchContentPage: jest.fn() }));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { socialClient } = require('@/lib/studio/social-client') as { socialClient: { shareKit: jest.Mock } };
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { fetchContentPage } = require('@/lib/studio/content-client') as { fetchContentPage: jest.Mock };

const kit = {
  videoId: 'v1',
  available: true,
  kind: 'video',
  title: { en: 'Tafsir', ar: 'تفسير' },
  captions: { en: 'New video: Tafsir https://x.test/en/video/v1', ar: 'مرئي جديد: تفسير https://x.test/ar/video/v1' },
  links: { en: 'https://x.test/en/video/v1', ar: 'https://x.test/ar/video/v1' },
  thumbnail: { url: 'https://vz.b-cdn.net/v1/thumb.jpg', downloadPath: '/thumb/v1.jpg' },
  clip: null,
};

beforeEach(() => {
  mockStudio = STUDIO_EN;
  socialClient.shareKit.mockReset();
  fetchContentPage.mockReset();
  fetchContentPage.mockResolvedValue({ items: [{ id: 's1', title: 'A Short' }], cursor: null });
});

describe('ShareKit', () => {
  it('shows both captions, both links and the thumbnail download', async () => {
    socialClient.shareKit.mockResolvedValue({ ok: true, data: kit });
    render(<ShareKit channelId="c1" videoId="v1" />);
    expect(await screen.findByTestId('share-kit-caption-en')).toHaveTextContent('New video: Tafsir');
    const ar = screen.getByTestId('share-kit-caption-ar');
    expect(ar).toHaveTextContent('مرئي جديد');
    expect(ar).toHaveAttribute('dir', 'rtl');
    expect(screen.getByTestId('share-kit-thumbnail')).toHaveAttribute('href', '/thumb/v1.jpg');
    expect(socialClient.shareKit).toHaveBeenCalledWith('c1', 'v1', undefined);
  });

  it('picks a Short for the vertical clip of a long video', async () => {
    socialClient.shareKit.mockResolvedValueOnce({ ok: true, data: kit });
    socialClient.shareKit.mockResolvedValueOnce({ ok: true, data: { ...kit, clip: { videoId: 's1', title: 'A Short', downloadPath: '/studio-download/clip/c1/s1.mp4', width: 720, height: 1280, durationSeconds: 30 } } });
    render(<ShareKit channelId="c1" videoId="v1" />);
    const select = await screen.findByTestId('share-kit-short');
    await waitFor(() => expect(screen.getByRole('option', { name: 'A Short', hidden: true })).toBeInTheDocument());
    expect(fetchContentPage).toHaveBeenCalledWith('c1', expect.objectContaining({ type: 'shorts', visibility: 'public', status: 'published' }), expect.anything());
    fireEvent.change(select, { target: { value: 's1' } });
    expect(await screen.findByTestId('share-kit-clip')).toHaveAttribute('href', '/studio-download/clip/c1/s1.mp4');
    expect(socialClient.shareKit).toHaveBeenLastCalledWith('c1', 'v1', 's1');
  });

  it('a Short has its own clip and no picker', async () => {
    socialClient.shareKit.mockResolvedValue({ ok: true, data: { ...kit, kind: 'short', clip: { videoId: 'v1', title: 'S', downloadPath: '/studio-download/clip/c1/v1.mp4', width: 720, height: 1280, durationSeconds: 20 } } });
    render(<ShareKit channelId="c1" videoId="v1" />);
    expect(await screen.findByTestId('share-kit-clip')).toBeInTheDocument();
    expect(screen.queryByTestId('share-kit-short')).toBeNull();
    expect(fetchContentPage).not.toHaveBeenCalled();
  });

  it('says when the video is not public yet, in Arabic too', async () => {
    mockStudio = STUDIO_AR;
    socialClient.shareKit.mockResolvedValue({ ok: true, data: { videoId: 'v1', available: false, reason: 'not_public' } });
    render(<ShareKit channelId="c1" videoId="v1" />);
    expect(await screen.findByTestId('share-kit-not-public')).toHaveTextContent(STUDIO_AR.social.shareKit.notPublic);
  });

  it('shows an error when it cannot load', async () => {
    socialClient.shareKit.mockResolvedValue({ ok: false, status: 500, code: 'generic' });
    render(<ShareKit channelId="c1" videoId="v1" />);
    expect(await screen.findByRole('alert')).toHaveTextContent(STUDIO_EN.social.shareKit.loadFailed);
  });
});
