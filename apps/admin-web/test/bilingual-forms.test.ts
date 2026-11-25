/**
 * Bilingual admin forms (ChannelActions, VideoActions, InviteForm): every localizable field renders
 * paired English (LTR) + Arabic (RTL) inputs with Translate buttons, validates both languages with
 * no silent fallback, and sends the localized maps to the API.
 */
import './support/next-navigation-stub';
import Module from 'node:module';
import { readFileSync } from 'node:fs';
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

// The theme builder's live preview is an iframe; its form is what is tested here
stubAbs('../src/app/(protected)/site-theme/builder/Preview.tsx', { Preview: () => null });

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
    React.act(async () => void (el as HTMLElement).click());

  const submitForm = (form: Element | null) =>
    React.act(async () => void (form as HTMLFormElement).requestSubmit());

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
          verificationKind: null,
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

    // The site's own file button: the native one speaks the browser's language
    for (const kind of ['avatar', 'cover']) {
      const file = m.q(`channel-${kind}-input`) as HTMLInputElement;
      assert.equal(file.type, 'file');
      assert.match(file.className, /sr-only/);
      assert.deepEqual([...m.container.querySelectorAll(`label[for="${file.id}"]`)].map((l) => l.textContent), [kind === 'avatar' ? 'Avatar' : 'Cover', 'Choose an image']);
    }

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
        nameLocalized: { en: 'New Name', ar: 'اسم جديد' },
        descriptionLocalized: { en: 'New Desc', ar: 'وصف جديد' },
      },
    ]);

    await m.unmount();
  });

  for (const [locale, words] of [
    ['en', 'Enter the Arabic text, or use Translate.'],
    ['ar', 'أدخل نص العربية، أو استخدم الترجمة.'],
  ] as const) {
    it(`the theme builder words a missing language in the admin's language (${locale})`, async () => {
      const { ThemeEditor } = await import('../src/app/(protected)/site-theme/builder/ThemeEditor');
      const theme = JSON.parse(readFileSync(path.resolve(__dirname, '../../../packages/theme-packages/themes/zujaj/theme.json'), 'utf8'));
      const initial = { ...theme, id: 'ramadan-nights', name: { en: 'Ramadan Nights', ar: 'ليالي رمضان' }, description: { en: 'Blue glass', ar: 'زجاج أزرق' } };
      const m = await mount(React.createElement(ThemeEditor, { initial, assets: [], latestVersion: null, activeVersion: null, canEdit: true }), locale);
      await click(m.q('section-general'));
      const ar = () => m.q('general-description-ar') as HTMLInputElement;
      const error = () => m.container.querySelector(`#${ar().id}-error`)?.textContent ?? null;
      assert.equal(error(), null);
      await type(ar(), '');
      assert.equal(error(), words);
      assert.equal(m.q('general-description-ar')?.tagName, 'TEXTAREA', 'the whole description can be read');
      const listed = m.container.querySelector('[data-path="description.ar"]')?.textContent ?? '';
      assert.ok(listed.includes(locale === 'ar' ? 'املأ هذا الحقل.' : 'Fill this in.') && !listed.includes('must not be empty'), listed);
      assert.equal(m.q('theme-publish-blocked')?.textContent?.includes('WCAG'), false, 'contrast is not the reason');
      await type(m.q('general-description-en'), '');
      assert.equal(error(), null, 'an optional description may go as a whole');
      await m.unmount();
    });

    it(`the theme builder words a problem beside its own section too (${locale})`, async () => {
      const { ThemeEditor } = await import('../src/app/(protected)/site-theme/builder/ThemeEditor');
      const theme = JSON.parse(readFileSync(path.resolve(__dirname, '../../../packages/theme-packages/themes/zujaj/theme.json'), 'utf8'));
      theme.typography.latin = [];
      theme.tokens.elevation[Object.keys(theme.tokens.elevation)[0]] = 5;
      const m = await mount(React.createElement(ThemeEditor, { initial: { ...theme, id: 'ramadan-nights' }, assets: [], latestVersion: null, activeVersion: null, canEdit: true }), locale);
      const typography = locale === 'ar' ? 'الخطوط' : 'Typography';
      for (const [section, words] of [['typography', typography], ['materials', locale === 'ar' ? 'نوع هذه القيمة غير صحيح.' : 'This is the wrong kind of value.']] as const) {
        await click(m.q(`section-${section}`));
        const said = [...m.container.querySelectorAll('[data-testid="field-error"]')].map((e) => e.textContent ?? '').join('\n');
        assert.ok(said.includes(words), `${section}: ${said}`);
        assert.doesNotMatch(said, /must be|needs at least|typography\.|tokens\./);
      }
      await m.unmount();
    });
  }

  // The two forms that edit a user's own text
  const EDITS = [
    {
      form: 'channel-edit',
      main: 'channel-edit-name',
      description: 'channel-edit-description',
      log: recorded.updateChannel,
      keys: { plain: 'name', map: 'nameLocalized' },
      element: async (text: Record<string, unknown>) => {
        const { ChannelActions } = await import('../src/app/(protected)/channels/[id]/ChannelActions');
        return React.createElement(ChannelActions, {
          channel: { id: 'x1', name: '', description: '', handle: 'h', isVerified: false, verificationKind: null, isSuspended: false, isDeleted: false, ownerId: 'usr_1', videos: 0, playlists: 0, ...text } as never,
          permissions: ['channels:manage'] as never,
        });
      },
    },
    {
      form: 'video-edit',
      main: 'video-edit-title',
      description: 'video-edit-description',
      log: recorded.updateVideo,
      keys: { plain: 'title', map: 'titleLocalized' },
      element: async (text: Record<string, unknown>) => {
        const { VideoActions } = await import('../src/app/(protected)/videos/[id]/VideoActions');
        return React.createElement(VideoActions, {
          video: { id: 'x1', title: '', description: '', isPublic: true, isDeleted: false, unpublished: false, status: 'ready', processing: null, ...text } as never,
          permissions: ['videos:manage'] as never,
        });
      },
    },
  ];
  for (const E of EDITS) {
    const open = async (text: Record<string, unknown>, locale: 'en' | 'ar' = 'en') => {
      E.log.length = 0;
      const m = await mount(await E.element(text), locale);
      const input = (id: string) => m.q(id) as HTMLInputElement;
      return {
        ...m,
        en: () => input(E.main),
        ar: () => input(`${E.main}-ar`),
        descEn: () => input(E.description),
        descAr: () => input(`${E.description}-ar`),
        save: () => submitForm(m.container.querySelector(`[data-testid="${E.form}"] form`)),
        sent: () => E.log.map(([, body]) => body),
      };
    };

    it(`${E.form}: a text in one language saves in one language; the other is offered, never required`, async () => {
      for (const [stored, map] of [
        ['Old', undefined],
        ['Old', { en: 'Old' }],
      ] as const) {
        const m = await open({ [E.keys.plain]: stored, ...(map ? { [E.keys.map]: map } : {}) });
        assert.equal(m.en().required, false);
        assert.ok(m.q(`${E.main}-translate-en`), 'Translate is offered');
        assert.ok(m.container.textContent!.includes('One language is enough here'));
        await type(m.en(), 'Fixed');
        await m.save();
        assert.deepEqual(m.sent(), [map ? { [E.keys.map]: { en: 'Fixed' } } : { [E.keys.plain]: 'Fixed' }]);
        await m.unmount();
      }
    });

    it(`${E.form}: an Arabic text stands in the Arabic input, and stays the only one until English is added`, async () => {
      const m = await open({ [E.keys.plain]: 'دروس', description: 'نبذة' }, 'ar');
      assert.deepEqual([m.en().value, m.ar().value, m.descEn().value, m.descAr().value], ['', 'دروس', '', 'نبذة']);
      await type(m.ar(), 'دروس جديدة');
      await m.save();
      assert.deepEqual(m.sent(), [{ [E.keys.plain]: 'دروس جديدة' }]);
      await type(m.en(), 'New lessons');
      await m.save();
      assert.deepEqual(m.sent()[1], { [E.keys.map]: { en: 'New lessons', ar: 'دروس جديدة' } });
      await m.unmount();
    });

    it(`${E.form}: a text with both keeps both; the description may go as a whole`, async () => {
      const m = await open({ [E.keys.plain]: 'Two', [E.keys.map]: { en: 'Two', ar: 'لغتان' }, description: 'About', descriptionLocalized: { en: 'About', ar: 'نبذة' } });
      assert.equal(m.en().required, true);
      assert.equal(m.descEn().required, false, 'the description is optional');
      await type(m.ar(), '');
      await type(m.descEn(), '');
      await m.save();
      assert.deepEqual(m.sent(), []);
      assert.equal(m.ar().getAttribute('aria-invalid'), 'true');
      assert.equal(m.descEn().getAttribute('aria-invalid'), 'true');
      await type(m.ar(), 'لغتان');
      await type(m.descAr(), '');
      await m.save();
      assert.deepEqual(m.sent(), [{ descriptionLocalized: { en: '', ar: '' } }]);
      await m.unmount();
    });

    it(`${E.form}: the main text cannot be emptied, an untouched text is not sent`, async () => {
      const m = await open({ [E.keys.plain]: 'Old', description: 'About' });
      await type(m.en(), '');
      await m.save();
      assert.deepEqual(m.sent(), []);
      assert.equal(m.en().getAttribute('aria-invalid'), 'true');
      await type(m.en(), 'Old');
      await type(m.descAr(), 'نبذة');
      await m.save();
      assert.deepEqual(m.sent(), [{ descriptionLocalized: { ar: 'نبذة' } }]);
      await m.unmount();
    });
  }

  it('InviteForm ignores a blank new-channel row on real submit and validates partial pairs in-app', async () => {
    recorded.createInvite.length = 0;
    const { InviteForm } = await import('../src/components/invites/InviteForm');

    // 1. Blank "Add channel" row + valid invite email submits via real submit button click (noValidate)
    const blank = await mount(
      React.createElement(InviteForm, {
        tiers: [{ id: 'free', name: 'Free', nameAr: 'مجاني' }],
        defaultTierId: 'free',
        canPlan: true,
        canCreateChannels: true,
        canTransfer: false,
      }),
    );
    const blankForm = blank.q('invite-form') as HTMLFormElement;
    assert.equal(blankForm.noValidate, true, 'invite form uses noValidate so in-app validation runs');
    await type(blank.q('invite-email'), 'blankrow@example.com');
    await click(blank.q('invite-add-channel'));
    await click(blank.q('invite-submit'));
    assert.equal(recorded.createInvite.length, 1, 'blank new-channel row must not block a valid invite');
    assert.deepEqual((recorded.createInvite[0]!.channels as { create: unknown[] }).create, []);
    await blank.unmount();

    // 2. One-sided EN-only channel row shows in-app error via real submit button click; filling AR submits
    recorded.createInvite.length = 0;
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

    // EN-only channel name → blocked by in-app validation (not native tooltip)
    await type(chEn, 'Al-Bayan');
    await click(m.q('invite-submit'));
    assert.equal(recorded.createInvite.length, 0, 'one-sided invite channel name must not be sent');
    assert.equal(chAr.getAttribute('aria-invalid'), 'true');

    // Fill AR name → real submit button click sends nameLocalized
    await type(chAr, 'البيان');
    await click(m.q('invite-submit'));
    assert.equal(recorded.createInvite.length, 1);
    const created = (recorded.createInvite[0]!.channels as { create: Array<Record<string, unknown>> }).create;
    assert.deepEqual(created, [{ name: 'Al-Bayan', nameLocalized: { en: 'Al-Bayan', ar: 'البيان' } }]);

    await m.unmount();
  });
});
