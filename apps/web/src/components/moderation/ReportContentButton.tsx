"use client";
import React, { useState } from "react";
import { Flag, X, Info } from "lucide-react";
import { useAuth } from "@/components/AuthProvider/authContext";
import * as ModerationAPI from "@/lib/api/moderation";
import type { ReportCreateRequest, ReportContentType, ReportReason } from "@/lib/api/moderation";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useLanguage } from "@/hooks/useLanguage";
import { logger } from "@/lib/logger-client";

interface ReportContentButtonProps {
  contentType: ReportContentType;
  contentId: string;
  contentTitle?: string;
  className?: string;
  /** Render a compact icon-only trigger (e.g. inside a comment) */
  compact?: boolean;
  children?: React.ReactNode;
}

const REASONS: ReportReason[] = ['inappropriate', 'spam', 'harassment', 'copyright', 'misinformation', 'other'];

const ReportContentButton: React.FC<ReportContentButtonProps> = ({
  contentType,
  contentId,
  contentTitle,
  className = "",
  compact = false,
  children
}) => {
  const { t, isRTL } = useLanguage();
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reportForm, setReportForm] = useState<{
    reason: ReportReason | '';
    customReason: string;
    description: string;
  }>({
    reason: '',
    customReason: '',
    description: '',
  });

  const auth = useAuth();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!auth?.user) {
      setError(t.errors.loginRequired);
      return;
    }

    if (!reportForm.reason) {
      setError(t.errors.reportReasonRequired);
      return;
    }

    setLoading(true);
    setError(null);

    const reportData: ReportCreateRequest = {
      contentType,
      contentId,
      reason: reportForm.reason,
      ...(reportForm.customReason && { customReason: reportForm.customReason }),
      ...(reportForm.description && { description: reportForm.description }),
    };

    const result = await ModerationAPI.createReport(reportData);
    setLoading(false);

    if (!result.success) {
      logger.warn('[ReportContentButton] Report failed', { contentType, contentId, error: result.error });
      setError(
        result.error === 'auth'
          ? t.errors.loginRequired
          : result.error === 'duplicate'
            ? t.reportContent.alreadyReported
            : t.reportContent.failed
      );
      return;
    }

    setSuccess(true);
    setReportForm({ reason: '', customReason: '', description: '' });

    // Auto close after success
    setTimeout(() => {
      setIsOpen(false);
      setSuccess(false);
    }, 3000);
  };

  const resetForm = () => {
    setReportForm({ reason: '', customReason: '', description: '' });
    setError(null);
    setSuccess(false);
  };

  const handleClose = () => {
    setIsOpen(false);
    resetForm();
  };

  if (!auth?.user) {
    return null; // Don't show report button if user is not logged in
  }

  const contentTypeLabel = contentType === 'livestream'
    ? (t.live?.liveStreams || t.moderation.contentTypeEnum.video)
    : t.moderation.contentTypeEnum[contentType];

  return (
    <>
      {compact ? (
        <button
          type="button"
          onClick={() => setIsOpen(true)}
          className={`flex items-center gap-1 hover:text-red-600 ${className}`}
          aria-label={t.reportContent.report}
          title={t.reportContent.report}
        >
          <Flag className="w-4 h-4" />
        </button>
      ) : (
        <Button
          variant="outline"
          size="sm"
          onClick={() => setIsOpen(true)}
          className={className}
        >
          {children || (
            <span className="flex items-center gap-1">
              <Flag className="w-4 h-4" />
              {t.reportContent.report}
            </span>
          )}
        </Button>
      )}

      {/* Modal/Overlay */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="report-content-title"
          dir={isRTL ? 'rtl' : 'ltr'}
        >
          <div className={`bg-white dark:bg-gray-800 rounded-lg max-w-md w-full max-h-[90vh] overflow-y-auto ${isRTL ? 'text-right' : 'text-left'}`}>
            <div className="p-6">
              <div className="flex justify-between items-center mb-4">
                <h2 id="report-content-title" className="text-xl font-semibold">{t.reportContent.title}</h2>
                <button
                  type="button"
                  onClick={handleClose}
                  className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                  aria-label={t.reportContent.close}
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {success ? (
                <Alert className="border-green-200 bg-green-50">
                  <AlertDescription className="text-green-800">
                    {t.reportContent.thankYou}
                  </AlertDescription>
                </Alert>
              ) : (
                <form onSubmit={handleSubmit} className="space-y-4">
                  {error && (
                    <Alert className="border-red-200 bg-red-50">
                      <AlertDescription className="text-red-800">{error}</AlertDescription>
                    </Alert>
                  )}

                  <div>
                    <p className="text-sm text-gray-600 dark:text-gray-400 mb-2">
                      {t.reportContent.reporting} <strong>{contentTitle || contentTypeLabel}</strong>
                    </p>
                  </div>

                  <div>
                    <label htmlFor="report-reason" className="block text-sm font-medium mb-2">
                      {t.reportContent.whyReporting}
                    </label>
                    <select
                      id="report-reason"
                      value={reportForm.reason}
                      onChange={(e) => setReportForm({ ...reportForm, reason: e.target.value as ReportReason | '' })}
                      className="w-full p-2 border rounded-md dark:bg-gray-700 dark:border-gray-600"
                      required
                    >
                      <option value="">{t.reportContent.selectReason}</option>
                      {REASONS.map((reason) => (
                        <option key={reason} value={reason}>{t.reportContent.reasons[reason]}</option>
                      ))}
                    </select>
                  </div>

                  {reportForm.reason === 'other' && (
                    <div>
                      <label htmlFor="report-custom-reason" className="block text-sm font-medium mb-2">
                        {t.reportContent.pleaseSpecify}
                      </label>
                      <input
                        id="report-custom-reason"
                        type="text"
                        value={reportForm.customReason}
                        onChange={(e) => setReportForm({ ...reportForm, customReason: e.target.value })}
                        placeholder={t.reportContent.briefDescription}
                        className="w-full p-2 border rounded-md dark:bg-gray-700 dark:border-gray-600"
                        maxLength={100}
                      />
                    </div>
                  )}

                  <div>
                    <label htmlFor="report-description" className="block text-sm font-medium mb-2">
                      {t.reportContent.additionalDetails}
                    </label>
                    <textarea
                      id="report-description"
                      value={reportForm.description}
                      onChange={(e) => setReportForm({ ...reportForm, description: e.target.value })}
                      placeholder={t.reportContent.additionalDetailsPlaceholder}
                      rows={3}
                      className="w-full p-2 border rounded-md dark:bg-gray-700 dark:border-gray-600"
                      maxLength={500}
                    />
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                      {t.reportContent.charactersCount.replace('{count}', String(reportForm.description.length))}
                    </p>
                  </div>

                  <div className="bg-brand-soft dark:bg-brand-soft p-3 rounded-md">
                    <p className="text-sm text-brand-ink dark:text-brand-ink flex gap-1">
                      <Info className="w-4 h-4 flex-shrink-0 mt-0.5" />
                      <span>{t.reportContent.reviewNotice}</span>
                    </p>
                  </div>

                  <div className="flex gap-3 pt-4">
                    <Button
                      type="submit"
                      disabled={loading || !reportForm.reason}
                      className="flex-1"
                    >
                      {loading ? t.reportContent.submitting : t.reportContent.submit}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={handleClose}
                      className="flex-1"
                    >
                      {t.reportContent.cancel}
                    </Button>
                  </div>
                </form>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default ReportContentButton;
