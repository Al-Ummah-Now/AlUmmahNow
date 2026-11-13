/**
 * Studio → Site → Domains (#1212): lists domains with the DNS records to copy, adds one, explains
 * errors in words, says "not available yet" while Cloudflare for SaaS is off, removes through the
 * in-app dialog (never window.confirm). The proxy only maps the known routes.
 */
import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { SiteDomains } from '../SiteDomains';
import { upstreamPath } from '@/lib/studio/site-domains';

jest.mock('@/hooks/useLanguage', () => ({
  useLanguage: () => ({ t: jest.requireActual('@/lib/i18n/translations/en').EN_TRANSLATIONS, lang: 'en', locale: 'en', isRTL: false }),
}));
jest.mock('@/lib/logger-client', () => ({ logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() } }));

const domain = (host: string, status: string) => ({
  host,
  cfId: 'cf1',
  status,
  records: [
    { type: 'CNAME', name: host, value: 'sites.alummahnow.org', purpose: 'traffic' },
    { type: 'TXT', name: `_cf-custom-hostname.${host}`, value: 'own-token', purpose: 'ownership' },
  ],
  addedAt: '2026-11-13T10:00:00Z',
  addedBy: 'u',
  checkedAt: '2026-11-13T10:05:00Z',
  error: null,
});
const view = (domains: unknown[], limit = 2) => ({ domains, hosts: [{ host: 'scholar.alummahnow.org', kind: 'subdomain', primary: true }], primaryHost: 'scholar.alummahnow.org', limit });
const reply = (status: number, body: unknown) => Promise.resolve({ ok: status < 400, status, json: async () => body });
const ok = (result: unknown, status = 200) => reply(status, { success: true, result });
const no = (code: string, status: number) => reply(status, { success: false, code });

let fetchMock: jest.Mock;
beforeEach(() => {
  fetchMock = jest.fn();
  global.fetch = fetchMock as never;
  window.confirm = jest.fn(() => true);
});

describe('SiteDomains', () => {
  it('shows the records to add with copy buttons, and adds a domain', async () => {
    fetchMock.mockImplementationOnce(() => ok(view([domain('www.example.com', 'waiting_dns')])));
    render(<SiteDomains channelId="ch1" locale="en" />);
    const item = await screen.findByTestId('site-domain');
    expect(within(item).getByTestId('site-domain-status')).toHaveTextContent('Waiting for DNS');
    expect(within(item).getByText('sites.alummahnow.org')).toBeInTheDocument();
    expect(within(item).getAllByRole('button', { name: /^Copy/ }).length).toBe(4);
    fetchMock.mockImplementationOnce(() => ok({ domain: domain('blog.example.org', 'waiting_dns') }, 201));
    fireEvent.change(screen.getByLabelText('Domain'), { target: { value: 'blog.example.org' } });
    fireEvent.click(screen.getByTestId('site-domain-add'));
    await waitFor(() => expect(screen.getAllByTestId('site-domain')).toHaveLength(2));
    expect(fetchMock).toHaveBeenLastCalledWith('/api/studio/site-domains/ch1', expect.objectContaining({ method: 'POST', body: JSON.stringify({ host: 'blog.example.org' }) }));
  });

  it('says own domains are not available yet while SaaS is off', async () => {
    fetchMock.mockImplementationOnce(() => no('saas_unavailable', 503));
    render(<SiteDomains channelId="ch1" locale="en" />);
    expect(await screen.findByTestId('site-domains-unavailable')).toHaveTextContent("aren't available yet");
  });

  it('explains a taken domain in words', async () => {
    fetchMock.mockImplementationOnce(() => ok(view([])));
    render(<SiteDomains channelId="ch1" locale="en" />);
    await screen.findByLabelText('Domain');
    fetchMock.mockImplementationOnce(() => no('host_taken', 409));
    fireEvent.change(screen.getByLabelText('Domain'), { target: { value: 'taken.example.com' } });
    fireEvent.click(screen.getByTestId('site-domain-add'));
    expect(await screen.findByRole('alert')).toHaveTextContent('already used by another site');
  });

  it('in a test environment, names the test-domain suffix', async () => {
    fetchMock.mockImplementationOnce(() => ok(view([])));
    render(<SiteDomains channelId="ch1" locale="en" />);
    await screen.findByLabelText('Domain');
    fetchMock.mockImplementationOnce(() => no('domain_test_only', 400));
    fireEvent.change(screen.getByLabelText('Domain'), { target: { value: 'www.example.com' } });
    fireEvent.click(screen.getByTestId('site-domain-add'));
    expect(await screen.findByRole('alert')).toHaveTextContent('only test domains ending in qa-sites.alummahnow.com');
  });

  it('a plan without own domains says so', async () => {
    fetchMock.mockImplementationOnce(() => ok(view([], 0)));
    render(<SiteDomains channelId="ch1" locale="en" />);
    expect(await screen.findByTestId('site-domains-not-included')).toBeInTheDocument();
  });

  it('removes through the in-app dialog, never window.confirm', async () => {
    fetchMock.mockImplementationOnce(() => ok(view([domain('www.example.com', 'live')])));
    render(<SiteDomains channelId="ch1" locale="en" />);
    fireEvent.click(await screen.findByTestId('site-domain-remove'));
    const dialog = await screen.findByTestId('site-domain-remove-dialog');
    fetchMock.mockImplementationOnce(() => ok(view([])));
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Remove' }));
    });
    await waitFor(() => expect(screen.queryByTestId('site-domain')).toBeNull());
    expect(window.confirm).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenLastCalledWith('/api/studio/site-domains/ch1/www.example.com', expect.objectContaining({ method: 'DELETE' }));
  });

  it('the proxy maps only the Studio routes', () => {
    expect(upstreamPath('GET', 'ch1', [])).toBe('/internal/site-domains/ch1/domains');
    expect(upstreamPath('POST', 'ch1', ['www.example.com', 'refresh'])).toBe('/internal/site-domains/ch1/domains/www.example.com/refresh');
    expect(upstreamPath('DELETE', 'ch1', ['WWW.Example.com'])).toBe('/internal/site-domains/ch1/domains/www.example.com');
    expect(upstreamPath('PUT', 'ch1', ['primary'])).toBe('/internal/site-domains/ch1/primary');
    expect(upstreamPath('GET', '../x', [])).toBeNull();
    expect(upstreamPath('DELETE', 'ch1', ['a/b'])).toBeNull();
    expect(upstreamPath('PATCH', 'ch1', [])).toBeNull();
  });
});
