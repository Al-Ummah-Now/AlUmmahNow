/**
 * /ar/live - Live Streams Browse Page (Arabic/RTL)
 * Task 1.7: /ar/live Page with RTL Layout
 *
 * Arabic/RTL version of the live streams browse page featuring:
 * - Right-to-left layout
 * - Arabic text and translations
 * - Responsive grid layout (1-4 columns)
 * - Tab navigation (مباشر، المجدول، السابق)
 * - Filter by category
 * - Real-time viewer count updates with Arabic numerals
 * - SEO optimized with Arabic metadata
 */

import { Metadata } from 'next';
import { LivePageClientRTL } from './LivePageClientRTL';

export const metadata: Metadata = {
  title: 'البث المباشر | الأمة الآن',
  description: 'شاهد البث المباشر من قنوات مجتمع الأمة الآن، واطّلع على البث القادم.',
  keywords: ['البث المباشر', 'مباشر', 'إسلامي', 'قنوات', 'الأمة الآن'],
  openGraph: {
    title: 'البث المباشر | الأمة الآن',
    description: 'شاهد البث المباشر من قنوات مجتمع الأمة الآن، واطّلع على البث القادم.',
    type: 'website',
    url: 'https://alummahnow.com/ar/live',
    locale: 'ar_SA',
    images: [
      {
        url: '/favicon-32x32.png',
        width: 32,
        height: 32,
        alt: 'الأمة الآن',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'البث المباشر | الأمة الآن',
    description: 'شاهد البث المباشر من قنوات مجتمع الأمة الآن، واطّلع على البث القادم.',
    images: ['/favicon-32x32.png'],
  },
  robots: {
    index: true,
    follow: true,
  },
};

/**
 * Live Streams Page (Server Component - RTL)
 *
 * This is the server component that handles Arabic metadata and delegates
 * the interactive functionality to the RTL client component.
 */
export default function LivePageAR() {
  return <LivePageClientRTL />;
}
