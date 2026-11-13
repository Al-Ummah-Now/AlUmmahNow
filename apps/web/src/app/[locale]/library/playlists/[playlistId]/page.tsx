import React from 'react';
import PlaylistEditor from '@/components/playlists/PlaylistEditor';
import PersonalPlaylistsGate from '@/components/playlists/PersonalPlaylistsGate';

interface Props {
  params: Promise<{ locale: string; playlistId: string }>;
  searchParams: Promise<{ job?: string }>;
}

/** You › Playlists › one personal playlist: details, visibility, order and its videos. */
export default async function PersonalPlaylistEditorPage({ params, searchParams }: Props) {
  const { playlistId } = await params;
  const { job } = await searchParams;
  const jobId = typeof job === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(job) ? job : undefined;
  return (
    <div className="min-h-screen">
      <div className="container mx-auto max-w-6xl px-4 py-8">
        <PersonalPlaylistsGate>
          <PlaylistEditor channelId="" playlistId={playlistId} initialJobId={jobId} />
        </PersonalPlaylistsGate>
      </div>
    </div>
  );
}
