import type { Metadata } from 'next';
import { headers } from 'next/headers';
import './globals.css';
import { Shell } from '@/components/shell';

export const metadata: Metadata = {
  title: 'Progrid console',
  icons: { icon: [{ url: '/favicon.svg', type: 'image/svg+xml' }, { url: '/favicon-64.png', sizes: '64x64', type: 'image/png' }], apple: '/apple-touch-icon.png' },
  description: 'The developer cloud for people and AI agents',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Reading the request headers renders every page per request, so Next.js can put the CSP nonce
  // (middleware.ts) on its scripts.
  await headers();
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Arabic:wght@400;500;600;700&display=swap" rel="stylesheet" />
      </head>
      <body>
        <Shell>{children}</Shell>
      </body>
    </html>
  );
}
