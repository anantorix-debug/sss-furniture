import type { Metadata } from 'next';
import { Roboto } from 'next/font/google';
import './globals.css';
import { AuthProvider } from '@/context/AuthContext';
import { UpdateAvailableBanner } from '@/components/UpdateAvailableBanner';

const roboto = Roboto({
  subsets: ['latin'],
  weight: ['400', '500', '700'],
  variable: '--font-roboto',
});

export const metadata: Metadata = {
  title: 'SSS Company - Order & Ledger Management',
  description: 'Customer orders, party orders, supplier ledgers, and carpenter work tracking for SSS Company.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={roboto.variable}>
      <body className="min-h-screen antialiased font-sans">
        <AuthProvider>{children}</AuthProvider>
        <UpdateAvailableBanner />
      </body>
    </html>
  );
}
