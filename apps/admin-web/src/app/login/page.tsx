import { redirect } from 'next/navigation';
import { headers as getHeaders } from 'next/headers';
import { isAuthenticated, getAuthClient } from '@/lib/auth';

interface PageProps {
  searchParams: Promise<{ error?: string }>;
}

const errorMessages: Record<string, string> = {
  no_code: 'Authorization code not received',
  exchange_failed: 'Failed to exchange authorization code',
  verification_failed: 'Failed to verify credentials',
  auth_failed: 'Authentication failed',
  unauthorized: 'You do not have permission to access the admin panel',
};

export default async function LoginPage({ searchParams }: PageProps) {
  const params = await searchParams;

  // If already authenticated, redirect to home
  if (await isAuthenticated()) {
    redirect('/');
  }

  // If there's an error, show it
  if (params.error) {
    const errorMessage = errorMessages[params.error] || 'An error occurred';

    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <div className="bg-gray-800 rounded-lg p-8 max-w-md w-full mx-4">
          <div className="text-center mb-8">
            <h1 className="text-2xl font-bold text-white">Al Ummah Now</h1>
            <p className="text-gray-400 mt-2">Admin Panel</p>
          </div>

          <div className="bg-red-900/50 border border-red-500 text-red-200 px-4 py-3 rounded mb-6 text-sm">
            {errorMessage}
          </div>

          <a
            href="/login"
            className="block w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-3 px-4 rounded transition-colors text-center"
          >
            Try Again
          </a>

          <p className="text-gray-500 text-sm text-center mt-6">
            Only administrators and moderators can access this panel.
          </p>
        </div>
      </div>
    );
  }

  // No error - redirect to auth server
  const headersData = await getHeaders();
  const host = headersData.get('host');
  const protocol = host?.includes('localhost') ? 'http' : 'https';

  const client = await getAuthClient();
  const { url } = await client.authorize(
    `${protocol}://${host}/api/callback`,
    'code',
  );

  redirect(url);
}
