/**
 * Browser Turnstile helper (docs/features/bot-protection.md): token on success, null on
 * error, the panel only shows when Cloudflare needs a click, and test keys use the stub.
 */
jest.mock('@/lib/logger-client', () => ({ logger: { debug: jest.fn(), warn: jest.fn(), info: jest.fn(), error: jest.fn() } }));
import { getTurnstileToken, isTestSiteKey } from '../client';

type Opts = Record<string, (arg?: string) => unknown>;
const opts = { siteKey: '1x00000000000000000000AA', action: 'comment', locale: 'en' as const, dialogLabel: 'Confirm that you are not a robot' };

function fakeApi(behaviour: (o: Opts, el: HTMLElement) => void) {
  const removed: string[] = [];
  window.turnstile = {
    render: (el: HTMLElement, o: Record<string, unknown>) => {
      setTimeout(() => behaviour(o as Opts, el), 0);
      return 'w1';
    },
    remove: (id: string) => void removed.push(id),
  };
  return removed;
}

describe('Turnstile client', () => {
  afterEach(() => {
    delete window.turnstile;
    document.body.innerHTML = '';
  });

  it('knows the documented test site keys', () => {
    expect(isTestSiteKey('1x00000000000000000000AA')).toBe(true);
    expect(isTestSiteKey('3x00000000000000000000FF')).toBe(true);
    expect(isTestSiteKey('0x4AAAAAAF_3KPNkPlEGf_dP')).toBe(false);
  });

  it('resolves the token, renders interaction-only and removes the widget and panel', async () => {
    let seen: Opts = {};
    const removed = fakeApi((o) => {
      seen = o;
      o.callback('tok-1');
    });
    await expect(getTurnstileToken(opts)).resolves.toBe('tok-1');
    expect((seen as unknown as Record<string, unknown>).appearance).toBe('interaction-only');
    expect((seen as unknown as Record<string, unknown>).action).toBe('comment');
    expect(removed).toEqual(['w1']);
    expect(document.querySelector('[data-testid="turnstile-panel"]')).toBeNull();
  });

  it('shows the labelled panel only when Cloudflare needs a click', async () => {
    let panel: HTMLElement | null = null;
    fakeApi((o, el) => {
      panel = el;
      expect(el.style.display).toBe('none');
      o['before-interactive-callback']();
      expect(el.style.display).toBe('block');
      expect(el.getAttribute('role')).toBe('dialog');
      expect(el.getAttribute('aria-label')).toBe(opts.dialogLabel);
      o.callback('tok-2');
    });
    await expect(getTurnstileToken(opts)).resolves.toBe('tok-2');
    expect(panel).not.toBeNull();
  });

  it('answers null when the widget fails', async () => {
    fakeApi((o) => void o['error-callback']('110200'));
    await expect(getTurnstileToken(opts)).resolves.toBeNull();
  });
});
