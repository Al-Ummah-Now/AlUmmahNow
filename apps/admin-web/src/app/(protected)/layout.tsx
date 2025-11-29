import { requireAdminRole } from '@/lib/auth';
import { AdminNav } from '@/components/AdminNav';

export default async function ProtectedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Verify authentication and admin role (redirects if not authorized)
  const session = await requireAdminRole();

  return (
    <>
      <AdminNav userEmail={session.user.email} />
      <main className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-8">
        {children}
      </main>
    </>
  );
}
