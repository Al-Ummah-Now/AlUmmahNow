/**
 * Storage Monitor Component
 *
 * Displays localStorage usage statistics and provides management tools.
 * Useful for debugging storage issues and monitoring quota usage.
 *
 * Features:
 * - Real-time storage usage display
 * - Item-by-item breakdown
 * - Manual cleanup triggers
 * - Warning alerts for high usage
 */

'use client';
import { logger } from '@/lib/logger-client';

import React, { useState, useEffect } from 'react';
import { StorageManager } from '@/lib/utils/storage';

interface StorageStats {
  used: number;
  max: number;
  percentage: number;
  isWarning: boolean;
  items: { key: string; size: number }[];
}

/**
 * Format bytes to human-readable string
 */
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 Bytes';

  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * Storage Monitor Component
 */
export function StorageMonitor() {
  const [stats, setStats] = useState<StorageStats | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [showDetails, setShowDetails] = useState(false);

  // Load storage stats
  const loadStats = () => {
    setIsLoading(true);
    try {
      const storageStats = StorageManager.getStorageStats();
      setStats(storageStats);
    } catch (error) {
      logger.error('[StorageMonitor] Failed to load stats:', error);
    } finally {
      setIsLoading(false);
    }
  };

  // Load on mount and set up refresh interval
  useEffect(() => {
    loadStats();

    // Refresh every 5 seconds if details are shown
    const interval = showDetails ? setInterval(loadStats, 5000) : null;

    return () => {
      if (interval) clearInterval(interval);
    };
  }, [showDetails]);

  // Handle manual cleanup
  const handleCleanup = async (aggressive: boolean = false) => {
    try {
      const keys = ['watchProgress', 'video_views_tracked', 'videoAnalytics'];
      const maxAge = aggressive ? 7 * 24 * 60 * 60 * 1000 : 30 * 24 * 60 * 60 * 1000; // 7 or 30 days

      const removed = StorageManager.cleanupOldData(keys, maxAge);

      // Show success message
      alert(`Cleanup complete! Removed ${removed} old items.`);

      // Reload stats
      loadStats();
    } catch (error) {
      logger.error('[StorageMonitor] Cleanup failed:', error);
      alert('Cleanup failed. Check console for details.');
    }
  };

  // Handle clear all (dangerous!)
  const handleClearAll = () => {
    const confirmed = window.confirm(
      'WARNING: This will delete ALL localStorage data including user preferences and watch history. Are you sure?'
    );

    if (confirmed) {
      const doubleConfirmed = window.confirm(
        'This action cannot be undone. Are you REALLY sure?'
      );

      if (doubleConfirmed) {
        try {
          StorageManager.clearAll();
          alert('All localStorage data has been cleared.');
          loadStats();
        } catch (error) {
          logger.error('[StorageMonitor] Clear all failed:', error);
          alert('Failed to clear storage. Check console for details.');
        }
      }
    }
  };

  if (isLoading && !stats) {
    return (
      <div className="p-4 bg-gray-50 dark:bg-gray-900 rounded-lg">
        <p className="text-gray-500">Loading storage statistics...</p>
      </div>
    );
  }

  if (!stats) {
    return (
      <div className="p-4 bg-red-50 dark:bg-red-900/20 rounded-lg">
        <p className="text-red-600 dark:text-red-400">Failed to load storage statistics</p>
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700">
      {/* Header */}
      <div className="p-4 border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
            Storage Monitor
          </h3>
          <button
            onClick={() => setShowDetails(!showDetails)}
            className="text-sm text-blue-600 hover:text-blue-700 dark:text-blue-400"
          >
            {showDetails ? 'Hide Details' : 'Show Details'}
          </button>
        </div>
      </div>

      {/* Usage Bar */}
      <div className="p-4">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-sm text-gray-600 dark:text-gray-400">
            Storage Usage
          </span>
          <span className="text-sm font-medium text-gray-900 dark:text-white">
            {formatBytes(stats.used)} / {formatBytes(stats.max)}
          </span>
        </div>

        <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-3 overflow-hidden">
          <div
            className={`h-full transition-all duration-300 ${
              stats.percentage > 90
                ? 'bg-red-600'
                : stats.percentage > 80
                ? 'bg-brand'
                : 'bg-green-500'
            }`}
            style={{ width: `${Math.min(stats.percentage, 100)}%` }}
          />
        </div>

        <div className="mt-2 text-sm text-gray-500 dark:text-gray-400">
          {stats.percentage.toFixed(1)}% used
          {stats.isWarning && (
            <span className="ml-2 text-brand-ink dark:text-brand-ink font-medium">
              ⚠️ Approaching quota limit
            </span>
          )}
        </div>
      </div>

      {/* Details Section */}
      {showDetails && (
        <>
          {/* Item Breakdown */}
          <div className="p-4 border-t border-gray-200 dark:border-gray-700">
            <h4 className="text-sm font-medium text-gray-900 dark:text-white mb-3">
              Storage Breakdown
            </h4>
            <div className="space-y-2 max-h-60 overflow-y-auto">
              {stats.items.length === 0 ? (
                <p className="text-sm text-gray-500">No items in storage</p>
              ) : (
                stats.items.map((item, index) => (
                  <div
                    key={index}
                    className="flex items-center justify-between py-1 px-2 rounded hover:bg-gray-50 dark:hover:bg-gray-700/50"
                  >
                    <span className="text-sm text-gray-700 dark:text-gray-300 font-mono truncate max-w-xs">
                      {item.key}
                    </span>
                    <span className="text-sm text-gray-500 dark:text-gray-400 ml-2 whitespace-nowrap">
                      {formatBytes(item.size)}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Actions */}
          <div className="p-4 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50">
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => loadStats()}
                className="px-3 py-1.5 text-sm bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 rounded-md transition-colors"
              >
                🔄 Refresh
              </button>

              <button
                onClick={() => handleCleanup(false)}
                className="px-3 py-1.5 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-md transition-colors"
              >
                🧹 Clean Old Data (30d)
              </button>

              <button
                onClick={() => handleCleanup(true)}
                className="px-3 py-1.5 text-sm bg-brand hover:bg-brand-hover text-on-brand rounded-md transition-colors"
              >
                🧹 Aggressive Clean (7d)
              </button>

              <button
                onClick={handleClearAll}
                className="px-3 py-1.5 text-sm bg-red-600 hover:bg-red-700 text-white rounded-md transition-colors ml-auto"
              >
                ⚠️ Clear All
              </button>
            </div>

            <div className="mt-3 text-xs text-gray-500 dark:text-gray-400">
              <p>• Clean Old Data: Removes items older than specified period</p>
              <p>• Aggressive Clean: More aggressive cleanup (7 days)</p>
              <p>• Clear All: Deletes ALL localStorage data (use with caution!)</p>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/**
 * Standalone Storage Health Indicator
 *
 * Simple component to show storage health status
 */
export function StorageHealthIndicator() {
  const [percentage, setPercentage] = useState(0);
  const [isWarning, setIsWarning] = useState(false);

  useEffect(() => {
    const checkHealth = () => {
      try {
        const stats = StorageManager.getStorageStats();
        setPercentage(stats.percentage);
        setIsWarning(stats.isWarning);
      } catch (error) {
        logger.error('[StorageHealthIndicator] Failed to check health:', error);
      }
    };

    checkHealth();
    const interval = setInterval(checkHealth, 30000); // Check every 30 seconds

    return () => clearInterval(interval);
  }, []);

  if (percentage < 50) {
    return null; // Don't show indicator when usage is low
  }

  return (
    <div
      className={`fixed bottom-4 right-4 px-3 py-2 rounded-lg shadow-lg text-sm font-medium ${
        percentage > 90
          ? 'bg-red-600 text-white'
          : percentage > 80
          ? 'bg-brand text-white'
          : 'bg-blue-600 text-white'
      }`}
    >
      Storage: {percentage.toFixed(0)}%
      {isWarning && ' ⚠️'}
    </div>
  );
}