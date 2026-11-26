/**
 * Unified online Event Calendar & RFC 5545 (.ics) endpoints (Epic 22, E22-D7):
 *
 *   GET /api/events                         JSON upcoming & live streams/premieres/halqas
 *   GET /api/events.ics                     iCalendar feed for the filtered calendar
 *   GET /api/channels/:channelId/events.ics iCalendar feed for one public channel
 *
 * All three routes sit behind the `eventCalendar` feature switch (404 `feature_off` when off).
 */
import { z } from 'zod';
import {
	buildEventsIcsFeed,
	featureGate,
	LIVE_EVENT_TYPES,
	LIVE_STREAM_KINDS,
} from '@al-ummah/shared-types';
import { OptionalAuthRoute, type AppContext } from '../../base';
import { Str } from '../../lib/chanfana-params';
import { apiError } from '../../lib/api-error';
import { featureOff } from '../../lib/features/off';
import {
	EVENT_CALENDAR_PAGE_MAX,
	isPublicCalendarChannel,
	listCalendarEvents,
	type StoredCalendarChannel,
} from '../../lib/events/calendar';
import R2Repository from '../../lib/r2Repo';
import { ResponseError } from '../../lib/types';

const EventsQuerySchema = z.object({
	channelId: Str({ description: 'Filter to one channel' }).optional(),
	eventType: z.enum(LIVE_EVENT_TYPES).optional(),
	kind: z.enum(LIVE_STREAM_KINDS).optional(),
	subscribedOnly: z.enum(['true', 'false']).describe('Filter to up to 90 most recently subscribed channels').optional(),
	from: Str({ description: 'ISO-8601 lower bound for scheduledStartAt' }).optional(),
	to: Str({ description: 'ISO-8601 upper bound for scheduledStartAt' }).optional(),
	lang: z.enum(['en', 'ar']).optional(),
	limit: z.coerce.number().int().min(1).max(EVENT_CALENDAR_PAGE_MAX).optional().default(24),
	cursor: Str({ description: 'Pagination cursor' }).optional(),
});

const EventsIcsQuerySchema = EventsQuerySchema.omit({ limit: true, cursor: true });

function resolveIcsLocale(langParam: 'en' | 'ar' | undefined, acceptLanguage: string | undefined): 'en' | 'ar' {
	if (langParam) return langParam;

	let locale: 'en' | 'ar' = 'en';
	let bestQuality = 0;
	for (const range of (acceptLanguage ?? '').split(',')) {
		const [tag, ...params] = range.trim().toLowerCase().split(';');
		const language = tag.trim().split('-')[0];
		if (language !== 'en' && language !== 'ar') continue;

		const qualityParam = params.map((param) => param.trim()).find((param) => /^q\s*=/.test(param));
		const quality = qualityParam === undefined ? 1 : Number(qualityParam.split('=')[1]);
		if (quality > bestQuality && quality <= 1) {
			locale = language;
			bestQuality = quality;
		}
	}
	return locale;
}

function parseOptionalBoundMs(raw: string | undefined): number | undefined | 'invalid' {
	if (!raw) return undefined;
	const ms = new Date(raw).getTime();
	return Number.isFinite(ms) ? ms : 'invalid';
}

function siteOriginFor(c: AppContext): string {
	const configured = (c.env as unknown as { SITE_URL?: string; WEB_URL?: string }).SITE_URL
		?? (c.env as unknown as { WEB_URL?: string }).WEB_URL;
	if (configured && configured.trim()) return configured.trim().replace(/\/+$/, '');
	return 'https://videos.alummahnow.net';
}

export class EventsCalendarList extends OptionalAuthRoute {
	schema = {
		tags: ['Events'],
		summary: 'List upcoming and live online events',
		request: { query: EventsQuerySchema },
		responses: {
			'200': { description: 'Upcoming and live online events' },
			'400': { description: 'Invalid filter', content: { 'application/json': { schema: ResponseError } } },
		},
	};

	async handle(c: AppContext) {
		if (!(await featureGate(c.env as never, 'eventCalendar')).on) {
			return featureOff(c, 'eventCalendar');
		}
		const { query } = await this.getValidatedData<typeof this.schema>();
		const fromMs = parseOptionalBoundMs(query.from);
		const toMs = parseOptionalBoundMs(query.to);
		if (fromMs === 'invalid' || toMs === 'invalid') {
			return apiError(c, 400, 'invalid_request');
		}

		const subscribedOnly = query.subscribedOnly === 'true';
		const viewerId = c.get('auth')?.userId ?? null;
		const page = await listCalendarEvents(c.env as never, {
			channelId: query.channelId ?? null,
			eventType: query.eventType ?? null,
			kind: query.kind ?? null,
			subscribedOnly,
			...(fromMs !== undefined ? { fromMs } : {}),
			toMs: toMs ?? null,
			limit: query.limit,
			cursor: query.cursor ?? null,
			viewerId,
		});
		c.header('Cache-Control', subscribedOnly || viewerId ? 'private, no-store' : 'public, max-age=60');
		return c.json({ success: true, result: page });
	}
}

export class EventsCalendarIcs extends OptionalAuthRoute {
	schema = {
		tags: ['Events'],
		summary: 'RFC 5545 iCalendar (.ics) feed of upcoming online events',
		request: { query: EventsIcsQuerySchema },
		responses: {
			'200': { description: 'text/calendar (.ics) feed' },
			'400': { description: 'Invalid filter', content: { 'application/json': { schema: ResponseError } } },
		},
	};

	async handle(c: AppContext) {
		if (!(await featureGate(c.env as never, 'eventCalendar')).on) {
			return featureOff(c, 'eventCalendar');
		}
		const { query } = await this.getValidatedData<typeof this.schema>();
		const fromMs = parseOptionalBoundMs(query.from);
		const toMs = parseOptionalBoundMs(query.to);
		if (fromMs === 'invalid' || toMs === 'invalid') {
			return apiError(c, 400, 'invalid_request');
		}

		const locale = resolveIcsLocale(query.lang, c.req.header('Accept-Language'));
		const subscribedOnly = query.subscribedOnly === 'true';
		const viewerId = c.get('auth')?.userId ?? null;
		const page = await listCalendarEvents(c.env as never, {
			channelId: query.channelId ?? null,
			eventType: query.eventType ?? null,
			kind: query.kind ?? null,
			subscribedOnly,
			...(fromMs !== undefined ? { fromMs } : {}),
			toMs: toMs ?? null,
			limit: EVENT_CALENDAR_PAGE_MAX,
			viewerId,
		});
		const ics = buildEventsIcsFeed(page.items, {
			locale,
			calendarName: locale === 'ar' ? 'الأمة الآن — الفعاليات القادمة' : 'Al Ummah Now — Upcoming Events',
			siteOrigin: siteOriginFor(c),
		});
		return new Response(ics, {
			status: 200,
			headers: {
				'Content-Type': 'text/calendar; charset=utf-8',
				'Content-Disposition': 'inline; filename="al-ummah-now-events.ics"',
				'Cache-Control': subscribedOnly || viewerId ? 'private, no-store' : 'public, max-age=300',
				Vary: 'Accept-Language',
			},
		});
	}
}

export class ChannelEventsCalendarIcs extends OptionalAuthRoute {
	schema = {
		tags: ['Channels', 'Events'],
		summary: 'RFC 5545 iCalendar (.ics) feed of upcoming online events for one channel',
		request: {
			params: z.object({ channelId: Str({ description: 'Channel ID' }) }),
			query: z.object({ lang: z.enum(['en', 'ar']).optional() }),
		},
		responses: {
			'200': { description: 'text/calendar (.ics) feed' },
			'404': { description: 'Channel not found', content: { 'application/json': { schema: ResponseError } } },
		},
	};

	async handle(c: AppContext) {
		if (!(await featureGate(c.env as never, 'eventCalendar')).on) {
			return featureOff(c, 'eventCalendar');
		}
		const { params, query } = await this.getValidatedData<typeof this.schema>();
		const channel = await new R2Repository<StoredCalendarChannel>(c.env.channels).getObject(params.channelId);
		if (!isPublicCalendarChannel(channel)) {
			return apiError(c, 404, 'not_found');
		}

		const locale = resolveIcsLocale(query.lang, c.req.header('Accept-Language'));
		const page = await listCalendarEvents(c.env as never, {
			channelId: params.channelId,
			limit: EVENT_CALENDAR_PAGE_MAX,
			viewerId: null,
		});
		const safeId = params.channelId.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 48) || 'channel';
		const channelArName = channel.nameLocalized?.ar || channel.name;
		const calendarName = locale === 'ar'
			? (channelArName ? `${channelArName} — الفعاليات القادمة` : 'الفعاليات القادمة للقناة')
			: (channel.name ? `${channel.name} — Upcoming Events` : 'Channel Upcoming Events');
		const ics = buildEventsIcsFeed(page.items, {
			locale,
			calendarName,
			siteOrigin: siteOriginFor(c),
		});
		return new Response(ics, {
			status: 200,
			headers: {
				'Content-Type': 'text/calendar; charset=utf-8',
				'Content-Disposition': `inline; filename="${safeId}-events.ics"`,
				'Cache-Control': 'public, max-age=300',
				Vary: 'Accept-Language',
			},
		});
	}
}
