import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Progrid: the developer cloud for Saudi Arabia, built for people and AI agents',
  description: 'Get a server in 60 seconds. Hourly billing in riyals with ZATCA e-invoices, one click apps, and API tokens your AI agents can use safely.',
  icons: { icon: [{ url: '/favicon.svg', type: 'image/svg+xml' }, { url: '/favicon-64.png', sizes: '64x64', type: 'image/png' }], apple: '/apple-touch-icon.png' },
  openGraph: { title: 'Progrid', description: 'The developer cloud for Saudi Arabia, built for people and AI agents.', type: 'website', images: [{ url: '/og-image.png', width: 1200, height: 630, alt: 'Progrid Cloud' }] },
  twitter: { card: 'summary_large_image', images: ['/og-image.png'] },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Arabic:wght@400;500;600;700&display=swap" rel="stylesheet" />
      </head>
      <body>{children}</body>
    </html>
  );
}
