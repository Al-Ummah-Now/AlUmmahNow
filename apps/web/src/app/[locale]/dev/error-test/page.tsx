/**
 * Test-only trigger for the release E2E (e2e/release/errors.spec.ts): makes a
 * controlled client error or server 500 so the suite can check the friendly
 * screen and the admin Errors page. QA, stage, preview and development only:
 * production answers 404 (NEXTJS_ENV is a Worker var, read per request).
 * Events from this page are marked test (no alert mail, deleted after a day).
 */
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ClientCrash } from './ClientCrash';
import { errorTestAllowed } from './guard';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Error test', robots: { index: false, follow: false } };

export default async function ErrorTestPage({ searchParams }: { searchParams: Promise<{ mode?: string; run?: string }> }) {
  if (!errorTestAllowed(process.env.NEXTJS_ENV || (process.env.NODE_ENV === 'development' ? 'development' : undefined))) notFound();
  const { mode, run } = await searchParams;
  const marker = (run ?? '').replace(/[^\w-]/g, '').slice(0, 40) || 'manual';
  if (mode === 'server') {
    throw new Error(`Release error test (server render) ${marker}`);
  }
  if (mode === 'client') return <ClientCrash marker={marker} />;
  return (
    <main className="mx-auto max-w-lg p-8 text-card-foreground">
      <h1 className="text-xl font-bold">Error test</h1>
      <ul className="mt-4 list-disc ps-6">
        <li><a className="underline" href="?mode=client">Client error</a></li>
        <li><a className="underline" href="?mode=server">Server error</a></li>
      </ul>
    </main>
  );
}
