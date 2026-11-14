/**
 * @jest-environment node
 *
 * Channel URLs 301 to /{locale}/@{current handle} (wiki AUN-SEO): an old handle (handle history)
 * and /channels/{id} of a channel with a handle. The current handle renders.
 */
import { notFound, permanentRedirect } from 'next/navigation';
import HandlePage from '../page';
import IdPage from '../../../channels/[id]/page';
import { loadChannelByHandle, loadChannelById } from '@/lib/channel-loaders';

jest.mock('next/navigation', () => ({
  notFound: jest.fn(() => { throw new Error('NEXT_NOT_FOUND'); }),
  permanentRedirect: jest.fn((to: string) => { throw new Error(`NEXT_REDIRECT ${to}`); }),
}));
jest.mock('@/lib/channel-loaders', () => ({
  loadChannelByHandle: jest.fn(),
  loadChannelById: jest.fn(),
  decodeHandleSegment: (raw: string) => decodeURIComponent(raw).replace(/^@+/, ''),
}));
jest.mock('@/lib/channels/first-tab', () => ({ loadChannelFirstTab: jest.fn(async () => ({ defaultTab: 'home' })) }));
jest.mock('@/components/ChannelTabs/ChannelTabContent', () => ({ ChannelTabContent: () => null }));

const byHandle = loadChannelByHandle as jest.Mock;
const byId = loadChannelById as jest.Mock;
const params = <T,>(v: T) => Promise.resolve(v);

describe('channel page redirects', () => {
  beforeEach(() => jest.clearAllMocks());

  it('an old handle 308s to the current one with the query', async () => {
    byHandle.mockResolvedValue({ id: 'c1', handle: 'NewName' });
    await expect(HandlePage({ params: params({ locale: 'ar', handle: 'oldname' }), searchParams: params({ tab: 'videos' }) })).rejects.toThrow('NEXT_REDIRECT /ar/@NewName?tab=videos');
    expect(permanentRedirect).toHaveBeenCalledWith('/ar/@NewName?tab=videos');
  });

  it('the current handle in another letter case renders', async () => {
    byHandle.mockResolvedValue({ id: 'c1', handle: 'NewName' });
    await expect(HandlePage({ params: params({ locale: 'en', handle: 'newname' }) })).resolves.toBeTruthy();
    expect(permanentRedirect).not.toHaveBeenCalled();
  });

  it('an unknown handle is a 404', async () => {
    byHandle.mockResolvedValue(null);
    await expect(HandlePage({ params: params({ locale: 'en', handle: 'nobody' }) })).rejects.toThrow('NEXT_NOT_FOUND');
    expect(notFound).toHaveBeenCalled();
  });

  it('/channels/{id} 308s to the @handle URL; a channel without a handle renders there', async () => {
    byId.mockResolvedValue({ id: 'c1', handle: 'Noor' });
    await expect(IdPage({ params: params({ locale: 'en', id: 'c1' }), searchParams: params({ tab: 'about' }) })).rejects.toThrow('NEXT_REDIRECT /en/@Noor?tab=about');
    byId.mockResolvedValue({ id: 'c2' });
    await expect(IdPage({ params: params({ locale: 'en', id: 'c2' }) })).resolves.toBeTruthy();
  });
});
