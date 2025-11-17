"use client";
import React, { useState } from "react";
import { useAuth } from "@/components/AuthProvider/authContext";
import * as ModerationAPI from "@/lib/api/moderation";
import type { ReportCreateRequest } from "@/lib/api/moderation";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { createApiHeaders } from "@/lib/utility";

interface ReportContentButtonProps {
  contentType: 'video' | 'comment' | 'channel' | 'playlist';
  contentId: string;
  contentTitle?: string;
  className?: string;
  children?: React.ReactNode;
}

const ReportContentButton: React.FC<ReportContentButtonProps> = ({
  contentType,
  contentId,
  contentTitle,
  className = "",
  children
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reportForm, setReportForm] = useState<{
    reason: string;
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
      setError("You must be logged in to report content.");
      return;
    }

    if (!reportForm.reason) {
      setError("Please select a reason for reporting this content.");
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const reportData: ReportCreateRequest = {
        contentType,
        contentId,
        reason: reportForm.reason,
        ...(reportForm.customReason && { customReason: reportForm.customReason }),
        ...(reportForm.description && { description: reportForm.description }),
      };

      const headers = createApiHeaders(auth.user, contentType === 'channel' ? contentId : undefined);
      await ModerationAPI.createReport(reportData, headers);

      setSuccess(true);
      setReportForm({ reason: '', customReason: '', description: '' });
      
      // Auto close after success
      setTimeout(() => {
        setIsOpen(false);
        setSuccess(false);
      }, 3000);
      
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit report');
    } finally {
      setLoading(false);
    }
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

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setIsOpen(true)}
        className={className}
      >
        {children || (
          <>
            <i className="fas fa-flag mr-1"></i>
            Report
          </>
        )}
      </Button>

      {/* Modal/Overlay */}
      {isOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-lg max-w-md w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-xl font-semibold">Report Content</h2>
                <button
                  onClick={handleClose}
                  className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                >
                  <i className="fas fa-times"></i>
                </button>
              </div>

              {success ? (
                <Alert className="border-green-200 bg-green-50">
                  <AlertDescription className="text-green-800">
                    Thank you for your report. Our moderation team will review it shortly.
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
                      Reporting: <strong>{contentTitle || `${contentType} ${contentId}`}</strong>
                    </p>
                  </div>

                  <div>
                    <label className="block text-sm font-medium mb-2">
                      Why are you reporting this content? *
                    </label>
                    <select
                      value={reportForm.reason}
                      onChange={(e) => setReportForm({...reportForm, reason: e.target.value})}
                      className="w-full p-2 border rounded-md dark:bg-gray-700 dark:border-gray-600"
                      required
                    >
                      <option value="">Select a reason...</option>
                      <option value="inappropriate_content">Inappropriate Content</option>
                      <option value="spam">Spam or Misleading</option>
                      <option value="harassment">Harassment or Bullying</option>
                      <option value="copyright">Copyright Violation</option>
                      <option value="violence">Violence or Dangerous Content</option>
                      <option value="hate_speech">Hate Speech</option>
                      <option value="nudity">Nudity or Sexual Content</option>
                      <option value="misinformation">Misinformation</option>
                      <option value="other">Other</option>
                    </select>
                  </div>

                  {reportForm.reason === 'other' && (
                    <div>
                      <label className="block text-sm font-medium mb-2">
                        Please specify:
                      </label>
                      <input
                        type="text"
                        value={reportForm.customReason}
                        onChange={(e) => setReportForm({...reportForm, customReason: e.target.value})}
                        placeholder="Brief description of the issue"
                        className="w-full p-2 border rounded-md dark:bg-gray-700 dark:border-gray-600"
                        maxLength={100}
                      />
                    </div>
                  )}

                  <div>
                    <label className="block text-sm font-medium mb-2">
                      Additional details (optional)
                    </label>
                    <textarea
                      value={reportForm.description}
                      onChange={(e) => setReportForm({...reportForm, description: e.target.value})}
                      placeholder="Provide any additional context that might help our review"
                      rows={3}
                      className="w-full p-2 border rounded-md dark:bg-gray-700 dark:border-gray-600"
                      maxLength={500}
                    />
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                      {reportForm.description.length}/500 characters
                    </p>
                  </div>

                  <div className="bg-yellow-50 dark:bg-yellow-900/20 p-3 rounded-md">
                    <p className="text-sm text-yellow-800 dark:text-yellow-200">
                      <i className="fas fa-info-circle mr-1"></i>
                      Reports are reviewed by our moderation team and may take 24-48 hours to process. 
                      False reports may result in account restrictions.
                    </p>
                  </div>

                  <div className="flex gap-3 pt-4">
                    <Button
                      type="submit"
                      disabled={loading || !reportForm.reason}
                      className="flex-1"
                    >
                      {loading ? 'Submitting...' : 'Submit Report'}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={handleClose}
                      className="flex-1"
                    >
                      Cancel
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