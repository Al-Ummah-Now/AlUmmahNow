import type { Metadata } from 'next';
import { QueryProvider } from '@/providers/QueryProvider';
import './globals.css';

export const metadata: Metadata = {
  title: 'Al Ummah Now - Admin',
  description: 'Admin dashboard for Al Ummah Now platform',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-gray-900">
        <QueryProvider>
          {children}
        </QueryProvider>
      </body>
    </html>
  );
}
