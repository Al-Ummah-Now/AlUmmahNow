/**
 * Channel invitations, the team activity log, team notifications, limits,
 * live key rotation, the daily sweep, erasure and export
 * (docs/specs/CHANNEL-ROLES.md §4, §9 to §13).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CHANNEL_INVITE_RATE, MAX_PENDING_CHANNEL_INVITES, MAX_SHARED_CHANNELS, channelRoleOf, normalizeInviteEmail } from '@al-ummah/shared-types';
import { ChannelAuditList, ChannelInviteAccept, ChannelInviteCancel, ChannelInviteCreate, ChannelInviteDecline, MyChannelInvites } from '../src/endpoints/channel/channelInvites';
import { ChannelMemberRemove, ChannelMemberUpdate, ChannelMembersList } from '../src/endpoints/channel/channelMembers';
import { STALE_CLAIM_MS, anonymizeTeamActivity, cancelInvitesOfUser, expireInvites, pruneTeamActivity, resolveStaleClaims, teamSeatLimit } from '../src/lib/channelTeam';
import { memberMayActAs, roleOnChannel } from '../src/lib/channelAccess';
import { transformChannelToView } from '../src/lib/transformations';
import { runOwnershipPass } from '../src/lib/search/ownership';
import { collectUserData, eraseUserData, DELETED_USER_ID } from '../src/lib/privacy/user-data';
import { OperationBudget } from '../src/lib/privacy/scan';
import { MemoryBucket, MemoryQueue, buildApp } from './helpers';
import { SqliteD1 } from './search-sqlite-d1';

const ROUTES = (r: any) => {
	r.get('/api/channels/:id/members', ChannelMembersList);
	r.put('/api/channels/:id/members/:userId', ChannelMemberUpdate);
	r.delete('/api/channels/:id/members/:userId', ChannelMemberRemove);
	r.post('/api/channels/:id/invites', ChannelInviteCreate);
	r.delete('/api/channels/:id/invites/:inviteId', ChannelInviteCancel);
	r.get('/api/channels/:id/audit', ChannelAuditList);
	r.get('/api/channel-invites', MyChannelInvites);
	r.post('/api/channel-invites/:id/accept', ChannelInviteAccept);
	r.post('/api/channel-invites/:id/decline', ChannelInviteDecline);
};

const json = (body: unknown) => ({ headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

function channel(id: string, overrides: Record<string, unknown> = {}) {
	return {
		id, name: `Channel ${id}`, userId: 'owner', email: 'owner@test.local', isMain: false,
		dateCreated: '2026-01-01T00:00:00.000Z', dateModified: '2026-01-01T00:00:00.000Z',
		playlists: [], videos: [], subscribers: [], subscriptions: [], likes: [],
		...overrides,
	};
}

const member = (userId: string, role: string) => ({ userId, role, addedBy: 'owner', addedAt: '2026-11-01T00:00:00.000Z' });

function teamEnv(channels: Record<string, unknown> = {}) {
	const db = new SqliteD1();
	const env = {
		SEARCH_DB: db,
		videos: new MemoryBucket(),
		channels: new MemoryBucket({
			team: channel('team', { members: [member('admin1', 'admin'), member('ed', 'editor')] }),
			saraMain: channel('saraMain', { userId: 'sara', handle: 'SaraTalks' }),
			...channels,
		}),
		playlists: new MemoryBucket(),
		community_posts: new MemoryBucket(),
		profiles: new MemoryBucket({ owner: { id: 'owner', displayName: 'Owner' }, sara: { id: 'sara', displayName: 'Sara' }, admin1: { id: 'admin1', displayName: 'Amal' }, ed: { id: 'ed', displayName: 'Ed' } }),
		channel_tabs: new MemoryBucket({ 'channel-handles/saratalks': { channelId: 'saraMain', handle: 'SaraTalks' } }),
		queue: new MemoryQueue(),
	};
	return { db, env };
}

const ChannelTeamRoleOf = async (env: unknown) => (channelId: string, userId: string) => roleOnChannel(env as never, channelId, userId);
const as = (userId: string) => buildApp(ROUTES, { userId });
const invite = (env: unknown, actorId: string, body: unknown, channelId = 'team') =>
	as(actorId).request(`/api/channels/${channelId}/invites`, { method: 'POST', ...json(body) }, env as never);
const myInvites = async (env: unknown, userId: string) =>
	((await (await as(userId).request('/api/channel-invites', {}, env as never)).json()) as any).data.invites as any[];
const respond = (env: unknown, userId: string, id: string, action: 'accept' | 'decline') =>
	as(userId).request(`/api/channel-invites/${id}/${action}`, { method: 'POST' }, env as never);
const codeOf = async (res: Response) => ((await res.json()) as any).code;
const notifications = (env: { queue: MemoryQueue }) => env.queue.messages.filter((m) => m.type === 'notification_create' || m.payload?.notificationKey).map((m) => m.payload);
const auditRows = (db: SqliteD1) =>
	(db.db.prepare('SELECT actor_id, action, target_user_id, old_role, new_role FROM channel_audit ORDER BY created_at, rowid').all() as any[]).map((r) => ({ ...r }));
const inviteRows = (db: SqliteD1) => (db.db.prepare('SELECT * FROM channel_invites ORDER BY created_at, id').all() as any[]).map((r) => ({ ...r }));

describe('inviting (§4.1, §4.2)', () => {
	it('a handle invitation notifies the invitee; accepting adds the role, logs it and tells the inviter', async () => {
		const { env, db } = teamEnv();
		const sent = await invite(env, 'owner', { handle: '@SaraTalks', role: 'editor' });
		assert.equal(sent.status, 200);
		assert.match(sent.headers.get('cache-control') ?? '', /no-store/);
		assert.deepEqual(notifications(env).map((n) => [n.notificationKey, n.recipientUserId, n.params.role, n.params.inviter]), [['channelInviteReceived', 'sara', 'editor', 'Owner']]);

		const [mine] = await myInvites(env, 'sara');
		assert.equal(mine.channel.id, 'team');
		assert.equal(mine.invitedBy.displayName, 'Owner');
		assert.equal((await respond(env, 'sara', mine.id, 'accept')).status, 200);
		assert.equal(channelRoleOf(env.channels.read('team'), 'sara'), 'editor');
		assert.equal(notifications(env).at(-1).notificationKey, 'channelInviteAccepted');
		assert.equal(notifications(env).at(-1).recipientUserId, 'owner');
		assert.deepEqual(auditRows(db).map((r) => r.action), ['invite_sent', 'invite_accepted']);
		assert.equal(inviteRows(db)[0].status, 'accepted');
	});

	it('an email invitation looks nothing up, notifies nobody, and is matched to the invitee\'s token email (any case)', async () => {
		const { env, db } = teamEnv();
		const known = await invite(env, 'owner', { email: 'Sara@Test.Local', role: 'moderator' });
		const unknown = await invite(env, 'owner', { email: 'nobody@example.com', role: 'moderator' });
		assert.equal(known.status, 200);
		assert.equal(unknown.status, 200);
		assert.equal(notifications(env).length, 0);
		const pending = ((await (await as('owner').request('/api/channels/team/members', {}, env as never)).json()) as any).data.invites;
		assert.deepEqual(pending.map((i: any) => i.inviteeEmail), ['sara@test.local', 'nobody@example.com']);

		const [mine] = await myInvites(env, 'sara');
		assert.equal(inviteRows(db)[0].invitee_user_id, 'sara', 'tied to the account on first sight');
		const afterSeen = ((await (await as('owner').request('/api/channels/team/members', {}, env as never)).json()) as any).data.invites[0];
		assert.deepEqual(Object.keys(afterSeen).sort(), ['createdAt', 'expiresAt', 'id', 'invitedBy', 'inviteeEmail', 'role'], 'the inviter never learns which account owns the email');
		assert.equal((await respond(env, 'sara', mine.id, 'accept')).status, 200);
		assert.equal(channelRoleOf(env.channels.read('team'), 'sara'), 'moderator');
		assert.equal(inviteRows(db)[0].invitee_email, null, 'the email is cleared when it closes');
	});

	it('normalizes invitation emails, and a hostile string is refused fast (no backtracking)', () => {
		assert.equal(normalizeInviteEmail('  Sara@Test.Local '), 'sara@test.local');
		for (const bad of ['', 'sara', '@test.local', 'sara@', 'sara@local', 'sara@.local', 'sara@local.', 'a@b@c.d', 'sa ra@test.local', 42, null]) {
			assert.equal(normalizeInviteEmail(bad), null, String(bad));
		}
		assert.equal(normalizeInviteEmail(`${'a'.repeat(250)}@b.cd`), null, 'longer than 254');
		const started = performance.now();
		normalizeInviteEmail(`!@!.${'!.'.repeat(200_000)}`);
		assert.ok(performance.now() - started < 50);
	});

	it('an email invitation never names its account to the inviter: Activity, duplicate checks, declines', async () => {
		const { env, db } = teamEnv();
		await invite(env, 'owner', { email: 'sara@test.local', role: 'moderator' });
		await myInvites(env, 'sara'); // tied to sara's account on first sight
		// A handle invitation to the same account is not refused: refusing would confirm who owns the email
		assert.equal((await invite(env, 'owner', { handle: 'SaraTalks', role: 'editor' })).status, 200);
		const listed = await myInvites(env, 'sara');
		assert.equal(listed.length, 1, 'one invitation per channel is listed');
		assert.equal(listed[0].role, 'editor', 'the @handle one first');

		const emailRow = inviteRows(db).find((r) => r.by_email === 1)!;
		assert.equal((await as('owner').request(`/api/channels/team/invites/${emailRow.id}`, { method: 'DELETE' }, env as never)).status, 200);
		const audit = ((await (await as('owner').request('/api/channels/team/audit', {}, env as never)).json()) as any).data.entries as any[];
		const emailEntries = audit.filter((e) => e.action === 'invite_cancelled' || (e.action === 'invite_sent' && e.newRole === 'moderator'));
		assert.equal(emailEntries.length, 2);
		assert.ok(emailEntries.every((e) => !e.targetUserId && !e.targetName), 'no account on the email invitation\'s rows');

		// Declining an email invitation is "someone declined"
		await invite(env, 'admin1', { email: 'ed@test.local', role: 'moderator' });
		const { env: env2, db: db2 } = teamEnv();
		await invite(env2, 'owner', { email: 'sara@test.local', role: 'moderator' });
		const [mine] = await myInvites(env2, 'sara');
		assert.equal((await respond(env2, 'sara', mine.id, 'decline')).status, 200);
		const declined = auditRows(db2).find((r) => r.action === 'invite_declined')!;
		assert.notEqual(declined.actor_id, 'sara');
		assert.equal(declined.target_user_id, null);
	});

	it('a removed member\'s older invitations cannot bring them back', async () => {
		// Stamps compare by millisecond: step past one between the changes
		const tick = () => new Promise((resolve) => setTimeout(resolve, 3));
		const withSara = () => teamEnv({ team: channel('team', { members: [member('admin1', 'admin'), member('ed', 'editor'), member('sara', 'moderator')] }) });
		// An email invitation sent while she was on the team, already seen (tied): it stays
		// visibly pending (closing it would name the account to the inviter), but can't be used
		const { env, db } = withSara();
		await invite(env, 'owner', { email: 'sara@test.local', role: 'admin' });
		await tick();
		await myInvites(env, 'sara');
		assert.equal((await as('owner').request('/api/channels/team/members/sara', { method: 'DELETE' }, env as never)).status, 200);
		assert.equal(inviteRows(db)[0].status, 'pending');
		assert.ok(env.channels.read('team').memberChangedAt?.sara, 'the removal is stamped on the channel record, in the same write');
		const view = transformChannelToView(env.channels.read('team') as never) as Record<string, unknown>;
		assert.equal('memberChangedAt' in view, false, 'never in a channel view');
		assert.equal('members' in view, false);
		const [tied] = await myInvites(env, 'sara');
		assert.equal(await codeOf(await respond(env, 'sara', tied.id, 'accept')), 'invite_not_found');
		assert.equal(channelRoleOf(env.channels.read('team'), 'sara'), null);

		// The stamp holds even when the activity log can't be written
		const { env: env4 } = withSara();
		await invite(env4, 'owner', { email: 'sara@test.local', role: 'admin' });
		await tick();
		(env4 as any).SEARCH_DB.db.exec('DROP TABLE channel_audit');
		assert.equal((await as('owner').request('/api/channels/team/members/sara', { method: 'DELETE' }, env4 as never)).status, 200);
		const [stale] = await myInvites(env4, 'sara');
		assert.equal(await codeOf(await respond(env4, 'sara', stale.id, 'accept')), 'invite_not_found');
		assert.equal(channelRoleOf(env4.channels.read('team'), 'sara'), null);

		// Leaving outranks an older invitation too
		const { env: env3 } = withSara();
		await invite(env3, 'owner', { email: 'sara@test.local', role: 'admin' });
		await tick();
		assert.equal((await as('sara').request('/api/channels/team/members/sara', { method: 'DELETE' }, env3 as never)).status, 200);
		const [old] = await myInvites(env3, 'sara');
		assert.equal(await codeOf(await respond(env3, 'sara', old.id, 'accept')), 'invite_not_found');
		assert.equal(channelRoleOf(env3.channels.read('team'), 'sara'), null);

		// One not yet seen (not tied) still lists, but accepting is refused
		const { env: env2, db: db2 } = withSara();
		await invite(env2, 'owner', { email: 'sara@test.local', role: 'admin' });
		await tick();
		assert.equal((await as('owner').request('/api/channels/team/members/sara', { method: 'DELETE' }, env2 as never)).status, 200);
		const [left] = await myInvites(env2, 'sara');
		assert.equal(await codeOf(await respond(env2, 'sara', left.id, 'accept')), 'invite_not_found');
		assert.equal(channelRoleOf(env2.channels.read('team'), 'sara'), null);
		assert.equal(inviteRows(db2)[0].status, 'cancelled');

		// A new invitation after the removal works
		await tick();
		await invite(env2, 'owner', { handle: 'SaraTalks', role: 'moderator' });
		const [fresh] = await myInvites(env2, 'sara');
		assert.equal((await respond(env2, 'sara', fresh.id, 'accept')).status, 200);
		assert.equal(channelRoleOf(env2.channels.read('team'), 'sara'), 'moderator');
	});

	it('refuses with the spec codes', async () => {
		const { env } = teamEnv();
		assert.equal(await codeOf(await invite(env, 'owner', { email: 'owner@test.local', role: 'editor' })), 'cannot_invite_owner');
		assert.equal(await codeOf(await invite(env, 'admin1', { email: 'x@test.local', role: 'owner' })), 'invalid_role');
		assert.equal(await codeOf(await invite(env, 'admin1', { email: 'x@test.local', role: 'admin' })), 'forbidden');
		assert.equal(await codeOf(await invite(env, 'ed', { email: 'x@test.local', role: 'moderator' })), 'forbidden');
		assert.equal(await codeOf(await invite(env, 'stranger', { email: 'x@test.local', role: 'moderator' })), 'forbidden');
		assert.equal((await invite(env, 'owner', { handle: 'SaraTalks', role: 'editor' })).status, 200);
		assert.equal(await codeOf(await invite(env, 'owner', { handle: 'saratalks', role: 'moderator' })), 'already_invited');
		assert.equal((await invite(env, 'owner', { email: 'x', role: 'editor' })).status, 400);
	});

	it('the team is full when members plus pending invitations reach the seat limit', async () => {
		const limit = teamSeatLimit('owner');
		assert.equal(limit, 50);
		const members = Array.from({ length: limit - 1 }, (_, i) => member(`m${i}`, 'editor'));
		const { env } = teamEnv({ full: channel('full', { members }) });
		assert.equal((await invite(env, 'owner', { email: 'one@example.com', role: 'editor' }, 'full')).status, 200);
		const res = await invite(env, 'owner', { email: 'two@example.com', role: 'editor' }, 'full');
		assert.equal(res.status, 409);
		assert.equal(await codeOf(res), 'member_limit');
	});

	it('50 pending invitations is the most; then 409 pending_limit', async () => {
		const { env, db } = teamEnv({ big: channel('big', { members: [] }) });
		const now = new Date().toISOString();
		const later = new Date(Date.now() + 86_400_000).toISOString();
		for (let i = 0; i < MAX_PENDING_CHANNEL_INVITES; i++) {
			db.db.prepare("INSERT INTO channel_invites (id, channel_id, role, invitee_email, invited_by, status, created_at, expires_at) VALUES (?, 'big', 'editor', ?, 'owner', 'pending', '2026-01-01T00:00:00.000Z', ?)").run(`i${i}`, `p${i}@example.com`, later);
		}
		void now;
		assert.equal(await codeOf(await invite(env, 'owner', { email: 'more@example.com', role: 'editor' }, 'big')), 'pending_limit');
	});

	it('rate limits: 30 per inviter per hour (429 rate_limited)', async () => {
		const { env, db } = teamEnv();
		const recent = new Date(Date.now() - 60_000).toISOString();
		for (let i = 0; i < CHANNEL_INVITE_RATE.perInviterHour; i++) {
			db.db.prepare("INSERT INTO channel_invites (id, channel_id, role, invitee_email, invited_by, status, created_at, expires_at, responded_at) VALUES (?, 'elsewhere', 'editor', NULL, 'owner', 'cancelled', ?, ?, ?)").run(`r${i}`, recent, recent, recent);
		}
		const res = await invite(env, 'owner', { email: 'late@example.com', role: 'editor' });
		assert.equal(res.status, 429);
		assert.equal(await codeOf(res), 'rate_limited');
		assert.equal((await invite(env, 'admin1', { email: 'late@example.com', role: 'editor' })).status, 200, 'another inviter is not limited');
	});
});

describe('responding (§4.2)', () => {
	it('expired, closed and other people\'s invitations are the same 404 invite_not_found; a double accept adds once', async () => {
		const { env, db } = teamEnv();
		await invite(env, 'owner', { handle: 'SaraTalks', role: 'editor' });
		const [mine] = await myInvites(env, 'sara');
		assert.equal(await codeOf(await respond(env, 'ed', mine.id, 'accept')), 'invite_not_found');
		assert.equal((await respond(env, 'sara', mine.id, 'accept')).status, 200);
		assert.equal(await codeOf(await respond(env, 'sara', mine.id, 'accept')), 'invite_not_found');
		assert.equal(env.channels.read('team').members.filter((m: any) => m.userId === 'sara').length, 1);

		await invite(env, 'owner', { email: 'late@example.com', role: 'editor' });
		const late = inviteRows(db).find((r) => r.invitee_email === 'late@example.com');
		db.db.prepare('UPDATE channel_invites SET expires_at = ? WHERE id = ?').run('2020-01-01T00:00:00.000Z', late.id);
		const lateApp = buildApp(ROUTES, { userId: 'late' });
		assert.equal((await lateApp.request(`/api/channel-invites/${late.id}/accept`, { method: 'POST' }, env as never)).status, 404);
	});

	it('decline closes it, logs it and notifies nobody; cancel closes a pending one', async () => {
		const { env, db } = teamEnv();
		await invite(env, 'owner', { handle: 'SaraTalks', role: 'editor' });
		const [mine] = await myInvites(env, 'sara');
		assert.equal((await respond(env, 'sara', mine.id, 'decline')).status, 200);
		assert.equal(channelRoleOf(env.channels.read('team'), 'sara'), null);
		assert.equal(notifications(env).length, 1, 'only the invitation itself');

		await invite(env, 'admin1', { email: 'x@example.com', role: 'moderator' });
		const open = inviteRows(db).find((r) => r.status === 'pending');
		assert.equal((await as('ed').request(`/api/channels/team/invites/${open.id}`, { method: 'DELETE' }, env as never)).status, 403);
		const cancelled = await as('admin1').request(`/api/channels/team/invites/${open.id}`, { method: 'DELETE' }, env as never);
		assert.equal(cancelled.status, 200);
		assert.deepEqual(((await cancelled.json()) as any).data.invites, []);
		assert.deepEqual(auditRows(db).map((r) => r.action), ['invite_sent', 'invite_declined', 'invite_sent', 'invite_cancelled']);
	});

	it('an invitation from someone who no longer may give that role cannot be accepted', async () => {
		const { env, db } = teamEnv();
		await invite(env, 'admin1', { handle: 'SaraTalks', role: 'editor' });
		const [mine] = await myInvites(env, 'sara');
		// Demoted behind the API's back (the cancel step skipped): accept still refuses
		const record = env.channels.read('team');
		record.members = record.members.map((m: any) => (m.userId === 'admin1' ? { ...m, role: 'moderator' } : m));
		await env.channels.put('team', JSON.stringify(record));
		const res = await respond(env, 'sara', mine.id, 'accept');
		assert.equal(res.status, 404);
		assert.equal(await codeOf(res), 'invite_not_found');
		assert.equal(channelRoleOf(env.channels.read('team'), 'sara'), null);
		assert.equal(inviteRows(db)[0].status, 'cancelled');
	});

	it('a cancel during an accept wins: the grant is undone and the invitation stays cancelled; a full team reopens it', async () => {
		const { env, db } = teamEnv();
		await invite(env, 'owner', { handle: 'SaraTalks', role: 'editor' });
		const [mine] = await myInvites(env, 'sara');
		// The R2 write is slow; a cancel arrives while the claim is held
		const realPut = env.channels.put.bind(env.channels);
		let cancelDuring: Response | null = null;
		(env.channels as any).put = async (...args: any[]) => {
			if (!cancelDuring) cancelDuring = await as('owner').request(`/api/channels/team/invites/${mine.id}`, { method: 'DELETE' }, env as never);
			return realPut(...(args as [string, string]));
		};
		const accepted = await respond(env, 'sara', mine.id, 'accept');
		(env.channels as any).put = realPut;
		assert.equal(cancelDuring!.status, 200, 'the cancel closes a claimed invitation');
		assert.equal(await codeOf(accepted), 'invite_not_found');
		assert.equal(channelRoleOf(env.channels.read('team'), 'sara'), null, 'the revocation won: the role was taken back');
		assert.equal(channelRoleOf(env.channels.read('team'), 'ed'), 'editor', 'nobody else was touched');
		assert.equal(inviteRows(db)[0].status, 'cancelled');
		assert.ok(!auditRows(db).some((r) => r.action === 'invite_accepted'));

		const full = Array.from({ length: teamSeatLimit('owner') }, (_, i) => member(`m${i}`, 'editor'));
		const { env: env2, db: db2 } = teamEnv({ full: channel('full', { members: full.slice(0, -1) }) });
		await invite(env2, 'owner', { email: 'sara@test.local', role: 'editor' }, 'full');
		const [waiting] = await myInvites(env2, 'sara');
		const record = env2.channels.read('full');
		record.members = full;
		await env2.channels.put('full', JSON.stringify(record));
		const res = await respond(env2, 'sara', waiting.id, 'accept');
		assert.equal(await codeOf(res), 'member_limit');
		const [row] = inviteRows(db2);
		assert.equal(row.status, 'pending', 'reopened for when a seat frees up');
		assert.equal(row.invitee_email, 'sara@test.local');

		// A revocation while a refused accept holds the claim is not undone by the reopen
		const realGet = env2.channels.get.bind(env2.channels);
		let erased = false;
		(env2.channels as any).get = async (...args: any[]) => {
			if (!erased && inviteRows(db2)[0].status === 'claimed') { erased = true; await cancelInvitesOfUser(db2 as never, 'sara'); }
			return realGet(...(args as [string]));
		};
		assert.equal(await codeOf(await respond(env2, 'sara', waiting.id, 'accept')), 'member_limit');
		(env2.channels as any).get = realGet;
		assert.ok(erased, 'the erasure ran while the claim was held');
		const [after] = inviteRows(db2);
		assert.equal(after.status, 'cancelled', 'the reopen did not bring it back');
		assert.equal(after.invitee_email, null, 'erasure cleared the email of the claimed row');
	});

	it('accepting with 50 shared channels already is 409 shared_limit', async () => {
		const { env, db } = teamEnv();
		await runOwnershipPass(env as never, 'channel', { maxPages: 10 });
		for (let i = 0; i < MAX_SHARED_CHANNELS; i++) {
			db.db.prepare("INSERT INTO channel_access (channel_id, user_id, role, source_version) VALUES (?, 'sara', 'editor', 1)").run(`other${i}`);
		}
		await invite(env, 'owner', { handle: 'SaraTalks', role: 'editor' });
		const [mine] = await myInvites(env, 'sara');
		const res = await respond(env, 'sara', mine.id, 'accept');
		assert.equal(res.status, 409);
		assert.equal(await codeOf(res), 'shared_limit');
	});

	it('accepting needs no auth call and no token change (separation)', async () => {
		const { env } = teamEnv();
		await invite(env, 'owner', { handle: 'SaraTalks', role: 'admin' });
		const [mine] = await myInvites(env, 'sara');
		const realFetch = globalThis.fetch;
		let calls = 0;
		globalThis.fetch = (async () => { calls++; return new Response('{}'); }) as typeof fetch;
		try {
			assert.equal((await respond(env, 'sara', mine.id, 'accept')).status, 200);
		} finally {
			globalThis.fetch = realFetch;
		}
		assert.equal(calls, 0);
	});

	it('a member acting as another channel may still respond to invitations and invite on their own team', () => {
		assert.equal(memberMayActAs('moderator', 'POST', '/api/channel-invites/abc/accept'), true);
		assert.equal(memberMayActAs('moderator', 'POST', '/api/channel-invites/abc/decline'), true);
		assert.equal(memberMayActAs('editor', 'POST', '/api/channels/team/invites'), true);
		assert.equal(memberMayActAs('editor', 'POST', '/api/channels/team/members'), false, 'the direct grant is gone');
	});
});

describe('change, remove, leave (§4.3, §9, §10)', () => {
	it('role change and removal are logged and notified; leaving tells the owner', async () => {
		const { env, db } = teamEnv();
		assert.equal((await as('owner').request('/api/channels/team/members/ed', { method: 'PUT', ...json({ role: 'moderator' }) }, env as never)).status, 200);
		assert.equal((await as('owner').request('/api/channels/team/members/admin1', { method: 'DELETE' }, env as never)).status, 200);
		const { env: env2, db: db2 } = teamEnv();
		assert.equal((await as('ed').request('/api/channels/team/members/ed', { method: 'DELETE' }, env2 as never)).status, 200);
		assert.deepEqual(auditRows(db).map((r) => [r.action, r.target_user_id, r.old_role, r.new_role]), [
			['role_changed', 'ed', 'editor', 'moderator'],
			['member_removed', 'admin1', 'admin', null],
		]);
		assert.deepEqual(notifications(env).map((n) => [n.notificationKey, n.recipientUserId]), [['channelRoleChanged', 'ed'], ['channelMemberRemoved', 'admin1']]);
		assert.deepEqual(auditRows(db2).map((r) => r.action), ['member_left']);
		assert.deepEqual(notifications(env2).map((n) => [n.notificationKey, n.recipientUserId, n.params.member]), [['channelMemberLeft', 'owner', 'Ed']]);
	});

	it('a member who loses members.manage has their pending invitations cancelled', async () => {
		const { env, db } = teamEnv();
		await invite(env, 'admin1', { email: 'a@example.com', role: 'editor' });
		await invite(env, 'owner', { email: 'b@example.com', role: 'editor' });
		await as('owner').request('/api/channels/team/members/admin1', { method: 'PUT', ...json({ role: 'editor' }) }, env as never);
		const rows = inviteRows(db);
		assert.equal(rows.find((r) => r.invited_by === 'admin1').status, 'cancelled');
		assert.equal(rows.find((r) => r.invited_by === 'owner').status, 'pending');
	});

	it('removing a live.manage holder ends the channel\'s unstarted live sessions (new key next start); one on air keeps running', async () => {
		const { env, db } = teamEnv();
		const insert = db.db.prepare("INSERT INTO live_sessions (id, stream_id, channel_id, provider, status, reason, created_at) VALUES (?, ?, 'team', 'selfhosted', ?, 'start', ?)");
		insert.run('s-ready', 'st1', 'provisioned', Date.now());
		insert.run('s-air', 'st2', 'live', Date.now());
		insert.run('s-other', 'st3', 'provisioned', Date.now());
		db.db.prepare("UPDATE live_sessions SET channel_id = 'elsewhere' WHERE id = 's-other'").run();
		assert.equal((await as('owner').request('/api/channels/team/members/admin1', { method: 'DELETE' }, env as never)).status, 200);
		const status = (id: string) => (db.db.prepare('SELECT status, end_reason FROM live_sessions WHERE id = ?').get(id) as any);
		assert.equal(status('s-ready').status, 'ended');
		assert.equal(status('s-ready').end_reason, 'key_rotated');
		assert.equal(status('s-air').status, 'live');
		assert.equal(status('s-other').status, 'provisioned');
		assert.ok(auditRows(db).some((r) => r.action === 'stream_key_rotated' && r.target_user_id === 'admin1'));
	});

	it('the Activity tab: members.view only, newest first, names resolved, cursor paged', async () => {
		const { env } = teamEnv();
		await invite(env, 'owner', { handle: 'SaraTalks', role: 'editor' });
		await as('owner').request('/api/channels/team/members/ed', { method: 'PUT', ...json({ role: 'moderator' }) }, env as never);
		assert.equal((await as('ed').request('/api/channels/team/audit', {}, env as never)).status, 403);
		const page1 = ((await (await as('admin1').request('/api/channels/team/audit?limit=1', {}, env as never)).json()) as any).data;
		assert.equal(page1.entries[0].action, 'role_changed');
		assert.equal(page1.entries[0].actorName, 'Owner');
		assert.equal(page1.entries[0].targetName, 'Ed');
		assert.ok(page1.nextCursor);
		const page2 = ((await (await as('admin1').request(`/api/channels/team/audit?limit=1&cursor=${encodeURIComponent(page1.nextCursor)}`, {}, env as never)).json()) as any).data;
		assert.equal(page2.entries[0].action, 'invite_sent');
		assert.equal(page2.entries[0].targetName, 'Sara');
	});
});

describe('daily sweep, erasure, export (§9, §11, §12)', () => {
	it('expires invitations after 14 days (email cleared, logged) and drops activity older than a year', async () => {
		const { env, db } = teamEnv();
		await invite(env, 'owner', { email: 'old@example.com', role: 'editor' });
		const in15Days = new Date(Date.now() + 15 * 86_400_000);
		assert.equal(await expireInvites(db as never, in15Days), 1);
		const [row] = inviteRows(db);
		assert.equal(row.status, 'expired');
		assert.equal(row.invitee_email, null);
		assert.deepEqual(auditRows(db).map((r) => r.action), ['invite_sent', 'invite_expired']);
		const inTwoYears = new Date(Date.now() + 2 * 365 * 86_400_000);
		assert.ok((await pruneTeamActivity(db as never, inTwoYears)) >= 2);
		assert.deepEqual(auditRows(db), []);
		assert.deepEqual(inviteRows(db), [], 'closed invitations age out too');
	});

	it('the daily sweep settles claims an accept left behind: accepted when they hold the role, else reopened or expired', async () => {
		const { env, db } = teamEnv();
		await invite(env, 'owner', { handle: 'SaraTalks', role: 'editor' });
		await invite(env, 'owner', { email: 'gone@example.com', role: 'moderator' });
		await invite(env, 'owner', { email: 'late@example.com', role: 'moderator' });
		const rows = inviteRows(db);
		const find = (pred: (r: any) => boolean) => rows.find(pred)!;
		const toSara = find((r) => r.invitee_user_id === 'sara');
		const toGone = find((r) => r.invitee_email === 'gone@example.com');
		const toLate = find((r) => r.invitee_email === 'late@example.com');
		const old = new Date(Date.now() - STALE_CLAIM_MS - 60_000).toISOString();
		db.db.prepare(`UPDATE channel_invites SET status = 'claimed', responded_at = ? WHERE id IN (?, ?, ?)`).run(old, toSara.id, toGone.id, toLate.id);
		db.db.prepare(`UPDATE channel_invites SET invitee_user_id = 'gone' WHERE id = ?`).run(toGone.id);
		db.db.prepare(`UPDATE channel_invites SET invitee_user_id = 'late', expires_at = ? WHERE id = ?`).run(old, toLate.id);
		const record = env.channels.read('team');
		record.members = [...record.members, member('sara', 'editor')];
		await env.channels.put('team', JSON.stringify(record));
		const fresh = await ChannelTeamRoleOf(env);
		assert.equal(await resolveStaleClaims(db as never, fresh), 3);
		const byId = Object.fromEntries(inviteRows(db).map((r) => [r.id, r]));
		assert.equal(byId[toSara.id].status, 'accepted');
		assert.equal(byId[toGone.id].status, 'pending', 'no role: open again for a retry');
		assert.equal(byId[toGone.id].invitee_email, 'gone@example.com');
		assert.equal(byId[toLate.id].status, 'expired');
		assert.equal(byId[toLate.id].invitee_email, null);
		assert.equal(await resolveStaleClaims(db as never, fresh), 0, 'a fresh claim (or none) is left alone');
	});

	it('erasure cancels invitations to and from the account and anonymizes its activity', async () => {
		const { env, db } = teamEnv();
		await invite(env, 'owner', { handle: 'SaraTalks', role: 'editor' });
		await as('owner').request('/api/channels/team/members/ed', { method: 'PUT', ...json({ role: 'moderator' }) }, env as never);
		const cancelled = await cancelInvitesOfUser(db as never, 'sara');
		assert.equal(cancelled.length, 1);
		await anonymizeTeamActivity(db as never, 'ed', DELETED_USER_ID);
		assert.equal(inviteRows(db)[0].status, 'cancelled');
		assert.ok(auditRows(db).every((r) => r.target_user_id !== 'ed'));
		assert.ok(auditRows(db).some((r) => r.target_user_id === DELETED_USER_ID));
	});

	it('eraseUserData strips the membership and cancels invitations; export lists memberships and invitations', async () => {
		const { env, db } = teamEnv();
		await invite(env, 'admin1', { email: 'friend@example.com', role: 'editor' });
		const full = {
			...env,
			channel_sections: new MemoryBucket(),
			watch_history: new MemoryBucket(),
			'upload-defaults': new MemoryBucket(),
			reports: new MemoryBucket(),
		};
		const exported = await collectUserData(full as never, 'admin1', new OperationBudget(10_000));
		assert.deepEqual(exported.channelMemberships.map((m) => [m.channelId, m.role]), [['team', 'admin']]);
		assert.deepEqual(exported.channelInvites.map((i) => [i.direction, i.channelId, i.status]), [['sent', 'team', 'pending']]);
		assert.equal(JSON.stringify(exported.channelInvites).includes('friend@example.com'), false, 'the invitee\'s email is theirs, not in my export');
		await myInvites(env, 'friend'); // no account has that email: still untied
		db.db.prepare(`UPDATE channel_invites SET invitee_user_id = 'friend'`).run();
		const again = await collectUserData(full as never, 'admin1', new OperationBudget(10_000));
		assert.equal(again.channelInvites[0].inviteeUserId, null, 'a sent email invitation never names the account it reached');

		await eraseUserData(full as never, 'admin1', new OperationBudget(10_000));
		assert.equal(channelRoleOf(env.channels.read('team'), 'admin1'), null);
		assert.equal(inviteRows(db)[0].status, 'cancelled');
		assert.ok(auditRows(db).every((r) => r.actor_id !== 'admin1'));
	});
});
