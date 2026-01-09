import Link from 'next/link';
import { getAdminSession, logout } from '@/lib/auth';

export default async function AccessDeniedPage() {
  const session = await getAdminSession();

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-8 text-center">
        <div>
          <div className="mx-auto h-12 w-12 flex items-center justify-center rounded-full bg-red-100">
            <svg
              className="h-6 w-6 text-red-600"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>
          </div>
          <h2 className="mt-6 text-3xl font-extrabold text-gray-900">
            Access Denied
          </h2>
          <p className="mt-2 text-sm text-gray-600">
            You do not have permission to access the admin dashboard.
          </p>
          <p className="mt-2 text-sm text-gray-600">
            Admin or moderator role is required.
          </p>
        </div>

        {session && (
          <div className="mt-4 p-4 bg-gray-100 rounded-md">
            <p className="text-sm text-gray-700">
              Logged in as: <strong>{session.user.email}</strong>
            </p>
            {session.user.role && (
              <p className="text-sm text-gray-700 mt-1">
                Current role: <strong>{session.user.role}</strong>
              </p>
            )}
          </div>
        )}

        <div className="mt-6 space-y-3">
          <p className="text-sm text-gray-600">
            If you believe this is an error, please contact your system administrator.
          </p>

          <div className="flex flex-col gap-3">
            <form action={logout}>
              <button
                type="submit"
                className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
              >
                Log Out
              </button>
            </form>

            <Link
              href={process.env.NEXT_PUBLIC_MAIN_SITE_URL || 'https://alummahnow.net'}
              className="inline-flex justify-center py-2 px-4 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
            >
              Go to Main Site
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
