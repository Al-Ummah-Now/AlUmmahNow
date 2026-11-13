/**
 * The link post composer (SS14): "Get preview" fills only the empty fields from the page's preview
 * (the creator's own text wins), announces the result, and says so when no preview could be read.
 */
import React, { useState } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { LinkPostForm, emptyLink, type LinkFormData } from '../management/forms/LinkPostForm';
import { fetchLinkPreview } from '@/lib/api/community-posts';

jest.mock('@/hooks/useLanguage', () => ({
  useLanguage: () => ({
    t: jest.requireActual('@/lib/i18n/translations/en').EN_TRANSLATIONS,
    lang: 'en',
    locale: 'en',
    isRTL: false,
  }),
}));
jest.mock('@/lib/api/community-posts', () => ({ fetchLinkPreview: jest.fn(), uploadCommunityImages: jest.fn() }));
jest.mock('../management/forms/PostImageField', () => ({ PostImageField: () => null }));

const preview = jest.mocked(fetchLinkPreview);
let latest: LinkFormData = emptyLink();

function Harness({ initial }: { initial: Partial<LinkFormData> }) {
  const [data, setData] = useState<LinkFormData>({ ...emptyLink(), ...initial });
  latest = data;
  return <LinkPostForm channelId="c1" data={data} onChange={setData} postLocale="en" />;
}

describe('LinkPostForm', () => {
  beforeEach(() => preview.mockReset());

  it('fills empty fields from the preview and keeps what the creator typed', async () => {
    preview.mockResolvedValue({ url: 'https://example.org/a', title: 'Page title', description: 'About it', siteName: 'Example', image: { url: 'https://images.alummahnow.net/community-posts/c1/link-x.png', alt: null, width: null, height: null } });
    render(<Harness initial={{ url: 'https://example.org/a', title: 'My own title' }} />);
    fireEvent.click(screen.getByTestId('link-fetch'));
    await waitFor(() => expect(screen.getByTestId('link-preview-status')).toHaveAttribute('data-state', 'done'));
    expect(preview).toHaveBeenCalledWith('c1', 'https://example.org/a');
    expect(latest.title).toBe('My own title');
    expect(latest.siteName).toBe('Example');
    expect(latest.description).toBe('About it');
    expect(latest.image?.url).toContain('images.alummahnow.net');
    expect(screen.getByTestId('link-preview-status')).toHaveTextContent('Preview filled in');
  });

  it('says so when the page has no preview, and does nothing for an invalid address', async () => {
    preview.mockResolvedValue(null);
    render(<Harness initial={{ url: 'https://example.org/b' }} />);
    fireEvent.click(screen.getByTestId('link-fetch'));
    await waitFor(() => expect(screen.getByTestId('link-preview-status')).toHaveAttribute('data-state', 'failed'));
    fireEvent.change(document.getElementById('link-url')!, { target: { value: 'not a url' } });
    expect(screen.getByTestId('link-fetch')).toBeDisabled();
  });
});
