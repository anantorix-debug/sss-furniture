'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

// Merged into Production Control (Dispatch Pipeline + Ready for
// Verification are now tabs there) - this route just forwards anyone who
// still has the old link bookmarked.
export default function ProductionRedirectPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/production-control');
  }, [router]);
  return null;
}
