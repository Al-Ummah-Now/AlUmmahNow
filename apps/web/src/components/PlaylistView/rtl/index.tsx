'use client';

/**
 * RTL variant of PlaylistView.
 *
 * The base component is direction-aware (it mirrors spacing, badges and the
 * play icon from useLanguage().isRTL); this wrapper forces an RTL container
 * for Arabic routes.
 */

import React from 'react';
import PlaylistView from '../index';

export default function PlaylistViewRTL(props: React.ComponentProps<typeof PlaylistView>) {
  return (
    <div dir="rtl">
      <PlaylistView {...props} />
    </div>
  );
}
