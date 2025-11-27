import Link from 'next/link';
import { getStats } from '@/lib/api/admin';

export const dynamic = 'force-dynamic';

export default async function AdminDashboard() {
  let stats = null;
  let error = null;

  try {
    stats = await getStats();
  } catch (e) {
    error = e instanceof Error ? e.message : 'Failed to load stats';
  }

  return (
    <div>
      <h1 className="text-3xl font-bold text-white mb-8">Admin Dashboard</h1>

      {error && (
        <div className="bg-red-900/50 border border-red-500 text-red-200 px-4 py-3 rounded mb-6">
          {error}
        </div>
      )}

      {stats && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          <div className="bg-gray-800 rounded-lg p-6">
            <h3 className="text-gray-400 text-sm font-medium">Total Reports</h3>
            <p className="text-3xl font-bold text-white mt-2">{stats.total}</p>
          </div>
          <div className="bg-gray-800 rounded-lg p-6">
            <h3 className="text-gray-400 text-sm font-medium">Pending</h3>
            <p className="text-3xl font-bold text-yellow-500 mt-2">{stats.byStatus.pending}</p>
          </div>
          <div className="bg-gray-800 rounded-lg p-6">
            <h3 className="text-gray-400 text-sm font-medium">Resolved</h3>
            <p className="text-3xl font-bold text-green-500 mt-2">{stats.byStatus.resolved}</p>
          </div>
          <div className="bg-gray-800 rounded-lg p-6">
            <h3 className="text-gray-400 text-sm font-medium">Last 24 Hours</h3>
            <p className="text-3xl font-bold text-blue-500 mt-2">{stats.recentActivity.last24Hours}</p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Link
          href="/moderation"
          className="bg-gray-800 rounded-lg p-6 hover:bg-gray-700 transition-colors"
        >
          <h2 className="text-xl font-semibold text-white mb-2">Moderation Queue</h2>
          <p className="text-gray-400">Review and take action on reported content</p>
          {stats && stats.byStatus.pending > 0 && (
            <span className="inline-block mt-4 bg-yellow-500 text-black px-3 py-1 rounded-full text-sm font-medium">
              {stats.byStatus.pending} pending
            </span>
          )}
        </Link>
        <Link
          href="/translations"
          className="bg-gray-800 rounded-lg p-6 hover:bg-gray-700 transition-colors"
        >
          <h2 className="text-xl font-semibold text-white mb-2">Translation Management</h2>
          <p className="text-gray-400">Edit translations for English and Arabic languages</p>
          <span className="inline-block mt-4 bg-blue-500 text-white px-3 py-1 rounded-full text-sm font-medium">
            EN / AR
          </span>
        </Link>
      </div>
    </div>
  );
}
