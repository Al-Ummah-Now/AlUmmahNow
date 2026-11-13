'use client';

import React from 'react';
import NewPlaylistPage from '@/components/playlists/NewPlaylistPage';
import PersonalPlaylistsGate from '@/components/playlists/PersonalPlaylistsGate';

/** You › Playlists › New playlist: a personal playlist, no channel needed. */
export default function NewPersonalPlaylistPage() {
  return (
    <div className="min-h-screen">
      <div className="container mx-auto max-w-5xl px-4 py-8">
        <PersonalPlaylistsGate>
          <NewPlaylistPage channelId="" />
        </PersonalPlaylistsGate>
      </div>
    </div>
  );
}
