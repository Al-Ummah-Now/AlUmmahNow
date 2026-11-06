'use client';

/**
 * RTL variant of PlaylistManager.
 *
 * The base component is direction-aware via useLanguage().isRTL; this
 * wrapper forces an RTL container for Arabic routes.
 */

import React from 'react';
import PlaylistManager from '../index';

export default function PlaylistManagerRTL(props: React.ComponentProps<typeof PlaylistManager>) {
  return (
    <div dir="rtl">
      <PlaylistManager {...props} />
    </div>
  );
}
