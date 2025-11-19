"use client";
import React, { useEffect, useState, useCallback } from "react";
import { useAuth } from "@/components/AuthProvider/authContext";
import * as ModerationAPI from "@/lib/api/moderation";
import type { ContentReport, ModerationStats } from "@/lib/api/moderation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import Link from "next/link";
import { useLanguage } from "@/hooks/useLanguage";
import { useParams } from "next/navigation";

const ModerationDashboard: React.FC = () => {
  const { t } = useLanguage();
  const params = useParams();
  const locale = params.locale as string;
  const [reports, setReports] = useState<ContentReport[]>([]);
  const [stats, setStats] = useState<ModerationStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<{
    status: string;
    priority: string;
    contentType: string;
  }>({
    status: '',
    priority: '',
    contentType: '',
  });

  const auth = useAuth();

  // Check if user has moderation privileges
  const isAuthorized = auth?.user && (auth.user.role === 'admin' || auth.user.role === 'moderator');

  const loadDashboardData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const headers = auth?.user ? { userId: auth.user.id } : undefined;

      // Load reports and stats in parallel
      const [reportsData, statsData] = await Promise.all([
        ModerationAPI.getReports({
          limit: 20,
          ...(filter.status && { status: filter.status }),
          ...(filter.priority && { priority: filter.priority }),
          ...(filter.contentType && { contentType: filter.contentType }),
        }, headers),
        ModerationAPI.getStats(headers)
      ]);

      setReports(reportsData || []);
      setStats(statsData);
    } catch (err) {
      setError(err instanceof Error ? err.message : t.errors.genericError);
    } finally {
      setLoading(false);
    }
  }, [auth, filter, t]);

  useEffect(() => {
    if (!isAuthorized) {
      setError(t.errors.unauthorized);
      setLoading(false);
      return;
    }

    loadDashboardData();
  }, [isAuthorized, filter, loadDashboardData]);

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
        <Button onClick={loadDashboardData} className="mt-4">
          {t.common.retry}
        </Button>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white">{t.moderation.moderationTitle}</h1>
        <p className="text-gray-600 dark:text-gray-400 mt-2">
          {t.moderation.dashboardSubtitle}
        </p>
      </div>

      {/* Stats Overview */}
      {stats && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">{t.moderation.totalReports}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.totalReports}</div>
              <p className="text-xs text-gray-500 dark:text-gray-400">{t.moderation.allTime || t.time?.allTime || 'All time'}</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">{t.moderation.pendingReports}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-yellow-600">{stats.pendingReports}</div>
              <p className="text-xs text-gray-500 dark:text-gray-400">{t.moderation.needsAttention}</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">{t.moderation.actions24h}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-blue-600">{stats.actionsLast24h}</div>
              <p className="text-xs text-gray-500 dark:text-gray-400">{t.moderation.recentActivity}</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">{t.moderation.avgResponseTime}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-green-600">{stats.averageResponseTime}h</div>
              <p className="text-xs text-gray-500 dark:text-gray-400">{t.moderation.meanResolution}</p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Filters */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle>{t.moderation.filterReports}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">{t.moderation.reportStatus}</label>
              <select
                value={filter.status}
                onChange={(e) => setFilter({...filter, status: e.target.value})}
                className="w-full p-2 border rounded-md dark:bg-gray-800 dark:border-gray-600"
              >
                <option value="">{t.moderation.status?.allStatuses || 'All Statuses'}</option>
                <option value="pending">{t.moderation.status.pending}</option>
                <option value="in_review">{t.moderation.status.inReview}</option>
                <option value="resolved">{t.moderation.status.resolved}</option>
                <option value="dismissed">{t.moderation.status?.dismissed || 'Dismissed'}</option>
                <option value="escalated">{t.moderation.status.escalated}</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">{t.moderation.priority}</label>
              <select
                value={filter.priority}
                onChange={(e) => setFilter({...filter, priority: e.target.value})}
                className="w-full p-2 border rounded-md dark:bg-gray-800 dark:border-gray-600"
              >
                <option value="">{t.moderation.priorityEnum.allPriorities}</option>
                <option value="urgent">{t.moderation.priorityEnum.urgent}</option>
                <option value="high">{t.moderation.priorityEnum.high}</option>
                <option value="medium">{t.moderation.priorityEnum.medium}</option>
                <option value="low">{t.moderation.priorityEnum.low}</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">{t.moderation.contentType}</label>
              <select
                value={filter.contentType}
                onChange={(e) => setFilter({...filter, contentType: e.target.value})}
                className="w-full p-2 border rounded-md dark:bg-gray-800 dark:border-gray-600"
              >
                <option value="">{t.moderation.contentTypeEnum.allTypes}</option>
                <option value="video">{t.moderation.contentTypeEnum.video}</option>
                <option value="comment">{t.moderation.contentTypeEnum.comment}</option>
                <option value="channel">{t.moderation.contentTypeEnum.channel}</option>
                <option value="playlist">{t.moderation.contentTypeEnum.playlist}</option>
              </select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Reports List */}
      <Card>
        <CardHeader>
          <CardTitle>{t.moderation.recentReports}</CardTitle>
          <CardDescription>{t.moderation.reportsPendingAction}</CardDescription>
        </CardHeader>
        <CardContent>
          {reports.length === 0 ? (
            <div className="text-center py-8 text-gray-500 dark:text-gray-400">
              {t.moderation.noReportsMatch}
            </div>
          ) : (
            <div className="space-y-4">
              {reports.map((report) => (
                <div key={report.id} className="border rounded-lg p-4 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
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

                      <h3 className="font-semibold text-lg mb-1">
                        {report.contentTitle || `${report.contentType} ${report.contentId}`}
                      </h3>

                      <p className="text-gray-600 dark:text-gray-400 mb-2">
                        <strong>{t.moderation.reason || 'Reason'}:</strong> {report.reason.replace('_', ' ')}
                      </p>

                      {report.description && (
                        <p className="text-gray-600 dark:text-gray-400 mb-2">
                          <strong>{t.moderation.description || 'Description'}:</strong> {report.description}
                        </p>
                      )}

                      <div className="flex items-center gap-4 text-sm text-gray-500 dark:text-gray-400">
                        <span>{t.moderation.reportedBy || 'Reported by'}: {report.reporterName}</span>
                        <span>•</span>
                        <span>{new Date(report.dateCreated).toLocaleDateString()}</span>
                        {report.assignedToName && (
                          <>
                            <span>•</span>
                            <span>{t.moderation.assignedTo || 'Assigned to'}: {report.assignedToName}</span>
                          </>
                        )}
                      </div>
                    </div>

                    <div className="flex gap-2 ml-4">
                      <Link href={`/${locale}/moderation/reports/${report.id}`}>
                        <Button variant="outline" size="sm">
                          {t.moderation.reviewReport}
                        </Button>
                      </Link>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Quick Actions */}
      <div className="mt-8 flex gap-4">
        <Link href={`/${locale}/moderation/reports`}>
          <Button>{t.moderation.viewAllReports}</Button>
        </Link>
        <Link href={`/${locale}/moderation/actions`}>
          <Button variant="outline">{t.moderation.actionHistory}</Button>
        </Link>
        <Link href={`/${locale}/moderation/users`}>
          <Button variant="outline">{t.moderation.userManagement}</Button>
        </Link>
      </div>
    </div>
  );
};

export default ModerationDashboard;
