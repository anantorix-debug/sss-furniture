import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: 'PCD',
};

export default function ProductionControlLayout({ children }: { children: ReactNode }) {
  return children;
}
