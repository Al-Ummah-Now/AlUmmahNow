/**
 * Studio → Site → a page (SS16): add and edit blocks per language, block validation is explained
 * in words before saving, save sends the ETag, publish flips the status, delete uses the in-app
 * dialog; the Site editor's checklist and the page menu kind.
 */
import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { SitePage } from '@al-ummah/shared-types';
import { SitePageEditor, videoIdFrom } from '../SitePageEditor';
import { saveSitePage, deleteSitePage } from '@/lib/studio/site-client';

jest.mock('@/hooks/useLanguage', () => ({
  useLanguage: () => ({ t: jest.requireActual('@/lib/i18n/translations/en').EN_TRANSLATIONS, lang: 'en', locale: 'en', isRTL: false }),
}));
jest.mock('@/lib/studio/site-client', () => ({
  saveSitePage: jest.fn(),
  deleteSitePage: jest.fn(),
  restoreSitePage: jest.fn(),
  previewSiteSettings: jest.fn(),
  uploadSiteImage: jest.fn(),
}));
jest.mock('@/components/common/AppLink', () => ({ __esModule: true, default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a> }));

const page: SitePage = {
  id: 'pg_0123456789abcdef',
  slug: 'about-us',
  title: { en: 'About us' },
  description: {},
  blocks: { en: [{ id: 'b1', type: 'markdown', text: 'Hello' }] },
  status: 'draft',
  createdAt: '2026-11-13T10:00:00Z',
  updatedAt: '2026-11-13T10:00:00Z',
  updatedBy: 'u',
  revisions: [],
};

const save = jest.mocked(saveSitePage);
const del = jest.mocked(deleteSitePage);

describe('SitePageEditor', () => {
  beforeEach(() => {
    save.mockReset();
    del.mockReset();
  });

  it('reads a video id from a watch address', () => {
    expect(videoIdFrom('https://alummahnow.net/en/video/abc123XYZ')).toBe('abc123XYZ');
    expect(videoIdFrom('https://x.example/watch?v=abcd_-12')).toBe('abcd_-12');
    expect(videoIdFrom(' plainId1 ')).toBe('plainId1');
  });

  it('adds a button block, explains an incomplete one, and saves with the ETag', async () => {
    render(<SitePageEditor locale="en" channelId="ch1" siteLocales={['en', 'ar']} initial={{ page, etag: 'e1' }} />);
    fireEvent.change(screen.getByTestId('studio-site-page-block-type'), { target: { value: 'cta' } });
    fireEvent.click(screen.getByTestId('studio-site-page-block-add'));
    expect(screen.getAllByTestId('studio-site-page-block')).toHaveLength(2);
    // An empty button label is not valid yet
    expect(screen.getByTestId('studio-site-page-message')).toHaveTextContent('A block is incomplete');
    expect(screen.getByTestId('studio-site-page-save')).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Button text'), { target: { value: 'Watch' } });
    fireEvent.change(screen.getByLabelText('Goes to (a path or https:// address)'), { target: { value: '/en/videos/' } });
    save.mockResolvedValue({ ok: true, data: { page: { ...page, blocks: { en: [...page.blocks.en!, { id: 'b2', type: 'cta', label: 'Watch', href: '/en/videos/' }] } }, etag: 'e2' } });
    await act(async () => {
      fireEvent.click(screen.getByTestId('studio-site-page-save'));
    });
    expect(save).toHaveBeenCalledWith('ch1', page.id, expect.objectContaining({ blocks: { en: [page.blocks.en![0], { id: 'b2', type: 'cta', label: 'Watch', href: '/en/videos/' }] } }), 'e1');
    expect(screen.getByTestId('studio-site-page-message')).toHaveTextContent('Saved.');
  });

  it('keeps blocks per language', () => {
    render(<SitePageEditor locale="en" channelId="ch1" siteLocales={['en', 'ar']} initial={{ page, etag: 'e1' }} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Arabic' }));
    expect(screen.queryAllByTestId('studio-site-page-block')).toHaveLength(0);
    fireEvent.click(screen.getByTestId('studio-site-page-block-add'));
    expect(screen.getByTestId('studio-site-page-blocks')).toHaveAttribute('lang', 'ar');
    fireEvent.click(screen.getByRole('tab', { name: 'English' }));
    expect(screen.getAllByTestId('studio-site-page-block')).toHaveLength(1);
  });

  it('publishes, and deletes through the in-app dialog', async () => {
    window.confirm = jest.fn(() => true);
    render(<SitePageEditor locale="en" channelId="ch1" siteLocales={['en']} initial={{ page, etag: 'e1' }} />);
    save.mockResolvedValue({ ok: true, data: { page: { ...page, status: 'published' }, etag: 'e2' } });
    await act(async () => {
      fireEvent.click(screen.getByTestId('studio-site-page-publish'));
    });
    expect(save).toHaveBeenCalledWith('ch1', page.id, expect.objectContaining({ status: 'published' }), 'e1');
    expect(screen.getByTestId('studio-site-page-status')).toHaveTextContent('Published');
    fireEvent.click(screen.getByTestId('studio-site-page-delete'));
    const dialog = await screen.findByTestId('site-page-delete-dialog');
    del.mockResolvedValue({ ok: false, status: 500, code: null });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Delete page' }));
    });
    await waitFor(() => expect(del).toHaveBeenCalledWith('ch1', page.id));
    expect(window.confirm).not.toHaveBeenCalled();
  });
});
