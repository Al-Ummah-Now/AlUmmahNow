import AuthErrorPage from '@/components/AuthErrorPage';

/**
 * Landing page for a sign-in that came back from the auth server with an
 * error (or without a code). /api/callback redirects here instead of
 * answering with raw JSON.
 */
export default function AuthError() {
  return <AuthErrorPage />;
}
