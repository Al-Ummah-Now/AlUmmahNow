import Link from 'next/link';
import { listReports } from '@/lib/api/admin';
import type { ReportStatus, ReportableEntityType } from '@al-ummah/shared-types';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<{
    status?: ReportStatus;
    entity_type?: ReportableEntityType;
    page?: string;
  }>;
}

const statusColors: Record<ReportStatus, string> = {
  pending: 'bg-yellow-500/20 text-yellow-400',
  reviewing: 'bg-blue-500/20 text-blue-400',
  resolved: 'bg-green-500/20 text-green-400',
  dismissed: 'bg-gray-500/20 text-gray-400',
};

export default async function ModerationPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const page = parseInt(params.page || '1', 10);
  const limit = 20;
  const offset = (page - 1) * limit;

  let data = null;
  let error = null;

  try {
    data = await listReports({
      status: params.status,
      entity_type: params.entity_type,
      limit,
      offset,
    });
  } catch (e) {
    error = e instanceof Error ? e.message : 'Failed to load reports';
  }

  const totalPages = data ? Math.ceil(data.total / limit) : 0;

  return (
    <div>
      <div className="flex justify-between items-center mb-8">
        <h1 className="text-3xl font-bold text-white">Moderation Queue</h1>
        <div className="flex gap-2">
          <select
            className="bg-gray-800 text-white border border-gray-700 rounded px-3 py-2"
            defaultValue={params.status || ''}
          >
            <option value="">All Status</option>
            <option value="pending">Pending</option>
            <option value="reviewing">Reviewing</option>
            <option value="resolved">Resolved</option>
            <option value="dismissed">Dismissed</option>
          </select>
          <select
            className="bg-gray-800 text-white border border-gray-700 rounded px-3 py-2"
            defaultValue={params.entity_type || ''}
          >
            <option value="">All Types</option>
            <option value="video">Video</option>
            <option value="comment">Comment</option>
            <option value="channel">Channel</option>
            <option value="playlist">Playlist</option>
          </select>
        </div>
      </div>

      {error && (
        <div className="bg-red-900/50 border border-red-500 text-red-200 px-4 py-3 rounded mb-6">
          {error}
        </div>
      )}

      {data && data.reports.length === 0 && (
        <div className="bg-gray-800 rounded-lg p-8 text-center text-gray-400">
          No reports found
        </div>
      )}

      {data && data.reports.length > 0 && (
        <>
          <div className="bg-gray-800 rounded-lg overflow-hidden">
            <table className="w-full">
              <thead className="bg-gray-700">
                <tr>
                  <th className="text-left px-6 py-3 text-gray-300 font-medium">Type</th>
                  <th className="text-left px-6 py-3 text-gray-300 font-medium">Reason</th>
                  <th className="text-left px-6 py-3 text-gray-300 font-medium">Status</th>
                  <th className="text-left px-6 py-3 text-gray-300 font-medium">Date</th>
                  <th className="text-left px-6 py-3 text-gray-300 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-700">
                {data.reports.map((report) => (
                  <tr key={report.id} className="hover:bg-gray-700/50">
                    <td className="px-6 py-4">
                      <span className="capitalize text-white">{report.entity_type}</span>
                      <span className="block text-xs text-gray-500 font-mono">
                        {report.entity_id.slice(0, 8)}...
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <span className="capitalize text-gray-300">{report.reason}</span>
                      {report.description && (
                        <span className="block text-xs text-gray-500 truncate max-w-xs">
                          {report.description}
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      <span className={`px-2 py-1 rounded text-sm ${statusColors[report.status]}`}>
                        {report.status}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-gray-400 text-sm">
                      {new Date(report.created_at).toLocaleDateString()}
                    </td>
                    <td className="px-6 py-4">
                      <Link
                        href={`/moderation/reports/${report.id}`}
                        className="text-blue-400 hover:text-blue-300"
                      >
                        View
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div className="flex justify-center gap-2 mt-6">
              {page > 1 && (
                <Link
                  href={`/moderation?page=${page - 1}`}
                  className="px-4 py-2 bg-gray-800 text-white rounded hover:bg-gray-700"
                >
                  Previous
                </Link>
              )}
              <span className="px-4 py-2 text-gray-400">
                Page {page} of {totalPages}
              </span>
              {page < totalPages && (
                <Link
                  href={`/moderation?page=${page + 1}`}
                  className="px-4 py-2 bg-gray-800 text-white rounded hover:bg-gray-700"
                >
                  Next
                </Link>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
