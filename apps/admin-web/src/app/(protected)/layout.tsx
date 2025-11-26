import { redirect } from 'next/navigation';
import { getAdminSession } from '@/lib/auth';
import { AdminNav } from '@/components/AdminNav';

export default async function ProtectedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getAdminSession();

  if (!session) {
    redirect('/login');
  }

  return (
    <>
      <AdminNav userEmail={session.user.email} />
      <main className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-8">
        {children}
      </main>
    </>
  );
}
