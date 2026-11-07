import NotFoundPage from '@/components/NotFoundPage';

/**
 * Unmatched URLs (e.g. /en/does-not-exist, /ar/does-not-exist) land here with
 * a real 404 status. The page is localized from the URL, so Arabic paths get
 * the Arabic RTL version instead of a hard-coded English page.
 */
export default function NotFound() {
  return <NotFoundPage />;
}
