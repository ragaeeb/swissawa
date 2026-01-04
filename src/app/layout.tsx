import type { Metadata } from 'next';
import { Geist, Geist_Mono, IBM_Plex_Sans_Arabic } from 'next/font/google';
import { Footer } from '@/components/footer';
import './globals.css';

const geistSans = Geist({ subsets: ['latin'], variable: '--font-geist-sans' });
const geistMono = Geist_Mono({ subsets: ['latin'], variable: '--font-geist-mono' });
const ibmPlexArabic = IBM_Plex_Sans_Arabic({
    subsets: ['arabic'],
    variable: '--font-ibm-plex-arabic',
    weight: ['400', '500', '600', '700'],
});

export const metadata: Metadata = { description: 'OCR for PDF', title: 'Swissawa' };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
    return (
        <html lang="en">
            <body
                className={`${geistSans.variable} ${geistMono.variable} ${ibmPlexArabic.variable} flex min-h-screen flex-col antialiased`}
            >
                <main className="flex-1">{children}</main>
                <Footer />
            </body>
        </html>
    );
}
