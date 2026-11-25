'use client';
/** The embed frame's player over the local "bright" fixture (e2e/player/embed-start.spec.ts). */
import EmbedPlayer from '@/components/embed/EmbedPlayer';
import { parseEmbedParams } from '@/lib/embed/params';

const VIDEOS = [{ id: 'harness-bright', title: 'Harness bright', playUrl: '/__player-fixtures/bright/master.m3u8', duration: 90 }];

export function EmbedHarness({ query }: { query: Record<string, string | string[] | undefined> }) {
  return <EmbedPlayer videos={VIDEOS} params={parseEmbedParams(query)} />;
}
