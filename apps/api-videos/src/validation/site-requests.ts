import {
	SITE_BLOCKS_MAX, SITE_DOMAIN_STATUSES, SITE_LOCALES, SITE_NAV_KINDS, SITE_REDIRECTS_MAX,
} from '@al-ummah/shared-types';
import { z } from 'zod';

// The site services apply the plan-specific limits and semantic checks after structural validation.
const locales = (text: z.ZodString) => z.object({ en: text.optional(), ar: text.optional() });
const nullableText = (max: number) => z.string().max(max).nullish();
const url = z.string().max(1000);
const id = z.string().regex(/^[a-z0-9-]{1,40}$/);
const localDestination = z.string().max(1000).refine((value) => !value.startsWith('//'));

export const SiteSettingsBody = z.object({
	themeRef: z.string().max(120).optional(),
	name: locales(z.string().max(512)).optional(),
	logoUrl: url.nullable().optional(),
	faviconUrl: url.nullable().optional(),
	locales: z.array(z.enum(SITE_LOCALES)).max(2).optional(),
	navigation: z.array(z.object({
		id,
		kind: z.enum(SITE_NAV_KINDS),
		label: locales(z.string().max(120)).optional(),
		url: url.optional(),
		pageId: z.string().max(27).optional(),
	})).max(30).optional(),
	about: locales(z.string().max(8100)).optional(),
	home: z.object({ pageId: z.string().max(27).nullable() }).transform(({ pageId }) => ({ pageId: pageId ?? null })).optional(),
	seo: z.object({
		titleTemplate: nullableText(120),
		description: locales(z.string().max(300)).optional(),
		googleVerification: nullableText(100),
		bingVerification: nullableText(100),
	}).optional(),
	redirects: z.array(z.object({ from: localDestination, to: localDestination })).max(SITE_REDIRECTS_MAX).optional(),
});

const block = z.discriminatedUnion('type', [
	z.object({ id, type: z.literal('markdown'), text: z.string().max(20_000) }),
	z.object({ id, type: z.literal('image'), url, alt: z.string().max(300), caption: nullableText(300) }),
	z.object({ id, type: z.literal('video'), videoId: z.string().max(64) }),
	z.object({ id, type: z.literal('cta'), label: z.string().max(80), href: localDestination }),
	z.object({ id, type: z.literal('quote'), text: z.string().max(2000), cite: nullableText(200) }),
	z.object({ id, type: z.literal('divider') }),
	z.object({ id, type: z.literal('posts'), count: z.number().int().min(1).max(12) }),
	z.object({ id, type: z.literal('videos'), count: z.number().int().min(1).max(24), playlistId: nullableText(64) }),
]);
const localizedBlocks = z.array(block).max(SITE_BLOCKS_MAX).optional();
export const SitePageBody = z.object({
	slug: z.string().max(120).optional(),
	title: locales(z.string().max(240)).optional(),
	description: locales(z.string().max(600)).optional(),
	blocks: z.object({ en: localizedBlocks, ar: localizedBlocks }).optional(),
	status: z.enum(['draft', 'published']).optional(),
});

export const DomainBody = z.object({ host: z.string().max(253) });
export const DomainUpdateBody = z.object({
	cfId: nullableText(64),
	status: z.enum(SITE_DOMAIN_STATUSES).optional(),
	records: z.array(z.object({
		type: z.enum(['CNAME', 'TXT']),
		purpose: z.enum(['traffic', 'ownership', 'certificate']),
		name: z.string().min(1).max(253),
		value: z.string().min(1).max(512),
	})).max(8).optional(),
	error: nullableText(300),
	checkedAt: z.iso.datetime({ offset: true }).nullish(),
});
