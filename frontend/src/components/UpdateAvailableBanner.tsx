'use client';

import { useEffect, useRef, useState } from 'react';

const CHECK_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

// Polls the build id written by scripts/write-build-version.js (see
// package.json's postbuild) - if it ever differs from the version this tab
// first loaded, a new deploy has happened while the tab was open. Rather
// than silently running stale JS against a newly-deployed API, prompt the
// user to reload. No-ops harmlessly in dev (the file only exists after a
// production build).
export function UpdateAvailableBanner() {
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const initialVersion = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function checkVersion() {
      try {
        const res = await fetch('/build-version.txt', { cache: 'no-store' });
        if (!res.ok || cancelled) return;
        const version = (await res.text()).trim();
        if (cancelled || !version) return;
        if (initialVersion.current === null) {
          initialVersion.current = version;
          return;
        }
        if (version !== initialVersion.current) setUpdateAvailable(true);
      } catch {
        // Network hiccup - just try again on the next interval.
      }
    }

    checkVersion();
    const interval = setInterval(checkVersion, CHECK_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  if (!updateAvailable) return null;

  return (
    <div className="fixed bottom-4 right-4 z-[100] bg-brand-900 text-white rounded-lg shadow-lg px-4 py-3 flex items-center gap-3 text-sm max-w-[calc(100vw-2rem)]">
      <span>A new version of this site is available.</span>
      <button
        className="bg-white text-brand-900 rounded-md px-3 py-1.5 text-xs font-medium hover:bg-brand-50 shrink-0"
        onClick={() => window.location.reload()}
      >
        Reload
      </button>
    </div>
  );
}
