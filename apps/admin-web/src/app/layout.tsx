import type { Metadata } from 'next';
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
        {children}
      </body>
    </html>
  );
}
