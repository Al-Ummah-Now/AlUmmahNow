/**
 * A throwaway channel and video record (upload initiated, no file) for a report to act on, made by the
 * seeded super admin and deleted by the test that made it, as 16-videos-list does.
 */
import { expect } from '@playwright/test';
import { adminApi, readTokens } from './api';
import { RUN_ID, VIDEOS_API_URL } from './env';

const token = () => readTokens().superadmin;

async function videosApi(path: string, init: RequestInit = {}): Promise<{ status: number; result: { channel?: { id?: string }; videoId?: string } | undefined }> {
  const res = await fetch(`${VIDEOS_API_URL}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${token()}`, 'content-type': 'application/json', ...(init.headers as Record<string, string>) },
  });
  const body = (await res.json().catch(() => ({}))) as { result?: { channel?: { id?: string }; videoId?: string } };
  return { status: res.status, result: body.result };
}

export interface ReportedVideo {
  id: string;
  /** The video as the videos admin shows it */
  read(): Promise<{ isHidden?: boolean }>;
  remove(): Promise<void>;
}

export async function createReportedVideo(): Promise<ReportedVideo> {
  const tag = `${RUN_ID || 'local'}-${Date.now().toString(36)}`;
  const channel = await videosApi('/api/channels', { method: 'POST', body: JSON.stringify({ name: `E2E report ${tag}`, description: '[e2e-admin] reported video', isMain: false }) });
  const channelId = String(channel.result?.channel?.id ?? '');
  expect(channelId, `channel create -> ${channel.status}`).toBeTruthy();
  let id = '';
  const remove = async () => {
    if (id) await videosApi(`/api/videos/${encodeURIComponent(id)}`, { method: 'DELETE', headers: { channelId } }).catch(() => undefined);
    await adminApi(`/api/content/channels/${encodeURIComponent(channelId)}`, { method: 'DELETE', token: token() }).catch(() => undefined);
  };
  const video = await videosApi('/api/videos/upload/initiate', {
    method: 'POST',
    headers: { channelId },
    body: JSON.stringify({ title: `E2E report video ${tag}`, description: '[e2e-admin] reported video', isPublic: true, fileSize: 1024, mimeType: 'video/mp4' }),
  });
  id = String(video.result?.videoId ?? '');
  if (!id) await remove();
  expect(id, `upload initiate -> ${video.status}`).toBeTruthy();
  return {
    id,
    async read() {
      const { status, body } = await adminApi<{ isHidden?: boolean }>(`/api/content/videos/${encodeURIComponent(id)}`);
      expect(status, 'admin-api video detail').toBe(200);
      return body.result ?? {};
    },
    remove,
  };
}
