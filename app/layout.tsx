import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: process.env.STUDIO_NAME || 'Cyberline Studio',
  description: 'Private video and image studio',
  robots: { index: false, follow: false },
  icons: { icon: '/icon.svg' },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#E7E9EC',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Instrument+Sans:ital,wdth,wght@0,75..100,400..700;1,75..100,400..700&display=swap"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
