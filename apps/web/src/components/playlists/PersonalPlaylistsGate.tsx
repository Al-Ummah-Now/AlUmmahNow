'use client';

/**
 * The user's personal playlists (made without a channel) under You: signed-in
 * users only (the user comes from the server session). Signed out it shows
 * the library's sign-in prompt.
 */

import React from 'react';
import { useAuth } from '@/components/AuthProvider/authContext';
import { useLanguage } from '@/hooks/useLanguage';
import { SignInPrompt } from '@/components/common/SignInPrompt';

export default function PersonalPlaylistsGate({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const { t } = useLanguage();
  if (!user) return <SignInPrompt title={t.library.playlists} message={t.library.signInPrompt} />;
  return <>{children}</>;
}
