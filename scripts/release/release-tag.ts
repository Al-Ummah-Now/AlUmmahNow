/**
 * Release tags decide when production is deployed (CLAUDE.md "Deploy Rules").
 * A production release is a tag `vYYYY.MM.DD` (or `vYYYY.MM.DD.N`, N >= 2, for a later
 * release the same day) on a commit that is on `main`. The date is the US Eastern date
 * (America/New_York, owner rule 2026-11-12), not UTC: at 21:00 ET it is still the same day.
 *
 *   pnpm release:tag next                # prints the next tag: today in America/New_York, next free number
 *   pnpm release:tag check <tag> <sha>   # exits non-zero unless <tag> is valid and <sha> is on origin/main
 */
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

const TAG = /^v(\d{4})\.(\d{2})\.(\d{2})(?:\.(\d+))?$/;

export interface ReleaseTag {
	tag: string;
	date: string;
	/** 1 for the day's first release, then 2, 3, ... */
	n: number;
}

/** Parses a release tag, or returns null when the name is not one (bad format, impossible date, `.0`/`.1`). */
export function parseReleaseTag(tag: string): ReleaseTag | null {
	const m = TAG.exec(tag);
	if (!m) return null;
	const [, y, mo, d, nRaw] = m;
	const date = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d)));
	if (date.getUTCFullYear() !== Number(y) || date.getUTCMonth() !== Number(mo) - 1 || date.getUTCDate() !== Number(d)) return null;
	if (nRaw !== undefined && (Number(nRaw) < 2 || nRaw.startsWith('0'))) return null;
	return { tag, date: `${y}-${mo}-${d}`, n: nRaw === undefined ? 1 : Number(nRaw) };
}

/** The time zone release dates are in. */
export const RELEASE_TIME_ZONE = 'America/New_York';

/** YYYY.MM.DD of `now` in America/New_York. */
export function releaseDate(now: Date = new Date()): string {
	const parts = new Intl.DateTimeFormat('en-CA', { timeZone: RELEASE_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
	const part = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
	return `${part('year')}.${part('month')}.${part('day')}`;
}

/** The next release tag for `now`: vYYYY.MM.DD for the day's first release, then .2, .3, ... */
export function nextReleaseTag(tags: readonly string[], now: Date = new Date()): string {
	const date = releaseDate(now);
	const taken = tags
		.map(parseReleaseTag)
		.filter((t): t is ReleaseTag => t !== null && t.date === date.replaceAll('.', '-'))
		.map((t) => t.n);
	const n = taken.length ? Math.max(...taken) + 1 : 1;
	return n === 1 ? `v${date}` : `v${date}.${n}`;
}

export const tagError = (tag: string) =>
	`"${tag}" is not a release tag. Use vYYYY.MM.DD (a real date), or vYYYY.MM.DD.N with N >= 2 for a later release that day.`;

/** The release tag just before `current`, by date then sequence; null for the first release. */
export function previousTag(tags: readonly string[], current: string): string | null {
	const cur = parseReleaseTag(current);
	if (!cur) return null;
	const key = (t: ReleaseTag) => `${t.date}#${String(t.n).padStart(6, '0')}`;
	return (
		tags
			.map(parseReleaseTag)
			.filter((t): t is ReleaseTag => t !== null && key(t) < key(cur))
			.sort((a, b) => (key(a) < key(b) ? -1 : 1))
			.at(-1)?.tag ?? null
	);
}

const git = (...args: string[]) => execFileSync('git', args, { encoding: 'utf8' }).trim();

function isOnMain(sha: string): boolean {
	try {
		git('merge-base', '--is-ancestor', sha, 'origin/main');
		return true;
	} catch {
		return false;
	}
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
	const [cmd, tag, sha] = process.argv.slice(2);
	if (cmd === 'next') {
		console.log(nextReleaseTag(git('tag', '--list', 'v*').split('\n').filter(Boolean)));
		process.exit(0);
	}
	if (cmd !== 'check' || !tag || !sha) {
		console.error('usage: release-tag.ts next | release-tag.ts check <tag> <sha>');
		process.exit(2);
	}
	if (!parseReleaseTag(tag)) {
		console.error(`::error::${tagError(tag)}`);
		process.exit(1);
	}
	if (!isOnMain(sha)) {
		console.error(`::error::${tag} points at ${sha.slice(0, 7)}, which is not on main. Production is released only from main: merge first, then tag a commit on main.`);
		process.exit(1);
	}
	const prev = previousTag(git('tag', '--list', 'v*').split('\n').filter(Boolean), tag);
	console.log(`${tag} (${sha.slice(0, 7)}) is on main; previous release: ${prev ?? 'none'}`);
	if (process.env.GITHUB_OUTPUT) {
		const { appendFileSync } = await import('node:fs');
		appendFileSync(process.env.GITHUB_OUTPUT, `previous=${prev ?? ''}\n`);
	}
}
