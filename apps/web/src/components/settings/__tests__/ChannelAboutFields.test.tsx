/**
 * In-place About editor (links, contact email, location) and the Customize
 * page's draft model.
 */
import React, { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { EN_TRANSLATIONS } from '@/lib/i18n/translations/en';
import { ChannelAboutFields, canSubmitAboutFields, isIncompleteLink, type ChannelAboutValues } from '../ChannelAboutFields';
import { channelDraftFrom, changedChannelFields } from '@/app/[locale]/settings/channel/[id]/edit/draft';
import type { Channel } from '@al-ummah/shared-types';

jest.mock('@/hooks/useLanguage', () => ({
  useLanguage: () => ({ t: EN_TRANSLATIONS, isRTL: false, lang: 'en', locale: 'en', dir: 'ltr' }),
}));

type Details = Omit<ChannelAboutValues, 'handle'>;

function Harness({ initial, editable = true, onValue }: { initial: Details; editable?: boolean; onValue?: (v: Details) => void }) {
  const [value, setValue] = useState(initial);
  return (
    <ChannelAboutFields
      value={value}
      editable={editable}
      onChange={(patch) => {
        const next = { ...value, ...patch };
        setValue(next);
        onValue?.(next);
      }}
    />
  );
}

const base: Details = { links: [{ title: 'Website', url: 'https://example.org/' }], contactEmail: 'hi@example.org', location: 'Amman' };

describe('ChannelAboutFields', () => {
  it('view mode shows the About details as on the channel page', () => {
    render(<Harness initial={base} editable={false} />);
    expect(screen.getByRole('link', { name: 'Website' })).toHaveAttribute('href', 'https://example.org/');
    expect(screen.getByText('hi@example.org')).toBeInTheDocument();
    expect(screen.queryByTestId('channel-add-link')).not.toBeInTheDocument();
  });

  it('opens a link in place and edits title and URL', () => {
    const onValue = jest.fn();
    render(<Harness initial={base} onValue={onValue} />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit Website' }));
    fireEvent.change(screen.getByRole('textbox', { name: /Link title 1/ }), { target: { value: 'Site' } });
    fireEvent.change(screen.getByRole('textbox', { name: /URL .* 1/ }), { target: { value: 'https://noor.example/' } });
    expect(onValue).toHaveBeenLastCalledWith(expect.objectContaining({ links: [{ title: 'Site', url: 'https://noor.example/' }] }));
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(screen.getByRole('button', { name: 'Site' })).toBeInTheDocument();
  });

  it('flags an unsafe URL inline and keeps the row open', () => {
    render(<Harness initial={base} />);
    fireEvent.click(screen.getByTestId('channel-add-link'));
    fireEvent.change(screen.getByRole('textbox', { name: /Link title 2/ }), { target: { value: 'Bad' } });
    fireEvent.change(screen.getByRole('textbox', { name: /URL .* 2/ }), { target: { value: 'javascript:alert(1)' } });
    expect(screen.getByRole('alert')).toHaveTextContent(EN_TRANSLATIONS.channel.invalidLinkUrl);
    expect(screen.getAllByRole('button', { name: 'Done' }).at(-1)).toBeDisabled();
  });

  it('removes a link, and drops an untouched new row when closed', () => {
    const onValue = jest.fn();
    render(<Harness initial={base} onValue={onValue} />);
    fireEvent.click(screen.getByTestId('channel-add-link'));
    expect(screen.getAllByTestId('channel-link-row')).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(screen.getAllByTestId('channel-link-row')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Edit Website' }));
    fireEvent.click(screen.getByRole('button', { name: EN_TRANSLATIONS.channel.removeLink.replace('{n}', '1') }));
    expect(onValue).toHaveBeenLastCalledWith(expect.objectContaining({ links: [] }));
  });

  it('validates the contact email in place', () => {
    render(<Harness initial={base} />);
    fireEvent.click(screen.getByRole('button', { name: `Edit ${EN_TRANSLATIONS.channel.contactEmail}` }));
    const input = screen.getByTestId('channel-contact-input');
    fireEvent.change(input, { target: { value: 'not-an-email' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getByRole('alert')).toHaveTextContent(EN_TRANSLATIONS.channel.invalidEmail);
  });

  it('canSubmitAboutFields blocks bad links, emails and handle states', () => {
    const ok: ChannelAboutValues = { handle: 'noor', ...base };
    expect(canSubmitAboutFields(ok, { state: 'available' })).toBe(true);
    expect(canSubmitAboutFields(ok, { state: 'checking' })).toBe(false);
    expect(canSubmitAboutFields(ok, { state: 'unavailable', reason: 'taken' })).toBe(false);
    expect(canSubmitAboutFields({ ...ok, contactEmail: 'x' }, { state: 'idle' })).toBe(false);
    expect(canSubmitAboutFields({ ...ok, links: [{ title: '', url: 'ftp://x' }] }, { state: 'idle' })).toBe(false);
    expect(isIncompleteLink({ title: '', url: '' })).toBe(false);
  });
});

describe('Customize draft', () => {
  const channel = {
    id: 'c', name: 'Noor', nameLocalized: { en: 'Noor', ar: 'نور' }, description: 'D', handle: 'noor',
    links: [{ title: 'Site', url: 'https://a.example/' }], contactEmail: '', location: 'Amman',
  } as unknown as Channel;

  it('builds the draft from the channel, with localized fallbacks', () => {
    const d = channelDraftFrom(channel);
    expect(d).toMatchObject({ nameEn: 'Noor', nameAr: 'نور', descriptionEn: 'D', descriptionAr: '', handle: 'noor', location: 'Amman' });
  });

  it('lists only the fields that changed, ignoring whitespace, empty link rows and images', () => {
    const saved = channelDraftFrom(channel);
    expect(changedChannelFields(saved, { ...saved, nameEn: ' Noor ', links: [...saved.links, { title: '', url: '' }], avatarUrl: 'blob:x' })).toEqual([]);
    expect(changedChannelFields(saved, { ...saved, nameAr: 'نور الهدى', handle: '@noor', location: 'Cairo' })).toEqual(['nameAr', 'location']);
    expect(changedChannelFields(saved, { ...saved, handle: 'noor2', links: [] })).toEqual(['handle', 'links']);
  });
});
