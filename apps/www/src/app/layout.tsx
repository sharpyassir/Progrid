import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Progrid: the developer cloud for Saudi Arabia, built for people and AI agents',
  description: 'Get a server in 60 seconds. Hourly billing in dollars or riyals with ZATCA e-invoices, data that stays in Saudi Arabia, one click apps, and API tokens your AI agents can use safely.',
  openGraph: { title: 'Progrid', description: 'The developer cloud for Saudi Arabia, built for people and AI agents.', type: 'website' },
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
