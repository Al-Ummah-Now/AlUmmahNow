'use client';

/**
 * RTL variant of SaveToPlaylist.
 *
 * The base component mirrors its popover anchor from useLanguage().isRTL;
 * this wrapper forces an RTL container for Arabic routes.
 */

import React from 'react';
import SaveToPlaylist from '../index';

export default function SaveToPlaylistRTL(props: React.ComponentProps<typeof SaveToPlaylist>) {
  return (
    <div dir="rtl" className="inline-block">
      <SaveToPlaylist {...props} />
    </div>
  );
}
