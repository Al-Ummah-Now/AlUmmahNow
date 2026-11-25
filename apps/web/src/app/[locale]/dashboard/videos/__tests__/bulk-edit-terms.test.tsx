/** The dashboard's bulk edit across channels while the creator Terms refuse one of them (#1929). */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { EN_TRANSLATIONS as mockEn } from '@al-ummah/shared-types';
import { accept, modal } from '@/components/legal/__tests__/terms-testkit';
import Page from '../page';

const mockT = { ...mockEn };
const mockBulk = jest.fn();
const mockUser = { id: 'u1', channels: [{ id: 'c1', name: 'One' }, { id: 'c2', name: 'Two' }] };
jest.mock('@/hooks/useLanguage', () => ({ useLanguage: () => ({ t: mockT, lang: 'en', locale: 'en', dir: 'ltr', isRTL: false }) }));
jest.mock('@/hooks/useCreatorAccess', () => ({
  useCreatorAccess: () => ({ status: 'ready', access: { canUpload: true, termsAccepted: false, termsVersion: '2026-11-24' } }),
  showsUpload: () => false, needsCreatorTerms: () => false, markCreatorTermsRequired: jest.fn(), acceptCreatorTerms: jest.fn().mockResolvedValue({ ok: true }),
}));
jest.mock('@/components/AuthProvider/authContext', () => ({ useAuth: () => ({ user: mockUser }) }));
jest.mock('@/hooks/useMultiAccount', () => ({ useMultiAccount: () => ({ user: mockUser, loading: false }) }));
const mockRouter = { push: jest.fn() };
jest.mock('next/navigation', () => ({ useRouter: () => mockRouter, usePathname: () => '/en', useParams: () => ({ locale: 'en' }) }));
const mockVideos = ['a', 'b'].map((id, i) => ({ id, title: `Video ${id}`, channelId: `c${i + 1}`, isPublic: false, dateCreated: '2026-01-01T00:00:00.000Z', uploadStatus: 'ready', views: 0 }));
jest.mock('@/lib/api/videos', () => ({ searchVideos: jest.fn(async () => ({ data: mockVideos })), bulkDeleteVideos: jest.fn(), bulkUpdateVideos: (...a: unknown[]) => mockBulk(...a) }));
jest.mock('@/lib/logger-client', () => ({ logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() } }));
jest.mock('@/lib/auth/silent-sign-in', () => ({ signInAndReturnHere: jest.fn() }));
jest.mock('@/hooks/useVideoCategories', () => ({ useVideoCategories: () => ({ active: [], all: [] }) }));
jest.mock('@/components/playlists/AddToPlaylistDialog', () => ({ __esModule: true, default: () => null }));
jest.mock('@/components/playlists/VideoPicker', () => ({ toPicked: (v: unknown) => v }));
jest.mock('@/components/VideoThumbnail', () => ({ __esModule: true, default: () => null }));
jest.mock('@/components/video/ProcessingProgress', () => ({ ProcessingProgress: () => null }));
jest.mock('@/components/common/AppLink', () => ({ __esModule: true, default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a> }));

const done = (id: string) => ({ success: true, results: [{ videoId: id, success: true }] });
const refused = (id: string) => ({ success: false, code: 'terms_required', results: [{ videoId: id, success: false, code: 'terms_required' }] });

async function apply() {
  render(<Page />);
  for (const box of await screen.findAllByTestId('dashboard-video-select')) fireEvent.click(box);
  fireEvent.click(screen.getByTestId('dashboard-edit-selected'));
  fireEvent.change(screen.getByTestId('bulk-edit-visibility'), { target: { value: 'public' } });
  await act(async () => { fireEvent.click(screen.getByTestId('bulk-edit-apply')); });
}
const sent = () => mockBulk.mock.calls.map((c) => [c[0], c[2].channelId]);

beforeEach(() => mockBulk.mockReset());

it('keeps what the other channel’s request changed, and edits only the refused videos after accepting', async () => {
  mockBulk.mockImplementation(async ([id]: string[]) => (id === 'b' ? refused('b') : done('a')));
  await apply();
  expect(modal()).toBeInTheDocument();
  expect(screen.getByText(mockEn.bulkEdit.done.replace('{count}', '1'))).toBeInTheDocument();
  expect(screen.queryByTestId('dashboard-error')).toBeNull();
  fireEvent.click(screen.getByTestId('creator-terms-cancel'));
  await waitFor(() => expect(modal()).toBeNull());
  // The edit is still open and says what it waits for
  expect(screen.getByTestId('bulk-edit-terms')).toHaveTextContent(mockEn.creator.termsRequired);
  fireEvent.click(screen.getByTestId('bulk-edit-review-terms'));
  mockBulk.mockImplementation(async ([id]: string[]) => done(id));
  await accept();
  await waitFor(() => expect(sent()).toEqual([[['a'], 'c1'], [['b'], 'c2'], [['b'], 'c2']]));
  await waitFor(() => expect(screen.queryByTestId('bulk-edit-dialog')).toBeNull());
  expect(mockBulk.mock.calls[2][1]).toEqual(mockBulk.mock.calls[1][1]);
});

it('refused again right after accepting: said in the dialog, not asked in a loop', async () => {
  mockBulk.mockImplementation(async ([id]: string[]) => refused(id));
  await apply();
  await accept();
  await waitFor(() => expect(mockBulk).toHaveBeenCalledTimes(4));
  expect(await screen.findByTestId('bulk-edit-terms')).toBeInTheDocument();
  expect(modal()).toBeNull();
});
