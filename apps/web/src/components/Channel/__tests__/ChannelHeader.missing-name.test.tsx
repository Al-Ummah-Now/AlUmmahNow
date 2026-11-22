/**
 * The channel header renders for a channel whose name is missing, empty or Arabic (CI: the
 * server render of a channel page aborted with "Cannot read properties of undefined (reading
 * 'charAt')"), and a named channel renders exactly as before.
 */
import { render, screen } from '@testing-library/react';
import type { Channel } from '@al-ummah/shared-types';
import { ChannelHeader as ChannelHeaderLTR } from '../ChannelHeader';
import { ChannelHeader as ChannelHeaderRTL } from '../rtl/ChannelHeader';

jest.mock('next/image', () => ({ __esModule: true, default: ({ alt }: { alt: string }) => <span data-alt={alt} /> }));
jest.mock('@/hooks/useMultiAccount', () => ({ useMultiAccount: () => ({ user: null, loading: false }) }));
jest.mock('@/hooks/useChannelSubscription', () => ({
  useChannelSubscription: () => ({ isSubscribed: false, subscriberCount: 0, isChecking: false, isUpdating: false, error: null, toggle: jest.fn() }),
}));
jest.mock('@/components/notifications/ChannelBellMenu', () => ({ ChannelBellMenu: () => null }));
jest.mock('@/components/Channel/ChannelOwnerActions', () => ({ ChannelOwnerActions: () => null }));
jest.mock('@/components/share/ShareLinkButton', () => ({ ShareLinkButton: () => null }));
jest.mock('@/lib/logger-client', () => ({ logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() } }));

function channel(overrides: Record<string, unknown>): Channel {
  return { id: 'ch-1', userId: 'u-1', name: 'Salam Channel', isMain: true, dateCreated: '2026-11-01T00:00:00Z', ...overrides } as unknown as Channel;
}

const headers = [
  ['en', ChannelHeaderLTR],
  ['ar', ChannelHeaderRTL],
] as const;

describe.each(headers)('ChannelHeader (%s)', (locale, Header) => {
  const avatar = () => screen.getByTestId('channel-header-avatar');
  const title = () => screen.getByRole('heading', { level: 1 });

  it('renders a channel with no name: the handle is the title and its initial', () => {
    render(<Header channel={channel({ name: undefined, handle: 'salam' })} locale={locale} />);
    expect(title()).toHaveTextContent('@salam');
    // Left to right even on /ar, so the "@" stays in front
    expect(title().querySelector('[dir="ltr"]')).toHaveTextContent('@salam');
    expect(avatar()).toHaveTextContent('S');
    // The handle is not repeated under a title that already is the handle
    expect(screen.queryByTestId('channel-handle')).toBeNull();
  });

  it('renders a channel with an empty name and no handle: the neutral glyph and a label', () => {
    render(<Header channel={channel({ name: '', nameLocalized: { en: '', ar: '' } })} locale={locale} />);
    expect(avatar()).toHaveTextContent('?');
    expect(title()).toHaveTextContent(locale === 'ar' ? 'قناة بلا اسم' : 'Unnamed channel');
  });

  it('takes the first Arabic grapheme whole', () => {
    render(<Header channel={channel({ name: 'Mercy', nameLocalized: { [locale]: 'مُحمد للمرئيات' } })} locale={locale} />);
    expect(avatar().textContent).toBe('مُ');
    expect(title()).toHaveTextContent('مُحمد للمرئيات');
  });

  it('renders a named channel as before: its name, initial and handle line', () => {
    render(<Header channel={channel({ handle: 'salam' })} locale={locale} />);
    expect(title()).toHaveTextContent('Salam Channel');
    expect(avatar().textContent).toBe('S');
    expect(screen.getByTestId('channel-handle')).toHaveTextContent('@salam');
  });
});
