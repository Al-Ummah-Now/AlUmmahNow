import { notFound } from 'next/navigation';
import Link from 'next/link';
import { getReport } from '@/lib/api/admin';
import { ReportActions } from './actions';
import type { ReportStatus } from '@al-ummah/shared-types';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ id: string }>;
}

const statusColors: Record<ReportStatus, string> = {
  pending: 'bg-yellow-500/20 text-yellow-400',
  reviewing: 'bg-blue-500/20 text-blue-400',
  resolved: 'bg-green-500/20 text-green-400',
  dismissed: 'bg-gray-500/20 text-gray-400',
};

export default async function ReportDetailPage({ params }: PageProps) {
  const { id } = await params;

  let report = null;
  let error = null;

  try {
    const data = await getReport(id);
    report = data.report;
  } catch (e) {
    if (e instanceof Error && e.message.includes('not found')) {
      notFound();
    }
    error = e instanceof Error ? e.message : 'Failed to load report';
  }

  if (!report && !error) {
    notFound();
  }

  return (
    <div>
      <div className="mb-6">
        <Link href="/moderation" className="text-blue-400 hover:text-blue-300">
          &larr; Back to Queue
        </Link>
      </div>

      {error && (
        <div className="bg-red-900/50 border border-red-500 text-red-200 px-4 py-3 rounded mb-6">
          {error}
        </div>
      )}

      {report && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2">
            <div className="bg-gray-800 rounded-lg p-6">
              <div className="flex justify-between items-start mb-6">
                <h1 className="text-2xl font-bold text-white">Report Details</h1>
                <span className={`px-3 py-1 rounded ${statusColors[report.status]}`}>
                  {report.status}
                </span>
              </div>

              <dl className="grid grid-cols-2 gap-4">
                <div>
                  <dt className="text-gray-400 text-sm">Report ID</dt>
                  <dd className="text-white font-mono text-sm">{report.id}</dd>
                </div>
                <div>
                  <dt className="text-gray-400 text-sm">Entity Type</dt>
                  <dd className="text-white capitalize">{report.entity_type}</dd>
                </div>
                <div>
                  <dt className="text-gray-400 text-sm">Entity ID</dt>
                  <dd className="text-white font-mono text-sm">{report.entity_id}</dd>
                </div>
                <div>
                  <dt className="text-gray-400 text-sm">Reason</dt>
                  <dd className="text-white capitalize">{report.reason}</dd>
                </div>
                <div>
                  <dt className="text-gray-400 text-sm">Reporter ID</dt>
                  <dd className="text-white font-mono text-sm">{report.reporter_id || 'Anonymous'}</dd>
                </div>
                <div>
                  <dt className="text-gray-400 text-sm">Created</dt>
                  <dd className="text-white">{new Date(report.created_at).toLocaleString()}</dd>
                </div>
              </dl>

              {report.description && (
                <div className="mt-6 pt-6 border-t border-gray-700">
                  <h3 className="text-gray-400 text-sm mb-2">Description</h3>
                  <p className="text-white whitespace-pre-wrap">{report.description}</p>
                </div>
              )}

              {report.moderator_notes && (
                <div className="mt-6 pt-6 border-t border-gray-700">
                  <h3 className="text-gray-400 text-sm mb-2">Moderator Notes</h3>
                  <p className="text-white whitespace-pre-wrap">{report.moderator_notes}</p>
                </div>
              )}

              {report.action && (
                <div className="mt-6 pt-6 border-t border-gray-700">
                  <h3 className="text-gray-400 text-sm mb-2">Action Taken</h3>
                  <p className="text-white capitalize">{report.action}</p>
                  {report.resolved_at && (
                    <p className="text-gray-500 text-sm mt-1">
                      Resolved on {new Date(report.resolved_at).toLocaleString()}
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="lg:col-span-1">
            {report.status === 'pending' || report.status === 'reviewing' ? (
              <ReportActions reportId={report.id} />
            ) : (
              <div className="bg-gray-800 rounded-lg p-6">
                <h2 className="text-lg font-semibold text-white mb-4">Report Closed</h2>
                <p className="text-gray-400">
                  This report has been {report.status}. No further action is required.
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
