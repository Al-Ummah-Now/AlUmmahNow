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
import { listPageMetadata } from '@/lib/seo/structured-data';
import { LivePageClientRTL } from './LivePageClientRTL';

// Self-canonical with the en/ar pair and x-default (D-SEO-1); og:url on this site (wiki AUN-SEO #13)
export const metadata: Metadata = listPageMetadata('ar', '/live', 'البث المباشر', 'شاهد البث المباشر من قنوات مجتمع الأمة الآن، واطّلع على البث القادم.');

/**
 * Live Streams Page (Server Component - RTL)
 *
 * This is the server component that handles Arabic metadata and delegates
 * the interactive functionality to the RTL client component.
 */
export default function LivePageAR() {
  return <LivePageClientRTL />;
}
