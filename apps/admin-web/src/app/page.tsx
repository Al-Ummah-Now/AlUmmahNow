import Link from 'next/link';
import { getAdminSession } from '@/lib/auth';

export default async function HomePage() {
  const session = await getAdminSession();

  return (
    <div className="min-h-screen bg-gray-900 flex items-center justify-center">
      <div className="text-center">
        <h1 className="text-5xl font-bold text-white mb-4">Al Ummah Now</h1>
        <p className="text-xl text-gray-400 mb-8">Admin Panel</p>

        {session ? (
          <div className="space-y-4">
            <p className="text-gray-300">Welcome, {session.user.email}</p>
            <div className="flex gap-4 justify-center">
              <Link
                href="/dashboard"
                className="bg-blue-600 hover:bg-blue-700 text-white font-medium py-3 px-6 rounded transition-colors"
              >
                Go to Dashboard
              </Link>
              <form action="/api/logout" method="POST">
                <button
                  type="submit"
                  className="bg-gray-700 hover:bg-gray-600 text-white font-medium py-3 px-6 rounded transition-colors"
                >
                  Logout
                </button>
              </form>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-gray-400 mb-6">Please login to access the admin panel</p>
            <Link
              href="/login"
              className="bg-blue-600 hover:bg-blue-700 text-white font-medium py-3 px-6 rounded transition-colors inline-block"
            >
              Login
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
