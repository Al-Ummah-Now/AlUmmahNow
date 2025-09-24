"use client";
import React, { useState, useRef, useCallback } from "react";
import { VideoObject } from "@/interfaces";
import { Upload, X, AlertCircle, CheckCircle, Loader } from "lucide-react";

interface VideoUploadProps {
  onUploadComplete: (video: VideoObject) => void;
  onProgress: (percentage: number) => void;
  onError: (error: string) => void;
  className?: string;
}

interface VideoMetadata {
  title: string;
  description?: string;
  tags?: string[];
  isPublic: boolean;
}

interface UploadProgress {
  percentage: number;
  stage: 'preparing' | 'uploading' | 'processing' | 'complete';
  error?: string;
}

const VideoUpload: React.FC<VideoUploadProps> = ({ 
  onUploadComplete, 
  onProgress, 
  onError, 
  className = "" 
}) => {
  const [isDragOver, setIsDragOver] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadProgress, setUploadProgress] = useState<UploadProgress | null>(null);
  const [metadata, setMetadata] = useState<VideoMetadata>({
    title: '',
    description: '',
    tags: [],
    isPublic: true
  });
  const [showMetadataForm, setShowMetadataForm] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // File validation
  const validateFile = (file: File): string | null => {
    const maxSize = 2 * 1024 * 1024 * 1024; // 2GB
    const allowedTypes = ['video/mp4', 'video/mov', 'video/avi', 'video/webm'];
    const maxDuration = 60 * 60 * 2; // 2 hours in seconds

    if (!allowedTypes.includes(file.type)) {
      return 'Please upload a valid video file (MP4, MOV, AVI, or WebM)';
    }

    if (file.size > maxSize) {
      return 'File size must be less than 2GB';
    }

    // TODO: Add duration validation when we can read video metadata
    return null;
  };

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  }, []);

  const handleFileSelection = useCallback((file: File) => {
    const validationError = validateFile(file);
    if (validationError) {
      onError(validationError);
      return;
    }

    setSelectedFile(file);
    setMetadata(prev => ({
      ...prev,
      title: file.name.replace(/\.[^/.]+$/, "") // Remove extension for default title
    }));
    setShowMetadataForm(true);
  }, [onError]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);

    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) {
      handleFileSelection(files[0]);
    }
  }, [handleFileSelection]);

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      handleFileSelection(files[0]);
    }
  };

  const uploadVideo = async () => {
    if (!selectedFile) return;

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      setUploadProgress({ percentage: 0, stage: 'preparing' });
      
      // Create FormData for multipart upload
      const formData = new FormData();
      formData.append('video', selectedFile);
      formData.append('title', metadata.title);
      formData.append('description', metadata.description || '');
      formData.append('isPublic', metadata.isPublic.toString());
      if (metadata.tags && metadata.tags.length > 0) {
        formData.append('tags', JSON.stringify(metadata.tags));
      }

      setUploadProgress({ percentage: 10, stage: 'uploading' });
      onProgress(10);

      const response = await fetch('/api/upload/video', {
        method: 'POST',
        body: formData,
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorData = await response.json() as { message?: string };
        throw new Error(errorData.message || 'Upload failed');
      }

      setUploadProgress({ percentage: 80, stage: 'processing' });
      onProgress(80);

      const result = await response.json() as { video: VideoObject };

      setUploadProgress({ percentage: 100, stage: 'complete' });
      onProgress(100);

      // Reset form
      setSelectedFile(null);
      setShowMetadataForm(false);
      setUploadProgress(null);
      setMetadata({
        title: '',
        description: '',
        tags: [],
        isPublic: true
      });

      onUploadComplete(result.video);
    } catch (error: any) {
      if (error.name === 'AbortError') {
        setUploadProgress(null);
        return;
      }

      const errorMessage = error.message || 'Upload failed. Please try again.';
      setUploadProgress({ percentage: 0, stage: 'preparing', error: errorMessage });
      onError(errorMessage);
    }
  };

  const cancelUpload = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    setUploadProgress(null);
    setSelectedFile(null);
    setShowMetadataForm(false);
  };

  const resetForm = () => {
    setSelectedFile(null);
    setShowMetadataForm(false);
    setUploadProgress(null);
    setMetadata({
      title: '',
      description: '',
      tags: [],
      isPublic: true
    });
  };

  if (showMetadataForm && selectedFile) {
    return (
      <div className={`bg-white dark:bg-gray-800 rounded-lg p-6 shadow-lg ${className}`}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
            Video Details
          </h3>
          <button
            onClick={resetForm}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
          >
            <X size={20} />
          </button>
        </div>

        <div className="mb-4">
          <p className="text-sm text-gray-600 dark:text-gray-400 mb-2">Selected file:</p>
          <p className="font-medium text-gray-900 dark:text-white">{selectedFile.name}</p>
          <p className="text-sm text-gray-500">
            {(selectedFile.size / 1024 / 1024).toFixed(2)} MB
          </p>
        </div>

        {uploadProgress && (
          <div className="mb-6">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                {uploadProgress.stage === 'preparing' && 'Preparing upload...'}
                {uploadProgress.stage === 'uploading' && 'Uploading video...'}
                {uploadProgress.stage === 'processing' && 'Processing video...'}
                {uploadProgress.stage === 'complete' && 'Upload complete!'}
              </span>
              <span className="text-sm text-gray-500">{uploadProgress.percentage}%</span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2">
              <div
                className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                style={{ width: `${uploadProgress.percentage}%` }}
              ></div>
            </div>
            {uploadProgress.error && (
              <div className="flex items-center mt-2 text-red-600">
                <AlertCircle size={16} className="mr-1" />
                <span className="text-sm">{uploadProgress.error}</span>
              </div>
            )}
          </div>
        )}

        <div className="space-y-4 mb-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Title *
            </label>
            <input
              type="text"
              value={metadata.title}
              onChange={(e) => setMetadata(prev => ({ ...prev, title: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-white"
              placeholder="Enter video title"
              required
              disabled={!!uploadProgress}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Description
            </label>
            <textarea
              value={metadata.description}
              onChange={(e) => setMetadata(prev => ({ ...prev, description: e.target.value }))}
              rows={3}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-white"
              placeholder="Enter video description"
              disabled={!!uploadProgress}
            />
          </div>

          <div className="flex items-center">
            <input
              type="checkbox"
              id="isPublic"
              checked={metadata.isPublic}
              onChange={(e) => setMetadata(prev => ({ ...prev, isPublic: e.target.checked }))}
              className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
              disabled={!!uploadProgress}
            />
            <label htmlFor="isPublic" className="ml-2 block text-sm text-gray-700 dark:text-gray-300">
              Make this video public
            </label>
          </div>
        </div>

        <div className="flex space-x-3">
          {!uploadProgress ? (
            <>
              <button
                onClick={uploadVideo}
                disabled={!metadata.title.trim()}
                className="flex-1 bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed font-medium"
              >
                Upload Video
              </button>
              <button
                onClick={resetForm}
                className="px-4 py-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-md hover:bg-gray-50 dark:hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-gray-500"
              >
                Cancel
              </button>
            </>
          ) : (
            <button
              onClick={cancelUpload}
              className="flex-1 bg-red-600 text-white px-4 py-2 rounded-md hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500 font-medium"
            >
              Cancel Upload
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={className}>
      <div
        className={`relative border-2 border-dashed rounded-lg p-12 text-center transition-colors ${
          isDragOver
            ? 'border-blue-400 bg-blue-50 dark:bg-blue-900/20'
            : 'border-gray-300 dark:border-gray-600 hover:border-gray-400 dark:hover:border-gray-500'
        }`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept="video/*"
          onChange={handleFileInputChange}
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
          multiple={false}
        />
        
        <div className="flex flex-col items-center">
          <Upload
            size={48}
            className={`mb-4 ${
              isDragOver ? 'text-blue-500' : 'text-gray-400 dark:text-gray-500'
            }`}
          />
          <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">
            {isDragOver ? 'Drop your video here' : 'Upload a video'}
          </h3>
          <p className="text-gray-600 dark:text-gray-400 mb-4">
            Drag and drop a video file, or click to browse
          </p>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Supports MP4, MOV, AVI, WebM • Max 2GB • Max 2 hours
          </p>
        </div>
      </div>
    </div>
  );
};

export default VideoUpload;