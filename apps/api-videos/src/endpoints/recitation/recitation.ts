import { z } from 'zod';
import {
  captionAcceptedRecitationSpans,
  QURAN_CREDIT,
  QURAN_FOUNDATION_URL,
  type CaptionRecitationSpan,
  type VideoObject,
  type VideoRecitationMetadata,
  type VideoReciter,
} from '@al-ummah/shared-types';
import { AuthenticatedRoute, OptionalAuthRoute, type AppContext } from '../../base';
import { addAuthToSchema } from '../../lib/openapi-auth';
import { Str } from '../../lib/chanfana-params';
import { loadVideoRecord, videoReadAccess, VIDEO_NOT_FOUND } from '../../lib/videoReadAccess';
import { readTracks } from '../../lib/captions/drafts';
import { featureOff, quranTextAvailable } from '../../lib/features';
import { editableVideo } from '../captions/captionDrafts';
import { resolveCreator } from '../../lib/creatorTiers';
import R2Repository from '../../lib/r2Repo';
import { patchVideo } from '../../lib/videoWrites';

const Reciter = z.object({
  name: z.string(),
  nameLocalized: z.object({ en: z.string().optional(), ar: z.string().optional() }).optional(),
  riwayah: z.string().optional(),
});
const StoredRecitation = z.object({ reciter: Reciter.nullable(), updatedAt: z.string(), updatedBy: z.string() });
const Span = z.object({
  range: z.string(),
  startMs: z.number(),
  endMs: z.number(),
  boundary: z.literal('cue'),
});
const Err = { 'application/json': { schema: z.object({ success: z.literal(false), error: z.string() }) } };
const params = z.object({ videoId: Str({ description: 'Video ID' }) });
const TRACK_READ_MAX = 20;

function publicReciter(video: VideoObject): VideoReciter | null {
  const reciter = video.recitation?.reciter;
  if (!reciter) return null;
  return {
    name: reciter.name,
    ...(reciter.nameLocalized ? { nameLocalized: reciter.nameLocalized } : {}),
    ...(reciter.riwayah ? { riwayah: reciter.riwayah } : {}),
  };
}

function dedupe(spans: CaptionRecitationSpan[]): CaptionRecitationSpan[] {
  const byKey = new Map<string, CaptionRecitationSpan>();
  for (const span of spans) byKey.set(`${span.range}:${span.startMs}:${span.endMs}`, span);
  return [...byKey.values()].sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs || a.range.localeCompare(b.range));
}

export class VideoRecitationGet extends OptionalAuthRoute {
  schema = {
    tags: ['Recitation'],
    summary: "A video's confirmed recitation references and reciter metadata",
    description:
      'References and published cue timings only. No Quran or ASR text is returned. Official Uthmani text and recognized translations use the existing Quran Foundation passage and edition APIs. Hidden videos use the video read rule; a fresh Quran copy is required.',
    request: { params },
    responses: {
      '200': {
        description: 'Recitation references and attribution',
        content: {
          'application/json': {
            schema: z.object({
              success: z.literal(true),
              data: z.object({
                videoId: z.string(),
                reciter: Reciter.nullable(),
                items: z.array(Span),
                credit: z.object({ en: z.string(), ar: z.string(), url: z.string() }),
                creditsPath: z.string(),
              }),
            }),
          },
        },
      },
      '404': { description: 'Video not found, hidden, or recitation is off', content: Err },
    },
  };

  async handle(c: AppContext) {
    if (!(await quranTextAvailable(c.env as never))) return featureOff(c, 'recitationTools');
    const { params: path } = await this.getValidatedData<typeof this.schema>();
    const video = await loadVideoRecord<VideoObject>(c.env as never, path.videoId);
    const access = await videoReadAccess(c.env, video as never, this.getUserId(c));
    if (!access) return c.json(VIDEO_NOT_FOUND, 404);
    const tracks = (await readTracks(c.env.subtitles, path.videoId))
      .filter((track) => (track.origin === 'machine' || track.origin === 'machine_edited') && track.status === 'ready')
      .sort((a, b) => a.language.localeCompare(b.language))
      .slice(0, TRACK_READ_MAX);
    const files = await Promise.all(tracks.map((track) => c.env.subtitles.get(`${path.videoId}/${track.language}.vtt`).catch(() => null)));
    const texts = await Promise.all(files.map((file) => (file ? file.text().catch(() => '') : Promise.resolve(''))));
    const spans = dedupe(texts.flatMap((vtt) => captionAcceptedRecitationSpans(vtt)));
    c.header('Cache-Control', access === 'anyone' ? 'public, max-age=60' : 'private, no-store');
    return c.json({
      success: true as const,
      data: {
        videoId: path.videoId,
        reciter: publicReciter(video!),
        items: spans,
        credit: { ...QURAN_CREDIT, url: QURAN_FOUNDATION_URL },
        creditsPath: '/credits',
      },
    });
  }
}

const ReciterInput = z.object({
  nameLocalized: z.object({ en: z.string().max(200).optional(), ar: z.string().max(200).optional() }).optional(),
  riwayah: z.string().max(80).optional(),
});
const MetadataInput = z.object({ reciter: ReciterInput.nullable() });

function clean(value: string | undefined, max: number): string | undefined {
  const text = value?.replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim();
  return text ? text.slice(0, max) : undefined;
}

function reciterInput(input: z.infer<typeof ReciterInput> | null): VideoReciter | null | 'invalid' {
  if (input === null) return null;
  const en = clean(input.nameLocalized?.en, 200);
  const ar = clean(input.nameLocalized?.ar, 200);
  if (!en && !ar) return 'invalid';
  const riwayah = clean(input.riwayah, 80);
  return {
    name: en ?? ar!,
    nameLocalized: { ...(en ? { en } : {}), ...(ar ? { ar } : {}) },
    ...(riwayah ? { riwayah } : {}),
  };
}

export class VideoRecitationMetadataPut extends AuthenticatedRoute {
  schema = addAuthToSchema(
    {
      tags: ['Recitation'],
      summary: "Set a video's human-supplied reciter metadata",
      description: 'Owner or video.edit, under the channel owner’s admin-managed tier. No Quran text or ASR inference is accepted.',
      request: { params, body: { content: { 'application/json': { schema: MetadataInput } } } },
      responses: {
        '200': { description: 'Saved', content: { 'application/json': { schema: z.object({ success: z.literal(true), data: z.object({ recitation: StoredRecitation }) }) } } },
        '400': { description: 'A reciter needs an English or Arabic name', content: Err },
        '403': { description: 'Not allowed', content: Err },
        '404': { description: 'Video not found or the feature is off for this tier', content: Err },
      },
    },
    'required',
  );

  async handle(c: AppContext) {
    const { params: path, body } = await this.getValidatedData<typeof this.schema>();
    const userId = this.getUserId(c);
    const access = await editableVideo(c, path.videoId, userId);
    if ('response' in access) return access.response;
    const reciter = reciterInput(body.reciter);
    if (reciter === 'invalid') return c.json({ success: false, error: 'invalid_reciter' }, 400);
    if (!c.env.SEARCH_DB) return featureOff(c, 'recitationTools');
    const roles = (this.getAuth(c) as { payload?: { roles?: string[] } }).payload?.roles ?? null;
    const creator = await resolveCreator(c.env.SEARCH_DB, { userId, roles, channelOwnerId: access.video.userId });
    if (!(creator.via === 'super_admin' || creator.tier?.unlimited || creator.tier?.recitationMetadata === true)) return featureOff(c, 'recitationTools');
    const now = new Date().toISOString();
    const recitation: VideoRecitationMetadata = { reciter, updatedAt: now, updatedBy: userId };
    const saved = await patchVideo(
      new R2Repository<VideoObject>(c.env.videos),
      path.videoId,
      { recitation, dateModified: now },
      { ownerId: access.video.userId },
    );
    if (saved.status === 'missing') return c.json({ success: false, error: 'video_not_found' }, 404);
    if (saved.status === 'forbidden') return c.json({ success: false, error: 'forbidden' }, 403);
    return c.json({ success: true as const, data: { recitation: (saved.video as VideoObject).recitation } });
  }
}
