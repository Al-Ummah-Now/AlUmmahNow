'use client';
// Prototype only: three placements of the upload action, chosen from the demo bar.
import Link from 'next/link';
import { useLanguage } from '@/hooks/useLanguage';

const Icon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 16V5" /><path d="M7 10l5-5 5 5" /><path d="M5 19h14" />
  </svg>
);

export function DemoUpload({ place }: { place: 'end' | 'start' }) {
  const { t, lang } = useLanguage();
  const href = `/${lang}/upload`;
  const label = t.upload.uploadVideo;
  if (place === 'start') {
    return <Link href={href} className="up-opt up-b"><Icon /><span className="up-label">{label}</span></Link>;
  }
  return (
    <>
      <Link href={href} className="up-opt up-a" data-testid="upload-a"><Icon /><span className="up-label-a">{label}</span></Link>
      <Link href={href} className="up-opt up-c"><Icon /><span className="up-label">{label}</span></Link>
    </>
  );
}
