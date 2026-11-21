import NotFoundPage from '@/components/NotFoundPage';
import { notFoundMetadata } from '@/lib/seo/not-found-metadata';

export const generateMetadata = notFoundMetadata;

export default function NotFound() {
  return <NotFoundPage />;
}
