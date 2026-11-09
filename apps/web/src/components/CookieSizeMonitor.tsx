/**
 * Cookie Size Monitor Component
 *
 * Displays session cookie size information for debugging.
 * Only visible in development mode.
 */

'use client';

import { useState, useEffect } from 'react';
import { getSessionCookieSize } from '@/lib/actions/multi-account';

export function CookieSizeMonitor() {
  const [sizeInfo, setSizeInfo] = useState<{
    sizeBytes: number;
    sizeKB: string;
    usagePercent: string;
    accountCount: number;
    isNearLimit: boolean;
    isOverLimit: boolean;
    breakdown?: Record<string, string>;
  } | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    // Only show in development
    if (process.env.NODE_ENV !== 'development') return;

    const loadSizeInfo = async () => {
      const info = await getSessionCookieSize();
      setSizeInfo(info);
      setIsVisible(!!info);
    };

    // Load once on mount
    loadSizeInfo();

    // Listen for custom events that indicate session changes
    const handleSessionChange = () => {
      loadSizeInfo();
    };

    // Listen for storage events (when session changes in another tab)
    window.addEventListener('storage', handleSessionChange);
    // Listen for custom session update events
    window.addEventListener('session-updated', handleSessionChange);

    return () => {
      window.removeEventListener('storage', handleSessionChange);
      window.removeEventListener('session-updated', handleSessionChange);
    };
  }, []);

  if (!isVisible || !sizeInfo) return null;

  const statusColor = sizeInfo.isOverLimit
    ? 'bg-red-500'
    : sizeInfo.isNearLimit
    ? 'bg-brand'
    : 'bg-green-500';

  const statusIcon = sizeInfo.isOverLimit
    ? '🚨'
    : sizeInfo.isNearLimit
    ? '⚠️'
    : '✓';

  return (
    <div className="fixed bottom-4 right-4 z-50 max-w-sm">
      {/* Compact view */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className={`flex items-center gap-2 px-3 py-2 rounded-lg shadow-lg text-white text-xs font-mono ${
          sizeInfo.isOverLimit
            ? 'bg-red-600 hover:bg-red-700'
            : sizeInfo.isNearLimit
            ? 'bg-brand hover:bg-brand-hover'
            : 'bg-gray-800 hover:bg-gray-700'
        }`}
      >
        <span className={`inline-block w-2 h-2 rounded-full ${statusColor}`} />
        <span>
          {statusIcon} Cookie: {sizeInfo.sizeKB} KB ({sizeInfo.usagePercent}%)
        </span>
        <span className="text-gray-300">
          {isExpanded ? '▼' : '▶'}
        </span>
      </button>

      {/* Expanded view */}
      {isExpanded && (
        <div className="mt-2 p-4 bg-gray-900 text-white rounded-lg shadow-xl text-xs font-mono">
          <h3 className="font-bold mb-2 text-sm">Session Cookie Size</h3>

          <div className="space-y-1 mb-3">
            <div className="flex justify-between">
              <span className="text-gray-400">Size:</span>
              <span className="font-semibold">{sizeInfo.sizeKB} KB</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400">Usage:</span>
              <span className={sizeInfo.isNearLimit ? 'text-brand-ink' : ''}>
                {sizeInfo.usagePercent}% of 4 KB
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400">Accounts:</span>
              <span>{sizeInfo.accountCount}</span>
            </div>
          </div>

          {/* Progress bar */}
          <div className="mb-3">
            <div className="w-full bg-gray-700 rounded-full h-2">
              <div
                className={`h-2 rounded-full transition-all ${
                  sizeInfo.isOverLimit
                    ? 'bg-red-500'
                    : sizeInfo.isNearLimit
                    ? 'bg-brand'
                    : 'bg-green-500'
                }`}
                style={{ width: `${Math.min(parseFloat(sizeInfo.usagePercent), 100)}%` }}
              />
            </div>
          </div>

          {/* Breakdown */}
          {sizeInfo.breakdown && (
            <details className="text-xs">
              <summary className="cursor-pointer text-gray-400 hover:text-white">
                Size Breakdown
              </summary>
              <div className="mt-2 space-y-1 pl-2">
                {Object.entries(sizeInfo.breakdown).map(([key, value]) => (
                  <div key={key} className="flex justify-between">
                    <span className="text-gray-500">{key}:</span>
                    <span className="text-gray-300">{value}</span>
                  </div>
                ))}
              </div>
            </details>
          )}

          {/* Warnings */}
          {sizeInfo.isNearLimit && (
            <div className="mt-3 p-2 bg-brand-soft border border-brand-edge rounded text-brand-ink">
              ⚠️ Approaching 4KB limit. Consider removing accounts.
            </div>
          )}
          {sizeInfo.isOverLimit && (
            <div className="mt-3 p-2 bg-red-900/50 border border-red-600 rounded text-red-200">
              🚨 EXCEEDED 4KB limit! Browser may reject cookie.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
