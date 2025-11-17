"use client";
import React, { useState } from "react";
import { VideoObject } from "@/interfaces";
import VideoUpload from "@/components/videoUpload";
import { useRouter } from "next/navigation";
import { CheckCircle, AlertCircle, Upload } from "lucide-react";
import { VIDEO_UPLOAD_CONFIG } from "@/lib/constants/uploadConfig";
import { useI18n } from "@/lib/i18n";

const UploadPage: React.FC = () => {
  const { t } = useI18n('en');
  const [uploadComplete, setUploadComplete] = useState(false);
  const [uploadedVideo, setUploadedVideo] = useState<VideoObject | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const router = useRouter();

  const handleUploadComplete = (video: VideoObject) => {
    setUploadedVideo(video);
    setUploadComplete(true);
    setUploadError(null);
  };

  const handleUploadProgress = (percentage: number) => {
    setUploadProgress(percentage);
  };

  const handleUploadError = (error: string) => {
    setUploadError(error);
    setUploadComplete(false);
  };

  const handleViewVideo = () => {
    if (uploadedVideo) {
      router.push(`/en/video/${uploadedVideo.id}`);
    }
  };

  const handleUploadAnother = () => {
    setUploadComplete(false);
    setUploadedVideo(null);
    setUploadError(null);
    setUploadProgress(0);
  };

  return (
    <main className="flex flex-col p-4 w-full min-h-screen bg-gray-50 dark:bg-gray-900">
      <div className="max-w-4xl mx-auto w-full">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">
            {t.upload.uploadTitle}
          </h1>
          <p className="text-gray-600 dark:text-gray-400">
            Share your content with the {t.common.appName} community
          </p>
        </div>

        {/* Upload Success State */}
        {uploadComplete && uploadedVideo && (
          <div className="mb-8 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-6">
            <div className="flex items-start">
              <CheckCircle className="h-6 w-6 text-green-500 mt-1 mr-3 flex-shrink-0" />
              <div className="flex-1">
                <h3 className="text-lg font-medium text-green-800 dark:text-green-200 mb-2">
                  {t.upload.uploadComplete}!
                </h3>
                <p className="text-green-700 dark:text-green-300 mb-4">
                  Your video &ldquo;{uploadedVideo.title}&rdquo; has been uploaded and is now being processed.
                </p>
                <div className="flex flex-wrap gap-3">
                  <button
                    onClick={handleViewVideo}
                    className="bg-green-600 text-white px-4 py-2 rounded-md hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500 font-medium"
                  >
                    View Video
                  </button>
                  <button
                    onClick={handleUploadAnother}
                    className="bg-white dark:bg-gray-800 text-green-600 dark:text-green-400 px-4 py-2 rounded-md border border-green-600 dark:border-green-400 hover:bg-green-50 dark:hover:bg-green-900/20 focus:outline-none focus:ring-2 focus:ring-green-500 font-medium"
                  >
                    {t.upload.uploadTitle} Another Video
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Upload Error State */}
        {uploadError && (
          <div className="mb-8 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-6">
            <div className="flex items-start">
              <AlertCircle className="h-6 w-6 text-red-500 mt-1 mr-3 flex-shrink-0" />
              <div className="flex-1">
                <h3 className="text-lg font-medium text-red-800 dark:text-red-200 mb-2">
                  {t.upload.uploadFailed}
                </h3>
                <p className="text-red-700 dark:text-red-300 mb-4">
                  {uploadError}
                </p>
                <button
                  onClick={() => setUploadError(null)}
                  className="bg-red-600 text-white px-4 py-2 rounded-md hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500 font-medium"
                >
                  Try Again
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Upload Progress */}
        {uploadProgress > 0 && uploadProgress < 100 && !uploadError && (
          <div className="mb-8 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-6">
            <div className="flex items-start">
              <Upload className="h-6 w-6 text-blue-500 mt-1 mr-3 flex-shrink-0" />
              <div className="flex-1">
                <h3 className="text-lg font-medium text-blue-800 dark:text-blue-200 mb-2">
                  {t.upload.uploading}
                </h3>
                <p className="text-blue-700 dark:text-blue-300 mb-4">
                  Please wait while your video is being uploaded and processed.
                </p>
                <div className="w-full bg-blue-200 dark:bg-blue-800 rounded-full h-2">
                  <div
                    className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                    style={{ width: `${uploadProgress}%` }}
                  ></div>
                </div>
                <p className="text-sm text-blue-600 dark:text-blue-400 mt-2">
                  {uploadProgress}% complete
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Upload Component */}
        {!uploadComplete && (
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6">
            <VideoUpload
              onUploadComplete={handleUploadComplete}
              onProgress={handleUploadProgress}
              onError={handleUploadError}
              className="w-full"
            />
          </div>
        )}

        {/* Upload Guidelines */}
        {!uploadComplete && (
          <div className="mt-8 bg-gray-100 dark:bg-gray-800 rounded-lg p-6">
            <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-4">
              Upload Guidelines
            </h3>
            <ul className="space-y-2 text-sm text-gray-600 dark:text-gray-400">
              <li className="flex items-start">
                <span className="inline-block w-2 h-2 bg-blue-500 rounded-full mt-2 mr-3 flex-shrink-0"></span>
                <span>Ensure your content aligns with Islamic values and community guidelines</span>
              </li>
              <li className="flex items-start">
                <span className="inline-block w-2 h-2 bg-blue-500 rounded-full mt-2 mr-3 flex-shrink-0"></span>
                <span>Supported formats: {VIDEO_UPLOAD_CONFIG.ALLOWED_TYPES_DISPLAY}</span>
              </li>
              <li className="flex items-start">
                <span className="inline-block w-2 h-2 bg-blue-500 rounded-full mt-2 mr-3 flex-shrink-0"></span>
                <span>Maximum file size: {VIDEO_UPLOAD_CONFIG.MAX_FILE_SIZE_DISPLAY}</span>
              </li>
              <li className="flex items-start">
                <span className="inline-block w-2 h-2 bg-blue-500 rounded-full mt-2 mr-3 flex-shrink-0"></span>
                <span>Maximum duration: {VIDEO_UPLOAD_CONFIG.MAX_DURATION_DISPLAY}</span>
              </li>
              <li className="flex items-start">
                <span className="inline-block w-2 h-2 bg-blue-500 rounded-full mt-2 mr-3 flex-shrink-0"></span>
                <span>Processing may take several minutes after upload</span>
              </li>
              <li className="flex items-start">
                <span className="inline-block w-2 h-2 bg-blue-500 rounded-full mt-2 mr-3 flex-shrink-0"></span>
                <span>Thumbnails are automatically generated from your video</span>
              </li>
            </ul>
          </div>
        )}
      </div>
    </main>
  );
};

export default UploadPage;