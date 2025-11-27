'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

interface AdminNavProps {
  userEmail?: string;
}

export function AdminNav({ userEmail }: AdminNavProps) {
  const pathname = usePathname();

  const isActive = (path: string) => {
    if (path === '/') return pathname === '/';
    return pathname.startsWith(path);
  };

  return (
    <nav className="bg-gray-800 border-b border-gray-700">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex h-16 items-center justify-between">
          <div className="flex items-center">
            <Link href="/dashboard" className="flex items-center">
              <span className="text-xl font-bold text-white">Al Ummah Now</span>
              <span className="ml-2 text-sm text-gray-400">Admin</span>
            </Link>
          </div>
          <div className="flex items-center gap-4">
            <Link
              href="/dashboard"
              className={`px-3 py-2 rounded ${
                isActive('/dashboard')
                  ? 'bg-gray-700 text-white'
                  : 'text-gray-300 hover:text-white'
              }`}
            >
              Dashboard
            </Link>
            <Link
              href="/moderation"
              className={`px-3 py-2 rounded ${
                isActive('/moderation')
                  ? 'bg-gray-700 text-white'
                  : 'text-gray-300 hover:text-white'
              }`}
            >
              Moderation
            </Link>
            <Link
              href="/translations"
              className={`px-3 py-2 rounded ${
                isActive('/translations')
                  ? 'bg-gray-700 text-white'
                  : 'text-gray-300 hover:text-white'
              }`}
            >
              Translations
            </Link>
            {userEmail && (
              <div className="flex items-center gap-3 ml-4 pl-4 border-l border-gray-700">
                <span className="text-gray-400 text-sm">{userEmail}</span>
                <form action="/api/logout" method="POST">
                  <button
                    type="submit"
                    className="text-gray-400 hover:text-white text-sm"
                  >
                    Logout
                  </button>
                </form>
              </div>
            )}
          </div>
        </div>
      </div>
    </nav>
  );
}
