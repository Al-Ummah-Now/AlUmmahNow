"use client";
import React, { useEffect, useState, useCallback } from "react";
import { useAuth } from "@/components/AuthProvider/authContext";
import * as ModerationAPI from "@/lib/api/moderation";
import type { ContentReport, ModerationActionRequest } from "@/lib/api/moderation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useParams } from "next/navigation";
import Link from "next/link";
import { createApiHeaders } from "@/lib/utility";
import { useLanguage } from "@/hooks/useLanguage";

const ReportDetailPage: React.FC = () => {
  const { t } = useLanguage();
  const [report, setReport] = useState<ContentReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [showActionForm, setShowActionForm] = useState(false);
  const [actionForm, setActionForm] = useState<{
    actionType: string;
    reason: string;
    notes: string;
  }>({
    actionType: '',
    reason: '',
    notes: '',
  });

  const params = useParams();
  const auth = useAuth();
  const locale = params.locale as string;
  const reportId = params.id as string;

  // Check if user has moderation privileges
  const isAuthorized = auth?.user && (auth.user.role === 'admin' || auth.user.role === 'moderator');

  const loadReport = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const headers = createApiHeaders(auth?.user);
      const reportData = await ModerationAPI.getReportById(reportId, headers);

      setReport(reportData);
    } catch (err) {
      setError(err instanceof Error ? err.message : t.errors.genericError);
    } finally {
      setLoading(false);
    }
  }, [auth, reportId, t.errors.genericError]); // t.errors.genericError is stable (memoized by useI18n)

  useEffect(() => {
    if (!isAuthorized) {
      setError(t.errors.unauthorized);
      setLoading(false);
      return;
    }

    loadReport();
  }, [isAuthorized, loadReport, t.errors.unauthorized]); // t.errors.unauthorized is stable (memoized by useI18n)

  const handleModerationAction = async () => {
    if (!report || !actionForm.actionType) return;

    try {
      setActionLoading(true);
      setError(null);

      const headers = createApiHeaders(auth?.user, report.contentType === 'channel' ? report.contentId : undefined);

      const actionData: ModerationActionRequest = {
        reportId: report.id,
        contentType: report.contentType,
        contentId: report.contentId,
        actionType: actionForm.actionType,
        reason: actionForm.reason,
        notes: actionForm.notes,
      };

      await ModerationAPI.takeModerationAction(actionData, headers);

      // Reload report to get updated status
      await loadReport();
      setShowActionForm(false);
      setActionForm({ actionType: '', reason: '', notes: '' });

    } catch (err) {
      setError(err instanceof Error ? err.message : t.errors.genericError);
    } finally {
      setActionLoading(false);
    }
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'urgent': return 'bg-red-500';
      case 'high': return 'bg-orange-500';
      case 'medium': return 'bg-yellow-500';
      case 'low': return 'bg-green-500';
      default: return 'bg-gray-500';
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'pending': return 'bg-yellow-500';
      case 'in_review': return 'bg-blue-500';
      case 'resolved': return 'bg-green-500';
      case 'dismissed': return 'bg-gray-500';
      case 'escalated': return 'bg-red-500';
      default: return 'bg-gray-500';
    }
  };

  if (!isAuthorized) {
    return (
      <div className="container mx-auto px-4 py-8">
        <Alert className="border-red-200 bg-red-50">
          <AlertDescription className="text-red-800">
            {t.errors.unauthorized}
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="flex justify-center items-center min-h-64">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500"></div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="container mx-auto px-4 py-8">
        <Alert className="border-red-200 bg-red-50">
          <AlertDescription className="text-red-800">{error}</AlertDescription>
        </Alert>
        <div className="flex gap-4 mt-4">
          <Button onClick={loadReport}>{t.common.retry}</Button>
          <Link href={`/${locale}/moderation`}>
            <Button variant="outline">{t.common.back}</Button>
          </Link>
        </div>
      </div>
    );
  }

  if (!report) {
    return (
      <div className="container mx-auto px-4 py-8">
        <Alert>
          <AlertDescription>{t.errors.notFound}</AlertDescription>
        </Alert>
        <Link href={`/${locale}/moderation`} className="mt-4 inline-block">
          <Button variant="outline">{t.common.back}</Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-4 mb-4">
          <Link href={`/${locale}/moderation`}>
            <Button variant="outline" size="sm">
              ← {t.common.back}
            </Button>
          </Link>
        </div>
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white">{t.moderation.reportDetails}</h1>
        <p className="text-gray-600 dark:text-gray-400 mt-2">
          {t.moderation.reviewReportMessage}
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Main Report Details */}
        <div className="lg:col-span-2">
          <Card className="mb-6">
            <CardHeader>
              <div className="flex items-center gap-2 mb-2">
                <Badge className={`${getPriorityColor(report.priority)} text-white`}>
                  {report.priority}
                </Badge>
                <Badge className={`${getStatusColor(report.status)} text-white`}>
                  {report.status.replace('_', ' ')}
                </Badge>
                <Badge variant="outline">
                  {report.contentType}
                </Badge>
              </div>
              <CardTitle className="text-xl">
                {report.contentTitle || `${report.contentType} ${report.contentId}`}
              </CardTitle>
              <CardDescription>
                Report ID: {report.id}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <h3 className="font-semibold mb-2">{t.moderation.reportReason}</h3>
                <p className="text-gray-600 dark:text-gray-400">
                  {report.reason.replace('_', ' ')}
                  {report.customReason && ` (${report.customReason})`}
                </p>
              </div>

              {report.description && (
                <div>
                  <h3 className="font-semibold mb-2">{t.moderation.descriptionLabel}</h3>
                  <p className="text-gray-600 dark:text-gray-400">
                    {report.description}
                  </p>
                </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <h4 className="font-medium mb-1">{t.moderation.reportedBy}</h4>
                  <p className="text-gray-600 dark:text-gray-400">
                    {report.reporterName || report.reporterId}
                  </p>
                </div>
                <div>
                  <h4 className="font-medium mb-1">{t.moderation.reportDate}</h4>
                  <p className="text-gray-600 dark:text-gray-400">
                    {new Date(report.dateCreated).toLocaleString()}
                  </p>
                </div>
              </div>

              {report.assignedToName && (
                <div>
                  <h4 className="font-medium mb-1">{t.moderation.assignedToLabel}</h4>
                  <p className="text-gray-600 dark:text-gray-400">
                    {report.assignedToName}
                  </p>
                </div>
              )}

              {report.resolutionNotes && (
                <div>
                  <h3 className="font-semibold mb-2">{t.moderation.resolutionNotesLabel}</h3>
                  <p className="text-gray-600 dark:text-gray-400">
                    {report.resolutionNotes}
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Content Preview */}
          <Card>
            <CardHeader>
              <CardTitle>{t.moderation.reportedContentLabel}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="bg-gray-100 dark:bg-gray-800 p-4 rounded-md">
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  Content ID: {report.contentId}
                </p>
                {report.contentUrl && (
                  <p className="text-sm">
                    <Link href={report.contentUrl} className="text-blue-600 hover:underline">
                      {t.moderation.viewOriginalContent} →
                    </Link>
                  </p>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Actions Panel */}
        <div className="lg:col-span-1">
          <Card className="mb-6">
            <CardHeader>
              <CardTitle>{t.moderation.takeAction}</CardTitle>
              <CardDescription>
                {t.moderation.chooseAction}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {!showActionForm ? (
                <div className="space-y-2">
                  <Button
                    onClick={() => setShowActionForm(true)}
                    className="w-full"
                    disabled={report.status === 'resolved' || report.status === 'dismissed'}
                  >
                    {t.moderation.takeModerationAction}
                  </Button>
                  {(report.status === 'resolved' || report.status === 'dismissed') && (
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                      {t.moderation.alreadyResolved}
                    </p>
                  )}
                </div>
              ) : (
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium mb-1">{t.moderation.actionType}</label>
                    <select
                      value={actionForm.actionType}
                      onChange={(e) => setActionForm({...actionForm, actionType: e.target.value})}
                      className="w-full p-2 border rounded-md dark:bg-gray-800 dark:border-gray-600"
                    >
                      <option value="">{t.moderation.selectAction}</option>
                      <option value="approve">{t.moderation.approveContent}</option>
                      <option value="remove">{t.moderation.removeContent}</option>
                      <option value="hide">{t.moderation.hideContent}</option>
                      <option value="warn_user">{t.moderation.warnUser}</option>
                      <option value="restrict_user">{t.moderation.restrictUser}</option>
                      <option value="ban_user">{t.moderation.banUser}</option>
                      <option value="dismiss_report">{t.moderation.dismissReport}</option>
                      <option value="flag_for_review">{t.moderation.flagForReview}</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-medium mb-1">{t.moderation.reportReason}</label>
                    <input
                      type="text"
                      value={actionForm.reason}
                      onChange={(e) => setActionForm({...actionForm, reason: e.target.value})}
                      placeholder={t.moderation.briefReason}
                      className="w-full p-2 border rounded-md dark:bg-gray-800 dark:border-gray-600"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium mb-1">{t.moderation.notesOptional}</label>
                    <textarea
                      value={actionForm.notes}
                      onChange={(e) => setActionForm({...actionForm, notes: e.target.value})}
                      placeholder={t.moderation.additionalNotes}
                      rows={3}
                      className="w-full p-2 border rounded-md dark:bg-gray-800 dark:border-gray-600"
                    />
                  </div>

                  <div className="flex gap-2">
                    <Button
                      onClick={handleModerationAction}
                      disabled={!actionForm.actionType || actionLoading}
                      className="flex-1"
                    >
                      {actionLoading ? t.moderation.takingAction : t.moderation.takeAction}
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => {
                        setShowActionForm(false);
                        setActionForm({ actionType: '', reason: '', notes: '' });
                      }}
                    >
                      {t.common.cancel}
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Action History */}
          {report.moderationActions && report.moderationActions.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>{t.moderation.actionHistory}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {report.moderationActions.map((action, index) => (
                    <div key={index} className="border-l-2 border-gray-200 dark:border-gray-700 pl-4 pb-3">
                      <div className="flex items-center gap-2 mb-1">
                        <Badge variant="outline" className="text-xs">
                          {action.actionType.replace('_', ' ')}
                        </Badge>
                      </div>
                      <p className="text-sm font-medium">
                        {action.moderatorName || action.moderatorId}
                      </p>
                      {action.reason && (
                        <p className="text-sm text-gray-600 dark:text-gray-400">
                          {action.reason}
                        </p>
                      )}
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        {new Date(action.dateCreated).toLocaleString()}
                      </p>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
};

export default ReportDetailPage;
