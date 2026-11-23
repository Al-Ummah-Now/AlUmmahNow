/**
 * Bilingual admin forms (ChannelActions, VideoActions, InviteForm): every localizable field renders
 * paired English (LTR) + Arabic (RTL) inputs with Translate buttons, validates both languages with
 * no silent fallback, and sends the localized maps to the API.
 */
import './support/next-navigation-stub';
import Module from 'node:module';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import * as React from 'react';

(globalThis as unknown as { React: unknown }).React = React;

const req = Module.createRequire(__filename);
const recorded = {
  updateChannel: [] as Array<[string, Record<string, unknown>]>,
  updateVideo: [] as Array<[string, Record<string, unknown>]>,
  createInvite: [] as Array<Record<string, unknown>>,
};

function stubAbs(relPath: string, exports: Record<string, unknown>) {
  const id = path.resolve(__dirname, relPath);
  const stub = new Module(id);
  stub.filename = id;
  stub.loaded = true;
  stub.exports = { __esModule: true, ...exports };
  req.cache[id] = stub;
}

const okAction = () => Promise.resolve({ ok: true, data: {} });

stubAbs('../src/lib/api/content.ts', {
  updateChannel: async (id: string, body: Record<string, unknown>) => {
    recorded.updateChannel.push([id, body]);
    return { ok: true, data: {} };
  },
  updateVideo: async (id: string, body: Record<string, unknown>) => {
    recorded.updateVideo.push([id, body]);
    return { ok: true, data: {} };
  },
  deleteChannel: okAction,
  setChannelVerified: okAction,
  suspendChannel: okAction,
  unsuspendChannel: okAction,
  uploadChannelImage: okAction,
  deleteVideo: okAction,
  moveVideo: okAction,
  uploadVideoThumbnail: okAction,
  videoAction: okAction,
});

stubAbs('../src/lib/api/invites.ts', {
  createInvite: async (body: Record<string, unknown>) => {
    recorded.createInvite.push(body);
    return { ok: true, data: { invite: { id: 'inv_1', userId: 'usr_1' }, warnings: [] } };
  },
  lookupInviteEmail: async () => ({ ok: true, data: { authUser: null, profile: null, invite: null } }),
});

stubAbs('../src/lib/api/localized.ts', {
  translateAdminFields: async () => ({ ok: false, status: 500, error: 'unused' }),
});

stubAbs('../src/lib/api/admin.ts', {
  markProcessingFailed: okAction,
  retryProcessing: okAction,
  syncProcessing: okAction,
});

describe('bilingual admin forms in a DOM', () => {
  let dom: JSDOM;

  before(() => {
    dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
    const g = globalThis as Record<string, unknown>;
    for (const k of [
      'window',
      'document',
      'navigator',
      'HTMLElement',
      'Node',
      'Event',
      'MouseEvent',
      'KeyboardEvent',
      'HTMLInputElement',
      'HTMLTextAreaElement',
      'HTMLSelectElement',
      'getComputedStyle',
      'FormData',
    ]) {
      Object.defineProperty(g, k, { value: (dom.window as unknown as Record<string, unknown>)[k], configurable: true, writable: true });
    }
    g.IS_REACT_ACT_ENVIRONMENT = true;
  });

  after(() => dom.window.close());

  async function mount(element: React.ReactElement, locale: 'en' | 'ar' = 'en') {
    const { createRoot } = await import('react-dom/client');
    const { I18nProvider } = await import('../src/i18n/I18nProvider');
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    const Provider = I18nProvider as unknown as React.FC<{ locale: string; theme: string; children?: React.ReactNode }>;
    await React.act(async () => root.render(React.createElement(Provider, { locale, theme: 'light' }, element)));
    return {
      container,
      q: (id: string) => container.querySelector(`[data-testid="${id}"]`),
      unmount: () =>
        React.act(() => {
          root.unmount();
          container.remove();
        }),
    };
  }

  const click = (el: Element | null) =>
    React.act(async () => void (el as HTMLElement).dispatchEvent(new window.MouseEvent('click', { bubbles: true })));

  const submitForm = (form: Element | null) =>
    React.act(async () => void (form as HTMLFormElement).dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })));

  const type = (el: Element | null, text: string) =>
    React.act(async () => {
      const input = el as HTMLInputElement | HTMLTextAreaElement;
      const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value')!.set!;
      setter.call(input, text);
      input.dispatchEvent(new window.Event('input', { bubbles: true }));
    });

  it('ChannelActions validates EN+AR pairs and sends nameLocalized & descriptionLocalized', async () => {
    recorded.updateChannel.length = 0;
    const { ChannelActions } = await import('../src/app/(protected)/channels/[id]/ChannelActions');
    const m = await mount(
      React.createElement(ChannelActions, {
        channel: {
          id: 'ch_1',
          name: 'Old Name',
          nameLocalized: { en: 'Old Name', ar: 'الاسم القديم' },
          handle: 'old',
          description: 'Old Desc',
          descriptionLocalized: { en: 'Old Desc', ar: 'الوصف القديم' },
          isVerified: false,
          isSuspended: false,
          isDeleted: false,
          ownerId: 'usr_1',
          videos: 0,
          playlists: 0,
        },
        permissions: ['channels:manage'],
      }),
    );

    const nameEn = m.q('channel-edit-name') as HTMLInputElement;
    const nameAr = m.q('channel-edit-name-ar') as HTMLInputElement;
    const descEn = m.q('channel-edit-description') as HTMLTextAreaElement;
    const descAr = m.q('channel-edit-description-ar') as HTMLTextAreaElement;
    assert.equal(nameEn.getAttribute('dir'), 'ltr');
    assert.equal(nameAr.getAttribute('dir'), 'rtl');
    assert.equal(descEn.getAttribute('dir'), 'ltr');
    assert.equal(descAr.getAttribute('dir'), 'rtl');
    assert.ok(m.q('channel-edit-name-translate-en'), 'has EN→AR translate button for name');
    assert.ok(m.q('channel-edit-description-translate-en'), 'has EN→AR translate button for description');

    const form = m.container.querySelector('[data-testid="channel-edit"] form');

    // Blank Arabic name → blocked client-side
    await type(nameEn, 'New Name');
    await type(nameAr, '');
    await submitForm(form);
    assert.equal(recorded.updateChannel.length, 0, 'one-sided name must not be sent');
    assert.equal(nameAr.getAttribute('aria-invalid'), 'true');

    // Fill both EN + AR for name and description → submits localized payload
    await type(nameAr, 'اسم جديد');
    await type(descEn, 'New Desc');
    await type(descAr, 'وصف جديد');
    await submitForm(form);
    assert.equal(recorded.updateChannel.length, 1);
    assert.deepEqual(recorded.updateChannel[0], [
      'ch_1',
      {
        name: 'New Name',
        nameLocalized: { en: 'New Name', ar: 'اسم جديد' },
        description: 'New Desc',
        descriptionLocalized: { en: 'New Desc', ar: 'وصف جديد' },
      },
    ]);

    await m.unmount();
  });

  it('VideoActions validates EN+AR pairs and sends titleLocalized & descriptionLocalized', async () => {
    recorded.updateVideo.length = 0;
    const { VideoActions } = await import('../src/app/(protected)/videos/[id]/VideoActions');
    const m = await mount(
      React.createElement(VideoActions, {
        video: {
          id: 'vid_1',
          title: 'Old Title',
          titleLocalized: { en: 'Old Title', ar: 'العنوان القديم' },
          description: '',
          descriptionLocalized: {},
          isPublic: true,
          isDeleted: false,
          unpublished: false,
          status: 'ready',
          processing: null,
        },
        permissions: ['videos:manage'],
      }),
    );

    const titleEn = m.q('video-edit-title') as HTMLInputElement;
    const titleAr = m.q('video-edit-title-ar') as HTMLInputElement;
    const descEn = m.q('video-edit-description') as HTMLTextAreaElement;
    const descAr = m.q('video-edit-description-ar') as HTMLTextAreaElement;
    assert.equal(titleEn.getAttribute('dir'), 'ltr');
    assert.equal(titleAr.getAttribute('dir'), 'rtl');
    assert.ok(m.q('video-edit-title-translate-en'));
    assert.ok(m.q('video-edit-description-translate-en'));

    const form = m.container.querySelector('[data-testid="video-edit"] form');

    // One-sided description (EN only) → blocked client-side
    await type(descEn, 'Summary only in English');
    await submitForm(form);
    assert.equal(recorded.updateVideo.length, 0, 'one-sided description must not be sent');
    assert.equal(descAr.getAttribute('aria-invalid'), 'true');

    // Fill both title and description → submits localized payload
    await type(titleEn, 'New Title');
    await type(titleAr, 'عنوان جديد');
    await type(descAr, 'ملخص بالعربية');
    await submitForm(form);
    assert.equal(recorded.updateVideo.length, 1);
    assert.deepEqual(recorded.updateVideo[0], [
      'vid_1',
      {
        title: 'New Title',
        titleLocalized: { en: 'New Title', ar: 'عنوان جديد' },
        description: 'Summary only in English',
        descriptionLocalized: { en: 'Summary only in English', ar: 'ملخص بالعربية' },
      },
    ]);

    await m.unmount();
  });

  it('InviteForm requires EN+AR for new channels and sends nameLocalized', async () => {
    recorded.createInvite.length = 0;
    const { InviteForm } = await import('../src/components/invites/InviteForm');
    const m = await mount(
      React.createElement(InviteForm, {
        tiers: [{ id: 'free', name: 'Free', nameAr: 'مجاني' }],
        defaultTierId: 'free',
        canPlan: true,
        canCreateChannels: true,
        canTransfer: false,
      }),
    );

    await type(m.q('invite-email'), 'scholar@example.com');
    await click(m.q('invite-add-channel'));

    const chEn = m.q('invite-channel-name') as HTMLInputElement;
    const chAr = m.q('invite-channel-name-ar') as HTMLInputElement;
    assert.equal(chEn.getAttribute('dir'), 'ltr');
    assert.equal(chAr.getAttribute('dir'), 'rtl');
    assert.ok(m.q('invite-channel-name-0-translate-en'));

    const form = m.q('invite-form');

    // EN-only channel name → blocked client-side
    await type(chEn, 'Al-Bayan');
    await submitForm(form);
    assert.equal(recorded.createInvite.length, 0, 'one-sided invite channel name must not be sent');
    assert.equal(chAr.getAttribute('aria-invalid'), 'true');

    // Fill AR name → submits with nameLocalized
    await type(chAr, 'البيان');
    await submitForm(form);
    assert.equal(recorded.createInvite.length, 1);
    const created = (recorded.createInvite[0]!.channels as { create: Array<Record<string, unknown>> }).create;
    assert.deepEqual(created, [{ name: 'Al-Bayan', nameLocalized: { en: 'Al-Bayan', ar: 'البيان' } }]);

    await m.unmount();
  });
});
