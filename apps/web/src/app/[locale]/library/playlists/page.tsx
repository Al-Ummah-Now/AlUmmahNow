'use client';

import React from 'react';
import PlaylistManager from '@/components/PlaylistManager';
import PersonalPlaylistsGate from '@/components/playlists/PersonalPlaylistsGate';

/** You › Playlists: the user's personal playlists (made without a channel), to create, edit and delete. */
export default function PersonalPlaylistsPage() {
  return (
    <div className="min-h-screen">
      <div className="container mx-auto max-w-5xl px-4 py-8">
        <PersonalPlaylistsGate>
          <PlaylistManager channelId="" />
        </PersonalPlaylistsGate>
      </div>
    </div>
  );
}
