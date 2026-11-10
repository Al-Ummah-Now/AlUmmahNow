/**
 * Channel sections, tab configuration and upload templates under concurrent
 * edits (docs/architecture/SCALABILITY-AUDIT.md, AV-20).
 *
 * - Section order lives in one conditionally written document per channel,
 *   so parallel creates get distinct positions, the section limit holds, and
 *   a delete or reorder racing a create never loses or duplicates a slot.
 * - The tab configuration is updated on the fresh copy (both edits land).
 * - The default template of a scope is one conditionally written pointer,
 *   so "set as default" at once from several places leaves exactly one.
 *
 * Runs the real endpoints against an R2 fake that honours `onlyIf` and widens
 * the read → write window (SlowBucket).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CHANNEL_SECTION_CONSTRAINTS, DEFAULT_CHANNEL_TABS } from '@al-ummah/shared-types';
import { ChannelSectionCreate } from '../src/endpoints/channel-section/channelSectionCreate';
import { ChannelSectionDelete } from '../src/endpoints/channel-section/channelSectionDelete';
import { ChannelSectionReorder } from '../src/endpoints/channel-section/channelSectionReorder';
import { ChannelSectionUpdate } from '../src/endpoints/channel-section/channelSectionUpdate';
import { ChannelSectionFetch } from '../src/endpoints/channel-section/channelSectionFetch';
import { ChannelSectionsList } from '../src/endpoints/channel-section/channelSectionList';
import { ChannelTabsUpdate } from '../src/endpoints/channel/channelTabsUpdate';
import { CreateUploadDefaultEndpoint, ListUploadDefaultsEndpoint } from '../src/endpoints/settings/uploadDefaults';
import {
	DeleteUploadDefaultEndpoint,
	GetUploadDefaultEndpoint,
	SetDefaultTemplateEndpoint,
	UpdateUploadDefaultEndpoint,
} from '../src/endpoints/settings/uploadDefaultsById';
import { removeChannelContent } from '../src/lib/channelDeletion';
import { sectionOrderKey } from '../src/lib/channelSectionOrder';
import { defaultPointerKey } from '../src/lib/uploadDefaultPointer';
import { MemoryBucket, MemoryQueue, SlowBucket, buildApp } from './helpers';

const json = { 'Content-Type': 'application/json' };
const ME = 'owner';
const CH = 'ch';
const MAX = CHANNEL_SECTION_CONSTRAINTS.MAX_SECTIONS_PER_CHANNEL;

function routes(r: any) {
	r.get('/api/channels/:channelId/sections', ChannelSectionsList);
	r.get('/api/channels/:channelId/sections/:sectionId', ChannelSectionFetch);
	r.post('/api/channels/:channelId/sections', ChannelSectionCreate);
	r.put('/api/channels/:channelId/sections/:sectionId', ChannelSectionUpdate);
	r.delete('/api/channels/:channelId/sections/:sectionId', ChannelSectionDelete);
	r.patch('/api/channels/:channelId/sections/reorder', ChannelSectionReorder);
	r.put('/api/channels/:id/tabs', ChannelTabsUpdate);
	r.get('/api/upload-defaults', ListUploadDefaultsEndpoint);
	r.post('/api/upload-defaults', CreateUploadDefaultEndpoint);
	r.get('/api/upload-defaults/:id', GetUploadDefaultEndpoint);
	r.put('/api/upload-defaults/:id', UpdateUploadDefaultEndpoint);
	r.delete('/api/upload-defaults/:id', DeleteUploadDefaultEndpoint);
	r.put('/api/upload-defaults/:id/default', SetDefaultTemplateEndpoint);
}

function env(sections: Record<string, unknown> = {}, templates: Record<string, unknown> = {}) {
	return {
		channels: new MemoryBucket({ [CH]: { id: CH, userId: ME, name: 'Channel', isMain: true } }),
		channel_sections: new SlowBucket(sections),
		channel_tabs: new SlowBucket({}),
		'upload-defaults': new SlowBucket(templates),
		videos: new MemoryBucket(),
		playlists: new MemoryBucket(),
		community_posts: new MemoryBucket(),
		queue: new MemoryQueue(),
	};
}

const app = buildApp(routes, { userId: ME });
const send = (e: any, method: string, path: string, body?: unknown) =>
	app.request(path, { method, headers: json, body: body === undefined ? undefined : JSON.stringify(body) }, e);

const createSection = (e: any, title: string) => send(e, 'POST', `/api/channels/${CH}/sections`, { type: 'recent_uploads', title });
const listSections = async (e: any) => ((await (await send(e, 'GET', `/api/channels/${CH}/sections`)).json()) as any).result.sections as any[];

/** Positions are exactly 0..n-1, each once. */
function assertContiguous(sections: any[]) {
	assert.deepEqual(sections.map((s) => s.position), sections.map((_, i) => i), `positions ${sections.map((s) => s.position)}`);
}

const legacySection = (id: string, position: number) => ({
	id, channelId: CH, userId: ME, type: 'recent_uploads', title: `Legacy ${id}`, position, style: 'horizontal_row',
	videoIds: [], playlistIds: [], channelIds: [], itemCount: 12, showTimestamp: true, showChannelName: false,
	dateCreated: '2026-01-01T00:00:00.000Z', dateModified: '2026-01-01T00:00:00.000Z',
});

describe('channel sections: order in one document (AV-20)', () => {
	it('parallel creates get distinct positions and the limit holds exactly', async () => {
		const e = env();
		const statuses = await Promise.all(Array.from({ length: MAX + 4 }, (_, i) => createSection(e, `S${i}`).then((r) => r.status)));
		assert.equal(statuses.filter((s) => s === 201).length, MAX, `exactly ${MAX} created: ${statuses}`);
		assert.equal(statuses.filter((s) => s === 400).length, 4);
		const sections = await listSections(e);
		assert.equal(sections.length, MAX);
		assertContiguous(sections);
		assert.deepEqual(e.channel_sections.read(sectionOrderKey(CH)).sectionIds, sections.map((s) => s.id));
	});

	it('a legacy channel (positions on the sections) keeps its order and stays contiguous through parallel edits', async () => {
		const e = env({ [`${CH}/a`]: legacySection('a', 0), [`${CH}/b`]: legacySection('b', 1), [`${CH}/c`]: legacySection('c', 2) });
		assert.deepEqual((await listSections(e)).map((s) => s.id), ['a', 'b', 'c'], 'read from positions before any order document');
		const [created] = await Promise.all([
			createSection(e, 'New'),
			send(e, 'DELETE', `/api/channels/${CH}/sections/b`),
			createSection(e, 'New 2'),
		]);
		assert.equal(created.status, 201);
		const sections = await listSections(e);
		assert.equal(sections.length, 4);
		assert.ok(!sections.some((s) => s.id === 'b'), 'the deleted section is gone');
		assert.deepEqual(sections.slice(0, 2).map((s) => s.id), ['a', 'c'], 'existing order kept');
		assertContiguous(sections);
	});

	it('a reorder racing a create keeps the new section and applies the order', async () => {
		const e = env({ [`${CH}/a`]: legacySection('a', 0), [`${CH}/b`]: legacySection('b', 1), [`${CH}/c`]: legacySection('c', 2) });
		const [reorder, created] = await Promise.all([
			send(e, 'PATCH', `/api/channels/${CH}/sections/reorder`, { sectionIds: ['c', 'b', 'a'] }),
			createSection(e, 'New'),
		]);
		assert.equal(created.status, 201);
		const newId = ((await created.json()) as any).result.section.id;
		const sections = await listSections(e);
		assert.ok(sections.some((s) => s.id === newId), 'the created section is listed');
		assertContiguous(sections);
		if (reorder.status === 200) {
			assert.deepEqual(sections.filter((s) => s.id !== newId).map((s) => s.id), ['c', 'b', 'a']);
		} else {
			assert.equal(reorder.status, 400);
		}
	});

	it('parallel reorders end in exactly one of the requested orders', async () => {
		const e = env({ [`${CH}/a`]: legacySection('a', 0), [`${CH}/b`]: legacySection('b', 1), [`${CH}/c`]: legacySection('c', 2) });
		const orders = [['c', 'b', 'a'], ['b', 'a', 'c'], ['a', 'c', 'b'], ['c', 'a', 'b']];
		const statuses = await Promise.all(orders.map((sectionIds) => send(e, 'PATCH', `/api/channels/${CH}/sections/reorder`, { sectionIds }).then((r) => r.status)));
		assert.ok(statuses.every((s) => s === 200));
		const final = (await listSections(e)).map((s) => s.id);
		assert.ok(orders.some((o) => o.join() === final.join()), `final ${final} is one of the requests`);
	});

	it('an edit racing a reorder keeps both; fetch reports the position from the order', async () => {
		const e = env({ [`${CH}/a`]: legacySection('a', 0), [`${CH}/b`]: legacySection('b', 1) });
		await Promise.all([
			send(e, 'PUT', `/api/channels/${CH}/sections/a`, { title: 'Edited' }),
			send(e, 'PATCH', `/api/channels/${CH}/sections/reorder`, { sectionIds: ['b', 'a'] }),
		]);
		const fetched = ((await (await send(e, 'GET', `/api/channels/${CH}/sections/a`)).json()) as any).result.section;
		assert.equal(fetched.title, 'Edited');
		assert.equal(fetched.position, 1);
		const edit = await send(e, 'PUT', `/api/channels/${CH}/sections/gone`, { title: 'x' });
		assert.equal(edit.status, 404);
		assert.equal(await e.channel_sections.get(`${CH}/gone`), null, 'editing a missing section creates nothing');
	});

	it('deleting the channel removes the order document too', async () => {
		const e = env();
		await createSection(e, 'S');
		assert.ok(await e.channel_sections.get(sectionOrderKey(CH)));
		await removeChannelContent(e as any, CH);
		assert.equal(await e.channel_sections.get(sectionOrderKey(CH)), null);
		assert.equal((await e.channel_sections.list({ prefix: `${CH}/` })).objects.length, 0);
	});
});

describe('channel tabs (AV-20)', () => {
	it('parallel edits of different tabs all land; the defaults are never mutated', async () => {
		const e = env();
		const before = JSON.stringify(DEFAULT_CHANNEL_TABS);
		const tabs = DEFAULT_CHANNEL_TABS.slice(0, 4);
		const statuses = await Promise.all(tabs.map((tab: any) =>
			send(e, 'PUT', `/api/channels/${CH}/tabs`, { tabs: [{ id: tab.id, nameLocalized: { en: `Renamed ${tab.id}` } }] }).then((r) => r.status)));
		assert.ok(statuses.every((s) => s === 200), statuses.join());
		const config = e.channel_tabs.read(`channel-tabs/${CH}`);
		for (const tab of tabs as any[]) {
			assert.equal(config.tabs.find((t: any) => t.id === tab.id).nameLocalized.en, `Renamed ${tab.id}`);
		}
		assert.equal(config.version, 1 + tabs.length, 'every edit counted');
		assert.equal(JSON.stringify(DEFAULT_CHANNEL_TABS), before);
	});

	it('an invalid default tab is refused on the fresh config', async () => {
		const e = env();
		const res = await send(e, 'PUT', `/api/channels/${CH}/tabs`, { defaultTab: 'nope' });
		assert.equal(res.status, 400);
		assert.equal(await e.channel_tabs.get(`channel-tabs/${CH}`), null);
	});
});

describe('upload templates: one default per scope (AV-20)', () => {
	const createTemplate = async (e: any, name: string, isDefault = false) =>
		((await (await send(e, 'POST', '/api/upload-defaults', { name, isDefault, template: { title: name } })).json()) as any).result.template;
	const list = async (e: any) => ((await (await send(e, 'GET', '/api/upload-defaults?limit=50')).json()) as any).result;

	it('setting different templates as default in parallel leaves exactly one', async () => {
		const e = env();
		const templates = [];
		for (let i = 0; i < 10; i++) templates.push(await createTemplate(e, `T${i}`));
		const statuses = await Promise.all(templates.map((t) => send(e, 'PUT', `/api/upload-defaults/${t.id}/default`).then((r) => r.status)));
		assert.ok(statuses.every((s) => s === 200));
		const result = await list(e);
		const defaults = result.templates.filter((t: any) => t.isDefault);
		assert.equal(defaults.length, 1);
		assert.equal(result.defaultTemplateId, defaults[0].id);
	});

	it('parallel creates marked default leave exactly one default', async () => {
		const e = env();
		await Promise.all(Array.from({ length: 8 }, (_, i) => createTemplate(e, `T${i}`, true)));
		const result = await list(e);
		assert.equal(result.templates.length, 8);
		assert.equal(result.templates.filter((t: any) => t.isDefault).length, 1);
	});

	it('legacy flags count until the scope has a pointer; unset and delete clear the default', async () => {
		const now = '2026-01-01T00:00:00.000Z';
		const legacy = (id: string, isDefault: boolean) => ({ id, userId: ME, name: id, isDefault, isActive: true, template: {}, createdAt: now, updatedAt: now, usageCount: 0 });
		const e = env({}, { [`${ME}/a`]: legacy('a', true), [`${ME}/b`]: legacy('b', false) });
		assert.equal((await list(e)).defaultTemplateId, 'a', 'legacy flag');

		await send(e, 'PUT', '/api/upload-defaults/b', { isDefault: true });
		let result = await list(e);
		assert.deepEqual(result.templates.filter((t: any) => t.isDefault).map((t: any) => t.id), ['b']);
		assert.equal(e['upload-defaults'].read(defaultPointerKey(ME)).defaultTemplateId, 'b');
		const got = ((await (await send(e, 'GET', '/api/upload-defaults/a')).json()) as any).result.template;
		assert.equal(got.isDefault, false, 'a stale legacy flag no longer counts');

		await send(e, 'PUT', '/api/upload-defaults/b', { isDefault: false });
		result = await list(e);
		assert.equal(result.templates.filter((t: any) => t.isDefault).length, 0);

		await send(e, 'PUT', '/api/upload-defaults/a/default');
		const del = await send(e, 'DELETE', '/api/upload-defaults/a');
		assert.equal(del.status, 204);
		assert.equal((await list(e)).defaultTemplateId, undefined);
	});

	it('an edit racing "set as default" keeps both', async () => {
		const e = env();
		const t = await createTemplate(e, 'T');
		await Promise.all([
			send(e, 'PUT', `/api/upload-defaults/${t.id}`, { name: 'Renamed' }),
			send(e, 'PUT', `/api/upload-defaults/${t.id}/default`),
		]);
		const result = await list(e);
		assert.equal(result.templates[0].name, 'Renamed');
		assert.equal(result.defaultTemplateId, t.id);
	});
});
