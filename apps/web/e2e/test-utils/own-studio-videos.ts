import type { TestType } from '@playwright/test';
import type { AuthUser } from './auth-state';
import { SEED_TITLES, deleteVideoQuietly, uploadVideo, userApi, type E2EVideo, type UserApi } from './e2e-videos';

/**
 * The run user's Studio videos, made by the spec file that uses them (owner rule 2026-11-12:
 * specs seed their own data). It replaces the old shared per-user "seed videos": the same set
 * (single: a video, a private video and one scheduled 10 days ahead; multi: one per channel), all
 * private, but created in this file's beforeAll with a unique suffix and deleted in its afterAll,
 * so parallel files and runs never share or edit each other's rows.
 *
 * Keyed by the old base title (SEED_TITLES), so `videos()[SEED_TITLES.singleVideo]` still works;
 * compare against `.title` (the real, suffixed title), never the constant.
 */
interface StudioSpec {
  base: string;
  titleAr: string;
  channelIndex: number;
  scheduleInDays?: number;
}

const SPECS: Partial<Record<AuthUser, StudioSpec[]>> = {
  single: [
    { base: SEED_TITLES.singleVideo, titleAr: 'فيديو اختبار', channelIndex: 0 },
    { base: SEED_TITLES.singlePrivate, titleAr: 'فيديو اختبار خاص', channelIndex: 0 },
    { base: SEED_TITLES.singleScheduled, titleAr: 'فيديو اختبار مجدول', channelIndex: 0, scheduleInDays: 10 },
  ],
  multi: [
    { base: SEED_TITLES.multiOne, titleAr: 'فيديو القناة الأولى', channelIndex: 0 },
    { base: SEED_TITLES.multiTwo, titleAr: 'فيديو القناة الثانية', channelIndex: 1 },
  ],
};

async function schedule(u: UserApi, video: E2EVideo, days: number): Promise<void> {
  const when = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  when.setUTCHours(12, 0, 0, 0);
  await u.api.post(
    `/api/videos/${video.id}/schedule`,
    { scheduledPublishDate: when.toISOString(), timezone: 'UTC', notifyOnPublish: false },
    { token: u.token, channelId: video.channelId },
  );
}

// The legacy suite extends the base test with its own fixtures; only beforeAll/afterAll are used
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyTest = TestType<any, any>;

export function ownStudioVideos(test: AnyTest, user: AuthUser): { videos: () => Record<string, E2EVideo> } {
  const made: Record<string, E2EVideo> = {};
  const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;

  test.beforeAll(async () => {
    test.setTimeout(180_000);
    const u = userApi(user);
    for (const spec of SPECS[user] ?? []) {
      const title = `${spec.base} ${suffix}`;
      // Bytes too: the stack's fake Bunny encodes them (thumbnails, durations), like the old seed
      let video = await uploadVideo(u, { title, titleAr: `${spec.titleAr} ${suffix}`, isPublic: false, channelIndex: spec.channelIndex });
      if (spec.scheduleInDays) {
        await schedule(u, video, spec.scheduleInDays);
        const res = await u.api.get<E2EVideo>(`/api/videos/${video.id}`, { token: u.token });
        video = { ...video, ...res.data };
      }
      made[spec.base] = video;
    }
  });

  test.afterAll(async () => {
    for (const video of Object.values(made)) await deleteVideoQuietly(user, video);
  });

  return {
    videos: () => {
      if (Object.keys(made).length === 0) throw new Error(`the ${user} user's own Studio videos were not created`);
      return made;
    },
  };
}
