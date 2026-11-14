/**
 * /en/live - Live Streams Browse Page
 * Task 1.6: /en/live Page with Grid Layout and Filters
 *
 * Main browse page for live streams featuring:
 * - Responsive grid layout (1-4 columns)
 * - Tab navigation (Live, Scheduled, Past)
 * - Filter by category
 * - Infinite scroll pagination
 * - Real-time viewer count updates
 * - SEO optimized with metadata
 */

import { Metadata } from 'next';
import { listPageMetadata } from '@/lib/seo/structured-data';
import { LivePageClient } from './LivePageClient';

// Self-canonical with the en/ar pair and x-default (D-SEO-1); og:url on this site (wiki AUN-SEO #13)
export const metadata: Metadata = listPageMetadata('en', '/live', 'Live Streams', "Watch live streams from channels in the Al Ummah Now community, and see what's coming up.");

/**
 * Live Streams Page (Server Component)
 *
 * This is the server component that handles metadata and delegates
 * the interactive functionality to the client component.
 */
export default function LivePage() {
  return <LivePageClient />;
}
