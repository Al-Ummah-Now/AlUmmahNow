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
import { LivePageClient } from './LivePageClient';

export const metadata: Metadata = {
  title: 'Live Streams | Al Ummah Now',
  description: 'Watch live Islamic lectures, discussions, and educational content. Join thousands of viewers learning from scholars around the world.',
  keywords: ['live streams', 'Islamic lectures', 'scholars', 'live events', 'Al Ummah Now'],
  openGraph: {
    title: 'Live Streams | Al Ummah Now',
    description: 'Watch live Islamic lectures, discussions, and educational content.',
    type: 'website',
    url: 'https://alummahnow.com/en/live',
    images: [
      {
        url: '/favicon-32x32.png',
        width: 32,
        height: 32,
        alt: 'Al Ummah Now',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Live Streams | Al Ummah Now',
    description: 'Watch live Islamic lectures, discussions, and educational content.',
    images: ['/favicon-32x32.png'],
  },
  robots: {
    index: true,
    follow: true,
  },
};

/**
 * Live Streams Page (Server Component)
 *
 * This is the server component that handles metadata and delegates
 * the interactive functionality to the client component.
 */
export default function LivePage() {
  return <LivePageClient />;
}
