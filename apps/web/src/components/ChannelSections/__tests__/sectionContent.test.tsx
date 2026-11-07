/**
 * Regression tests: channel section content is returned by the API nested
 * under `content` (videoIds / playlistId / playlistIds). The renderer used to
 * read only the flat fields, so featured-video and playlist sections always
 * rendered empty ("Playlist not found").
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import type { ChannelSection } from '@al-ummah/shared-types';
import {
  getSectionPlaylistIds,
  getSectionVideoIds,
  resolveSectionTitle,
  type PopulatedChannelSection,
} from '../sectionData';
import { ChannelSectionRenderer } from '../ChannelSectionRenderer';
import { SectionForm } from '../management/SectionForm';
import { getSectionContentSummary } from '../management/SortableSectionItem';
import { EN_TRANSLATIONS } from '@/lib/i18n/translations/en';
import { AR_TRANSLATIONS } from '@/lib/i18n/translations/ar';

jest.mock('@/hooks/useLanguage', () => ({
  useLanguage: () => ({
    t: jest.requireActual('@/lib/i18n/translations/en').EN_TRANSLATIONS,
    lang: 'en',
    locale: 'en',
    dir: 'ltr',
    isRTL: false,
  }),
}));

jest.mock('@/lib/api/channels', () => ({ getChannelById: jest.fn() }));
jest.mock('@/lib/api/channel-sections', () => ({ listChannelSectionsPopulated: jest.fn() }));
jest.mock('@/lib/api/videos', () => ({ listVideos: jest.fn(), getVideoById: jest.fn() }));
jest.mock('@/lib/api/playlists', () => ({ getPlaylistById: jest.fn(), listPlaylists: jest.fn() }));
jest.mock('@/lib/api/livestreams', () => ({ listLiveStreams: jest.fn() }));
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn() }) }));

jest.mock('../types/FeaturedVideosSection', () => ({
  FeaturedVideosSection: ({ videoIds, title }: { videoIds: string[]; title?: string }) => (
    <div data-testid="featured">{`${title}:${videoIds.join(',')}`}</div>
  ),
}));
jest.mock('../types/SinglePlaylistSection', () => ({
  SinglePlaylistSection: ({ playlistId }: { playlistId: string }) => <div data-testid="single">{playlistId}</div>,
}));
jest.mock('../types/MultiplePlaylistsSection', () => ({
  MultiplePlaylistsSection: ({ playlistIds, title }: { playlistIds: string[]; title: string }) => (
    <div data-testid="multiple">{`${title}:${playlistIds.join(',')}`}</div>
  ),
}));

const base = {
  id: 's1',
  channelId: 'c1',
  title: 'My section',
  position: 0,
} as unknown as PopulatedChannelSection;

describe('section content helpers', () => {
  it('reads video ids from the nested API shape and the flat shape', () => {
    expect(getSectionVideoIds({ ...base, content: { videoIds: ['v1', 'v2'] } })).toEqual(['v1', 'v2']);
    expect(getSectionVideoIds({ ...base, videoIds: ['v3'] })).toEqual(['v3']);
    expect(getSectionVideoIds(base)).toEqual([]);
  });

  it('reads single and multiple playlist ids from both shapes', () => {
    expect(getSectionPlaylistIds({ ...base, content: { playlistId: 'p1' } })).toEqual(['p1']);
    expect(getSectionPlaylistIds({ ...base, content: { playlistIds: ['p2', 'p3'] } })).toEqual(['p2', 'p3']);
    expect(getSectionPlaylistIds({ ...base, playlistIds: ['p4'] })).toEqual(['p4']);
    expect(getSectionPlaylistIds({ ...base, playlistId: 'p5' } as PopulatedChannelSection)).toEqual(['p5']);
    expect(getSectionPlaylistIds(base)).toEqual([]);
  });

  it('uses the owner title, falling back for empty and legacy auto-generated titles', () => {
    expect(resolveSectionTitle('Lectures', 'Recent uploads')).toBe('Lectures');
    expect(resolveSectionTitle('  ', 'Recent uploads')).toBe('Recent uploads');
    expect(resolveSectionTitle(undefined, 'Recent uploads')).toBe('Recent uploads');
    expect(resolveSectionTitle('recent_uploads section', 'Recent uploads')).toBe('Recent uploads');
  });
});

describe('ChannelSectionRenderer', () => {
  it('passes nested featured video ids to the featured section', () => {
    render(
      <ChannelSectionRenderer
        channelId="c1"
        section={{ ...base, type: 'featured_videos', content: { videoIds: ['v1'] } } as PopulatedChannelSection}
      />
    );
    expect(screen.getByTestId('featured')).toHaveTextContent('My section:v1');
  });

  it('passes the nested playlist id to the single-playlist section', () => {
    render(
      <ChannelSectionRenderer
        channelId="c1"
        section={{ ...base, type: 'single_playlist', content: { playlistId: 'p1' } } as PopulatedChannelSection}
      />
    );
    expect(screen.getByTestId('single')).toHaveTextContent('p1');
  });

  it('passes nested playlist ids to the multiple-playlists section', () => {
    render(
      <ChannelSectionRenderer
        channelId="c1"
        section={{ ...base, type: 'multiple_playlists', content: { playlistIds: ['p1', 'p2'] } } as PopulatedChannelSection}
      />
    );
    expect(screen.getByTestId('multiple')).toHaveTextContent('My section:p1,p2');
  });
});

describe('section manager strings', () => {
  it('summarises section content in both languages', () => {
    const section = { ...base, type: 'featured_videos', videoIds: ['a', 'b'] } as unknown as ChannelSection;
    expect(getSectionContentSummary(section, EN_TRANSLATIONS.channelManage.sections)).toBe('Videos: 2');
    expect(getSectionContentSummary(section, AR_TRANSLATIONS.channelManage.sections)).toBe('الفيديوهات: 2');
    const auto = { ...base, type: 'recent_uploads' } as unknown as ChannelSection;
    expect(getSectionContentSummary(auto, EN_TRANSLATIONS.channelManage.sections)).toBe('Automatic content');
  });

  it('has an Arabic label and description for every section type', () => {
    const en = EN_TRANSLATIONS.channelManage.sections;
    const ar = AR_TRANSLATIONS.channelManage.sections;
    expect(Object.keys(ar.typeLabels).sort()).toEqual(Object.keys(en.typeLabels).sort());
    expect(Object.keys(ar.typeDescriptions).sort()).toEqual(Object.keys(en.typeDescriptions).sort());
  });
});

describe('SectionForm', () => {
  it('validates required video ids and names untitled sections after their type', () => {
    const onSubmit = jest.fn();
    const { rerender } = render(
      <SectionForm channelId="c1" sectionType="featured_videos" onSubmit={onSubmit} onCancel={jest.fn()} />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Create section' }));
    expect(screen.getByText('At least one video ID is required')).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();

    rerender(<SectionForm key="auto" channelId="c1" sectionType="recent_uploads" onSubmit={onSubmit} onCancel={jest.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Create section' }));
    expect(onSubmit).toHaveBeenCalledWith({ type: 'recent_uploads', title: 'Recent uploads' });
  });

  it('prefills and saves in edit mode', () => {
    const onSubmit = jest.fn();
    render(
      <SectionForm
        channelId="c1"
        sectionType="single_playlist"
        mode="edit"
        initialData={{ title: 'Old', playlistId: 'p1' }}
        onSubmit={onSubmit}
        onCancel={jest.fn()}
      />
    );
    expect(screen.getByLabelText(/Section title/)).toHaveValue('Old');
    expect(screen.getByLabelText(/Playlist IDs/)).toHaveValue('p1');
    fireEvent.change(screen.getByLabelText(/Section title/), { target: { value: 'New' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(onSubmit).toHaveBeenCalledWith({ type: 'single_playlist', title: 'New', playlistId: 'p1' });
  });
});
