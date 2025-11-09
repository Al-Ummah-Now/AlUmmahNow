/**
 * ViewerCount Component Usage Examples
 * Task 1.2: ViewerCount Component
 *
 * This file demonstrates various use cases for the ViewerCount component.
 * Copy these examples into your components as needed.
 */

import { ViewerCount } from './index';
import { ViewerCountRTL } from './rtl';

/**
 * Example 1: Basic Usage
 * Simple viewer count display
 */
export function BasicViewerCount() {
  return <ViewerCount count={1234} />;
}

/**
 * Example 2: Live Stream
 * With live indicator styling
 */
export function LiveViewerCount() {
  return <ViewerCount count={5678} isLive />;
}

/**
 * Example 3: With Label
 * Shows "watching" label on desktop
 */
export function ViewerCountWithLabel() {
  return <ViewerCount count={10234} isLive showLabel />;
}

/**
 * Example 4: Full Format
 * Display complete number with separators
 */
export function FullFormatViewerCount() {
  return <ViewerCount count={1500000} format="full" isLive />;
}

/**
 * Example 5: Loading State
 * Shows placeholder while loading
 */
export function LoadingViewerCount() {
  return <ViewerCount count={0} isLoading />;
}

/**
 * Example 6: With Click Handler
 * Refresh viewer count on click
 */
export function ClickableViewerCount() {
  const handleRefresh = () => {
    console.log('Refreshing viewer count...');
    // Call API or WebSocket to get latest count
  };

  return (
    <ViewerCount
      count={8765}
      isLive
      onClick={handleRefresh}
      className="cursor-pointer hover:opacity-80"
    />
  );
}

/**
 * Example 7: RTL Variant
 * Arabic version with Eastern Arabic numerals
 */
export function ArabicViewerCount() {
  return <ViewerCountRTL count={1234} isLive showLabel />;
}

/**
 * Example 8: Integration with LiveStreamCard
 * Complete card layout with status and viewer count
 */
export function LiveStreamCardExample() {
  const stream = {
    status: 'live' as const,
    viewerCount: 12345,
  };

  return (
    <div className="flex items-center gap-2">
      {/* Status badge would go here */}
      {stream.status === 'live' && (
        <ViewerCount count={stream.viewerCount} isLive showLabel />
      )}
    </div>
  );
}

/**
 * Example 9: With Real-time Updates
 * WebSocket integration for live updates
 */
export function RealtimeViewerCount({ streamId: _streamId }: { streamId: string }) {
  // const [viewerCount, setViewerCount] = useState(0);
  // const [isLoading, setIsLoading] = useState(true);
  //
  // useEffect(() => {
  //   const ws = new WebSocket(`wss://ws.alummahnow.net`);
  //
  //   ws.onopen = () => {
  //     ws.send(JSON.stringify({
  //       type: 'subscribe',
  //       channel: `video:${streamId}`,
  //     }));
  //   };
  //
  //   ws.onmessage = (event) => {
  //     const data = JSON.parse(event.data);
  //     if (data.type === 'viewer-count') {
  //       setViewerCount(data.count);
  //       setIsLoading(false);
  //     }
  //   };
  //
  //   return () => ws.close();
  // }, [streamId]);

  // For now, just show static example
  return <ViewerCount count={3456} isLive isLoading={false} />;
}

/**
 * Example 10: Responsive Variants
 * Different displays for mobile/tablet/desktop
 */
export function ResponsiveViewerCount() {
  return (
    <div className="space-y-4">
      {/* Mobile: Compact format only */}
      <div className="sm:hidden">
        <ViewerCount count={1234} isLive format="compact" />
      </div>

      {/* Tablet: Full format */}
      <div className="hidden sm:block lg:hidden">
        <ViewerCount count={1234} isLive format="full" />
      </div>

      {/* Desktop: Full format with label */}
      <div className="hidden lg:block">
        <ViewerCount count={1234} isLive format="full" showLabel />
      </div>
    </div>
  );
}

/**
 * Example 11: Zero Viewers
 * Graceful handling of no viewers
 */
export function ZeroViewers() {
  return <ViewerCount count={0} />;
}

/**
 * Example 12: Large Numbers
 * Formatting millions/billions
 */
export function LargeViewerCount() {
  return (
    <div className="space-y-2">
      <ViewerCount count={1500000} isLive showLabel /> {/* 1.5M */}
      <ViewerCount count={2340000000} isLive showLabel /> {/* 2.3B */}
    </div>
  );
}
