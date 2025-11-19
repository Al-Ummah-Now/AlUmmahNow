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
import { pluralizeArabic } from "@/lib/utility";

const ModerationDashboard: React.FC = () => {
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

  // Translation maps for moderation values
  const statusTranslations: Record<string, string> = {
    pending: 'في الانتظار',
    in_review: 'قيد المراجعة',
    resolved: 'تم الحل',
    dismissed: 'مرفوض',
    escalated: 'مُصعَّد',
  };

  const priorityTranslations: Record<string, string> = {
    urgent: 'عاجل',
    high: 'عالي',
    medium: 'متوسط',
    low: 'منخفض',
  };

  const contentTypeTranslations: Record<string, string> = {
    video: 'فيديو',
    comment: 'تعليق',
    channel: 'قناة',
    playlist: 'قائمة تشغيل',
  };

  const reasonTranslations: Record<string, string> = {
    inappropriate_content: 'محتوى غير مناسب',
    spam: 'رسائل مزعجة',
    harassment: 'تحرش',
    copyright: 'انتهاك حقوق النشر',
    violence: 'عنف',
    hate_speech: 'خطاب كراهية',
    nudity: 'عري',
    misinformation: 'معلومات خاطئة',
    other: 'أخرى',
  };

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
      setError(err instanceof Error ? err.message : 'فشل في تحميل بيانات الإشراف');
    } finally {
      setLoading(false);
    }
  }, [auth, filter]);

  useEffect(() => {
    if (!isAuthorized) {
      setError("الوصول مرفوض. تحتاج إلى صلاحيات مشرف أو مدير للوصول إلى هذه الصفحة.");
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
      <div className="container mx-auto px-4 py-8" dir="rtl">
        <Alert className="border-red-200 bg-red-50">
          <AlertDescription className="text-red-800">
            الوصول مرفوض. تحتاج إلى صلاحيات مشرف أو مدير للوصول إلى هذه الصفحة.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="container mx-auto px-4 py-8" dir="rtl">
        <div className="flex justify-center items-center min-h-64">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500"></div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="container mx-auto px-4 py-8" dir="rtl">
        <Alert className="border-red-200 bg-red-50">
          <AlertDescription className="text-red-800">{error}</AlertDescription>
        </Alert>
        <Button onClick={loadDashboardData} className="mt-4">
          حاول مرة أخرى
        </Button>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8" dir="rtl">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white">لوحة تحكم إشراف المحتوى</h1>
        <p className="text-gray-600 dark:text-gray-400 mt-2">
          مراجعة المحتوى المُبلغ عنه وإدارة معايير المجتمع
        </p>
      </div>

      {/* Stats Overview */}
      {stats && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">إجمالي التقارير</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.totalReports}</div>
              <p className="text-xs text-gray-500 dark:text-gray-400">جميع الأوقات</p>
            </CardContent>
          </Card>
          
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">التقارير المعلقة</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-yellow-600">{stats.pendingReports}</div>
              <p className="text-xs text-gray-500 dark:text-gray-400">تحتاج انتباه</p>
            </CardContent>
          </Card>
          
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">الإجراءات (24 ساعة)</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-blue-600">{stats.actionsLast24h}</div>
              <p className="text-xs text-gray-500 dark:text-gray-400">النشاط الحديث</p>
            </CardContent>
          </Card>
          
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">متوسط وقت الاستجابة</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-green-600">{pluralizeArabic(stats.averageResponseTime, 'ساعة', 'ساعتان', 'ساعات')}</div>
              <p className="text-xs text-gray-500 dark:text-gray-400">متوسط الحل</p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Filters */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle>تصفية التقارير</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">الحالة</label>
              <select 
                value={filter.status}
                onChange={(e) => setFilter({...filter, status: e.target.value})}
                className="w-full p-2 border rounded-md dark:bg-gray-800 dark:border-gray-600"
              >
                <option value="">جميع الحالات</option>
                <option value="pending">في الانتظار</option>
                <option value="in_review">قيد المراجعة</option>
                <option value="resolved">تم الحل</option>
                <option value="dismissed">مرفوض</option>
                <option value="escalated">مُصعَّد</option>
              </select>
            </div>
            
            <div>
              <label className="block text-sm font-medium mb-1">الأولوية</label>
              <select 
                value={filter.priority}
                onChange={(e) => setFilter({...filter, priority: e.target.value})}
                className="w-full p-2 border rounded-md dark:bg-gray-800 dark:border-gray-600"
              >
                <option value="">جميع الأولويات</option>
                <option value="urgent">عاجل</option>
                <option value="high">عالي</option>
                <option value="medium">متوسط</option>
                <option value="low">منخفض</option>
              </select>
            </div>
            
            <div>
              <label className="block text-sm font-medium mb-1">نوع المحتوى</label>
              <select 
                value={filter.contentType}
                onChange={(e) => setFilter({...filter, contentType: e.target.value})}
                className="w-full p-2 border rounded-md dark:bg-gray-800 dark:border-gray-600"
              >
                <option value="">جميع الأنواع</option>
                <option value="video">فيديوهات</option>
                <option value="comment">تعليقات</option>
                <option value="channel">قنوات</option>
                <option value="playlist">قوائم التشغيل</option>
              </select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Reports List */}
      <Card>
        <CardHeader>
          <CardTitle>التقارير الأخيرة</CardTitle>
          <CardDescription>تقارير المحتوى في انتظار إجراءات الإشراف</CardDescription>
        </CardHeader>
        <CardContent>
          {reports.length === 0 ? (
            <div className="text-center py-8 text-gray-500 dark:text-gray-400">
              لا توجد تقارير تطابق المرشحات الحالية.
            </div>
          ) : (
            <div className="space-y-4">
              {reports.map((report) => (
                <div key={report.id} className="border rounded-lg p-4 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <Badge className={`${getPriorityColor(report.priority)} text-white`}>
                          {priorityTranslations[report.priority] || report.priority}
                        </Badge>
                        <Badge className={`${getStatusColor(report.status)} text-white`}>
                          {statusTranslations[report.status] || report.status}
                        </Badge>
                        <Badge variant="outline">
                          {contentTypeTranslations[report.contentType] || report.contentType}
                        </Badge>
                      </div>

                      <h3 className="font-semibold text-lg mb-1">
                        {report.contentTitle || `${contentTypeTranslations[report.contentType] || report.contentType} ${report.contentId}`}
                      </h3>

                      <p className="text-gray-600 dark:text-gray-400 mb-2">
                        <strong>السبب:</strong> {reasonTranslations[report.reason] || report.reason}
                      </p>
                      
                      {report.description && (
                        <p className="text-gray-600 dark:text-gray-400 mb-2">
                          <strong>الوصف:</strong> {report.description}
                        </p>
                      )}
                      
                      <div className="flex items-center gap-4 text-sm text-gray-500 dark:text-gray-400">
                        <span>بلغ من قبل: {report.reporterName}</span>
                        <span>•</span>
                        <span>{new Date(report.dateCreated).toLocaleDateString('ar-SA')}</span>
                        {report.assignedToName && (
                          <>
                            <span>•</span>
                            <span>مُكلف إلى: {report.assignedToName}</span>
                          </>
                        )}
                      </div>
                    </div>
                    
                    <div className="flex gap-2 mr-4">
                      <Link href={`/ar/moderation/reports/${report.id}`}>
                        <Button variant="outline" size="sm">
                          مراجعة
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
        <Link href="/ar/moderation/reports">
          <Button>عرض جميع التقارير</Button>
        </Link>
        <Link href="/ar/moderation/actions">
          <Button variant="outline">تاريخ الإجراءات</Button>
        </Link>
        <Link href="/ar/moderation/users">
          <Button variant="outline">إدارة المستخدمين</Button>
        </Link>
      </div>
    </div>
  );
};

export default ModerationDashboard;