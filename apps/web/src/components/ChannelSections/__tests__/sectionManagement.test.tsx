/**
 * The add and edit flow (docs/specs/CHANNEL-SECTIONS.md §9): grouped option
 * cards with per-type limits, picker-based forms and the payload each type sends.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { AddSectionDialog, cardAvailability, sectionCards } from '../management/AddSectionDialog';
import { SectionForm } from '../management/SectionForm';
import { getSectionContentSummary } from '../management/SortableSectionItem';
import { extractVideoId, isPublicVideo } from '../management/pickers/videoIds';
import { EN_TRANSLATIONS } from '@/lib/i18n/translations/en';
import { AR_TRANSLATIONS } from '@/lib/i18n/translations/ar';
import { getChannelPlaylists, getChannelVideos } from '@/lib/api/channels';
import { getVideoById } from '@/lib/api/videos';
import { fetchSuggestions } from '@/lib/search/suggest-client';
import type { PopulatedChannelSection } from '../sectionData';

jest.mock('@/hooks/useLanguage', () => ({
  useLanguage: () => ({
    t: jest.requireActual('@/lib/i18n/translations/en').EN_TRANSLATIONS,
    lang: 'en',
    locale: 'en',
    dir: 'ltr',
    isRTL: false,
  }),
}));
jest.mock('@/lib/api/channels', () => ({ getChannelVideos: jest.fn(), getChannelPlaylists: jest.fn() }));
jest.mock('@/lib/api/videos', () => ({ getVideoById: jest.fn() }));
jest.mock('@/lib/search/suggest-client', () => ({ fetchSuggestions: jest.fn() }));

const mockVideos = getChannelVideos as jest.MockedFunction<typeof getChannelVideos>;
const mockPlaylists = getChannelPlaylists as jest.MockedFunction<typeof getChannelPlaylists>;
const mockVideo = getVideoById as jest.MockedFunction<typeof getVideoById>;
const mockSuggest = fetchSuggestions as jest.MockedFunction<typeof fetchSuggestions>;

const CHANNEL = 'c1';
const cs = EN_TRANSLATIONS.channelSections;

beforeEach(() => {
  jest.clearAllMocks();
  mockVideos.mockResolvedValue({
    cursor: '',
    limit: 50,
    data: [
      { id: 'v1', title: 'Tafsir 1', thumbnailUrl: 'a.jpg', channelId: CHANNEL },
      { id: 'v2', title: 'Tafsir 2', thumbnailUrl: 'b.jpg', channelId: CHANNEL },
      { id: 'private', title: 'Draft', thumbnailUrl: 'c.jpg', channelId: CHANNEL, isPublic: false },
    ],
  } as never);
  mockPlaylists.mockResolvedValue({
    cursor: '',
    limit: 50,
    data: [
      { id: 'p1', name: 'Fiqh', videosCount: 3 },
      { id: 'p2', name: 'Seerah', videosCount: 5 },
      { id: 'hidden', name: 'Private list', isPublic: false },
    ],
  } as never);
});

function renderForm(props: Partial<React.ComponentProps<typeof SectionForm>> = {}) {
  const onSubmit = jest.fn();
  render(
    <SectionForm
      channelId={CHANNEL}
      sectionType="recent_uploads"
      canGrantConsent
      onSubmit={onSubmit}
      onCancel={jest.fn()}
      cancelLabel="Back"
      {...props}
    />
  );
  return onSubmit;
}

const submit = () => fireEvent.click(screen.getByTestId('section-form-submit'));

describe('option cards', () => {
  it('groups every type under Videos, Playlists, Channels and Community', () => {
    expect(sectionCards('videos').map((c) => c.preset?.liveFilter ?? c.type)).toEqual([
      'channel_spotlight', 'featured_videos', 'recent_uploads', 'popular_uploads', 'shorts', 'live_and_upcoming', 'past', 'liked_videos',
    ]);
    expect(sectionCards('playlists').map((c) => c.type)).toEqual(['single_playlist', 'multiple_playlists', 'created_playlists']);
    expect(sectionCards('channels').map((c) => c.type)).toEqual(['featured_channels', 'subscribed_channels']);
    expect(sectionCards('community').map((c) => c.type)).toEqual(['community_posts']);
  });

  it('closes a card at its limit and keeps Shorts open until both orders exist', () => {
    const recent = { type: 'recent_uploads' as const };
    expect(cardAvailability(recent, [])).toEqual({ available: true, preset: undefined });
    expect(cardAvailability(recent, [{ type: 'recent_uploads' }]).available).toBe(false);
    expect(cardAvailability({ type: 'featured_videos' }, [{ type: 'featured_videos' }]).available).toBe(true);

    const shorts = { type: 'shorts' as const };
    expect(cardAvailability(shorts, [{ type: 'shorts' }])).toEqual({ available: true, preset: { sort: 'popular' } });
    expect(cardAvailability(shorts, [{ type: 'shorts', sort: 'popular' }, { type: 'shorts', sort: 'latest' }]).available).toBe(false);

    const past = { type: 'live_streams' as const, preset: { liveFilter: 'past' as const } };
    expect(cardAvailability(past, [{ type: 'live_streams', liveFilter: 'live_and_upcoming' }]).available).toBe(true);
    expect(cardAvailability(past, [{ type: 'live_streams', liveFilter: 'past' }]).available).toBe(false);
  });

  it('shows grouped cards, marks private data and disables types already added', () => {
    render(<AddSectionDialog channelId={CHANNEL} existing={[{ type: 'recent_uploads' }]} canGrantConsent onAdd={jest.fn()} />);
    fireEvent.click(screen.getByTestId('add-section-button'));
    const options = screen.getByTestId('section-type-options');
    for (const group of Object.values(cs.groups)) expect(within(options).getByRole('heading', { name: group })).toBeInTheDocument();
    expect(options.querySelectorAll('[data-section-card]')).toHaveLength(14);

    const recent = options.querySelector('[data-section-card="recent_uploads"]') as HTMLButtonElement;
    expect(recent).toBeDisabled();
    expect(recent).toHaveTextContent(cs.alreadyAdded);
    expect(options.querySelector('[data-section-card="liked_videos"]')).toHaveTextContent(cs.privateData);
    expect(options.querySelector('[data-section-card="subscribed_channels"]')).toHaveTextContent(cs.privateData);
    expect(options.querySelector('[data-section-card="featured_videos"]')).not.toHaveTextContent(cs.privateData);
  });

  it('opens the config step, shows a rejected save and goes back', async () => {
    const onAdd = jest.fn().mockResolvedValue(cs.errors.section_type_limit);
    render(<AddSectionDialog channelId={CHANNEL} existing={[]} canGrantConsent onAdd={onAdd} />);
    fireEvent.click(screen.getByTestId('add-section-button'));
    fireEvent.click(screen.getByRole('button', { name: /Community posts/ }));
    expect(screen.getByRole('heading', { name: 'Community posts' })).toBeInTheDocument();
    submit();
    expect(await screen.findByTestId('section-form-error')).toHaveTextContent(cs.errors.section_type_limit);
    expect(onAdd).toHaveBeenCalledWith({ type: 'community_posts', title: 'community_posts section', postMode: 'latest', itemCount: 3 });
    fireEvent.click(screen.getByRole('button', { name: cs.back }));
    expect(screen.getByTestId('section-type-options')).toBeInTheDocument();
  });

  it('closes after a successful add', async () => {
    const onAdd = jest.fn().mockResolvedValue(null);
    render(<AddSectionDialog channelId={CHANNEL} existing={[]} canGrantConsent onAdd={onAdd} />);
    fireEvent.click(screen.getByTestId('add-section-button'));
    fireEvent.click(screen.getByRole('button', { name: /Past live streams/ }));
    submit();
    await waitFor(() => expect(screen.queryByTestId('section-form')).toBeNull());
    expect(onAdd).toHaveBeenCalledWith({ type: 'live_streams', title: 'live_streams section', liveFilter: 'past', itemCount: 12 });
  });
});

describe('SectionForm payloads', () => {
  it('automatic types send the item count and an owner title', () => {
    const onSubmit = renderForm({ sectionType: 'popular_uploads' });
    fireEvent.change(screen.getByTestId('section-title-input'), { target: { value: 'Most watched lessons' } });
    fireEvent.change(screen.getByTestId('section-item-count'), { target: { value: '8' } });
    submit();
    expect(onSubmit).toHaveBeenCalledWith({ type: 'popular_uploads', title: 'Most watched lessons', itemCount: 8 });
  });

  it('featured videos are picked from public channel videos, in pick order', async () => {
    const onSubmit = renderForm({ sectionType: 'featured_videos' });
    submit();
    expect(await screen.findByText(cs.form.pickRequired)).toBeInTheDocument();
    const options = await screen.findByTestId('video-picker-options');
    expect(options.querySelector('[data-option-id="private"]')).toBeNull();
    fireEvent.click(options.querySelector('[data-option-id="v2"]')!);
    fireEvent.click(options.querySelector('[data-option-id="v1"]')!);
    expect(screen.getByText('2 of 20 selected')).toBeInTheDocument();
    submit();
    expect(onSubmit).toHaveBeenCalledWith({ type: 'featured_videos', title: 'featured_videos section', videoIds: ['v2', 'v1'] });
  });

  it('featured videos accept a pasted link to any public video', async () => {
    mockVideo.mockResolvedValue({ id: 'other1', title: 'Guest lecture', channelId: 'c9', thumbnailUrl: 'x.jpg' } as never);
    const onSubmit = renderForm({ sectionType: 'featured_videos' });
    fireEvent.change(screen.getByTestId('video-picker-paste'), { target: { value: 'https://alummahnow.net/en/video?vid=other1' } });
    fireEvent.click(screen.getByRole('button', { name: cs.form.addPasted }));
    await screen.findByText('Guest lecture');
    submit();
    expect(mockVideo).toHaveBeenCalledWith('other1');
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ videoIds: ['other1'] }));
  });

  it('spotlight needs one video and rejects another channel\'s video by link', async () => {
    mockVideo.mockResolvedValue({ id: 'other1', title: 'Elsewhere', channelId: 'c9' } as never);
    const onSubmit = renderForm({ sectionType: 'channel_spotlight' });
    expect(screen.queryByTestId('section-title-input')).toBeNull();
    submit();
    expect(screen.getByText(cs.form.spotlightNeedsOne)).toBeInTheDocument();

    fireEvent.change(screen.getByTestId('spotlight-trailer-paste'), { target: { value: 'other1' } });
    fireEvent.click(screen.getAllByRole('button', { name: cs.form.addPasted })[0]);
    expect(await screen.findByText(cs.form.pastedNotFound)).toBeInTheDocument();

    const options = await screen.findByTestId('spotlight-returning-options');
    await waitFor(() => expect(options.querySelector('[data-option-id="v1"]')).not.toBeNull());
    fireEvent.click(options.querySelector('[data-option-id="v1"]')!);
    submit();
    expect(onSubmit).toHaveBeenCalledWith({ type: 'channel_spotlight', title: 'channel_spotlight section', returningVideoId: 'v1' });
  });

  it('spotlight edit clears a removed video with null', () => {
    const initial = {
      id: 's1', type: 'channel_spotlight', title: 'channel_spotlight section',
      populatedContent: { spotlight: { trailer: { id: 't1', title: 'Welcome' }, returning: { id: 'r1', title: 'Latest' } } },
    } as unknown as PopulatedChannelSection;
    const onSubmit = renderForm({ sectionType: 'channel_spotlight', mode: 'edit', initial });
    fireEvent.click(screen.getByRole('button', { name: `${cs.form.remove}: Latest` }));
    submit();
    expect(onSubmit).toHaveBeenCalledWith({ type: 'channel_spotlight', title: 'channel_spotlight section', trailerVideoId: 't1', returningVideoId: null });
  });

  it('single and multiple playlists use the playlist picker', async () => {
    const onSubmit = renderForm({ sectionType: 'single_playlist' });
    const options = await screen.findByTestId('playlist-picker-options');
    expect(options.querySelector('[data-option-id="hidden"]')).toBeNull();
    fireEvent.click(options.querySelector('[data-option-id="p1"]')!);
    fireEvent.click(options.querySelector('[data-option-id="p2"]')!);
    submit();
    expect(onSubmit).toHaveBeenCalledWith({ type: 'single_playlist', title: 'single_playlist section', playlistId: 'p2', itemCount: 12 });
  });

  it('featured playlists need a title', async () => {
    const onSubmit = renderForm({ sectionType: 'multiple_playlists' });
    const options = await screen.findByTestId('playlist-picker-options');
    fireEvent.click(options.querySelector('[data-option-id="p2"]')!);
    fireEvent.click(options.querySelector('[data-option-id="p1"]')!);
    submit();
    expect(onSubmit).not.toHaveBeenCalled();
    fireEvent.change(screen.getByTestId('section-title-input'), { target: { value: 'Courses' } });
    submit();
    expect(onSubmit).toHaveBeenCalledWith({ type: 'multiple_playlists', title: 'Courses', playlistIds: ['p2', 'p1'] });
  });

  it('featured channels are found by search, excluding this channel', async () => {
    mockSuggest.mockResolvedValue([
      { type: 'channel', id: CHANNEL, text: 'Me' },
      { type: 'channel', id: 'c2', text: 'Sheikh A', handle: 'sheikha', subtitle: '@sheikha', verified: true },
    ]);
    const onSubmit = renderForm({ sectionType: 'featured_channels' });
    fireEvent.change(screen.getByTestId('section-title-input'), { target: { value: 'Our scholars' } });
    fireEvent.change(screen.getByTestId('channel-picker-search'), { target: { value: '@sh' } });
    const options = await screen.findByTestId('channel-picker-options', {}, { timeout: 2000 });
    await waitFor(() => expect(options.querySelector('[data-option-id="c2"]')).not.toBeNull());
    expect(mockSuggest).toHaveBeenCalledWith('sh', expect.objectContaining({ types: ['channel'], limit: 10 }));
    expect(options.querySelector(`[data-option-id="${CHANNEL}"]`)).toBeNull();
    fireEvent.click(options.querySelector('[data-option-id="c2"]')!);
    submit();
    expect(onSubmit).toHaveBeenCalledWith({ type: 'featured_channels', title: 'Our scholars', channelIds: ['c2'] });
  });

  it('Shorts send their order and community posts their mode', () => {
    let onSubmit = renderForm({ sectionType: 'shorts', preset: { sort: 'popular' } });
    expect(screen.getByTestId('shorts-sort-popular')).toBeChecked();
    submit();
    expect(onSubmit).toHaveBeenCalledWith({ type: 'shorts', title: 'shorts section', sort: 'popular', itemCount: 12 });

    document.body.innerHTML = '';
    onSubmit = renderForm({ sectionType: 'community_posts' });
    fireEvent.click(screen.getByTestId('post-mode-pinned'));
    expect(screen.queryByTestId('section-item-count')).toBeNull();
    submit();
    expect(onSubmit).toHaveBeenCalledWith({ type: 'community_posts', title: 'community_posts section', postMode: 'pinned' });
  });

  it.each(['subscribed_channels', 'liked_videos'] as const)('%s needs the owner to tick consent', (type) => {
    const onSubmit = renderForm({ sectionType: type });
    submit();
    expect(screen.getByText(cs.form.consentRequired)).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('section-consent'));
    submit();
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ type, consent: true }));
  });

  it('a channel admin cannot grant consent', () => {
    renderForm({ sectionType: 'liked_videos', canGrantConsent: false });
    expect(screen.getByTestId('section-consent')).toBeDisabled();
    expect(screen.getByText(cs.form.ownerOnlyConsent)).toBeInTheDocument();
  });

  it('edit only sends consent when it changed, and shows server errors', () => {
    const initial = { id: 's', type: 'liked_videos', title: 'Loved', consented: true, itemCount: 6 } as unknown as PopulatedChannelSection;
    const onSubmit = renderForm({ sectionType: 'liked_videos', mode: 'edit', initial, serverError: cs.errors.owner_consent_required });
    expect(screen.getByTestId('section-form-error')).toHaveTextContent(cs.errors.owner_consent_required);
    expect(screen.getByTestId('section-title-input')).toHaveValue('Loved');
    submit();
    expect(onSubmit).toHaveBeenLastCalledWith({ type: 'liked_videos', title: 'Loved', itemCount: 6 });
    fireEvent.click(screen.getByTestId('section-consent'));
    submit();
    expect(onSubmit).toHaveBeenLastCalledWith({ type: 'liked_videos', title: 'Loved', itemCount: 6, consent: false });
  });
});

describe('helpers', () => {
  it('extracts video ids from links and ids', () => {
    expect(extractVideoId('abc123XYZ')).toBe('abc123XYZ');
    expect(extractVideoId('https://alummahnow.net/ar/video?vid=v_1-a')).toBe('v_1-a');
    expect(extractVideoId('https://x.test/shorts/short99')).toBe('short99');
    expect(extractVideoId('not a link')).toBeNull();
    expect(extractVideoId('')).toBeNull();
  });

  it('only public, ready videos can be picked', () => {
    expect(isPublicVideo({})).toBe(true);
    expect(isPublicVideo({ isPublic: false })).toBe(false);
    expect(isPublicVideo({ uploadStatus: 'processing' })).toBe(false);
    expect(isPublicVideo({ isDeleted: true })).toBe(false);
  });

  it('summarises picked content from the view shape', () => {
    const s = EN_TRANSLATIONS.channelManage.sections;
    expect(getSectionContentSummary({ content: { videoIds: ['a', 'b'] } } as PopulatedChannelSection, s)).toBe('Videos: 2');
    expect(getSectionContentSummary({ content: { trailerVideoId: 't' } } as PopulatedChannelSection, s)).toBe('Videos: 1');
    expect(getSectionContentSummary({ content: { channelIds: ['c'] } } as PopulatedChannelSection, s)).toBe('Channels: 1');
    expect(getSectionContentSummary({ content: {} } as PopulatedChannelSection, s)).toBe(s.automaticContent);
  });

  it('has every channel section string in Arabic', () => {
    const walk = (en: object, ar: Record<string, unknown>, path: string) => {
      for (const [key, value] of Object.entries(en)) {
        expect(ar[key]).toBeDefined();
        if (value && typeof value === 'object') walk(value, ar[key] as Record<string, unknown>, `${path}.${key}`);
        else expect(String(ar[key]).length).toBeGreaterThan(0);
      }
    };
    walk(EN_TRANSLATIONS.channelSections, AR_TRANSLATIONS.channelSections as never, 'channelSections');
  });
});
