'use client';

import { useEffect, useRef, useState } from 'react';

const CHECK_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api';

// Polls two independent version markers - the frontend build id written by
// scripts/write-build-version.js (postbuild) and the backend's process
// start time (GET /api/version, set once at boot in main.ts) - either one
// changing means a deploy happened (frontend rebuild or backend restart)
// while this tab was open. Rather than silently running stale JS against a
// newly-deployed API (or an old API assumption against a new backend),
// prompt the user to reload. Frontend check no-ops harmlessly in dev (the
// file only exists after a production build); the backend check runs
// either way since /api/version is always available.
export function UpdateAvailableBanner() {
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const initialFrontendVersion = useRef<string | null>(null);
  const initialBackendVersion = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function checkFrontendVersion() {
      // build-version.txt only exists after a production build (see
      // postbuild) - skip entirely in dev so this doesn't poll a 404 every
      // interval for the whole session.
      if (process.env.NODE_ENV !== 'production') return;
      try {
        const res = await fetch('/build-version.txt', { cache: 'no-store' });
        if (!res.ok || cancelled) return;
        const version = (await res.text()).trim();
        if (cancelled || !version) return;
        if (initialFrontendVersion.current === null) {
          initialFrontendVersion.current = version;
          return;
        }
        if (version !== initialFrontendVersion.current) setUpdateAvailable(true);
      } catch {
        // Network hiccup - just try again on the next interval.
      }
    }

    async function checkBackendVersion() {
      try {
        const res = await fetch(`${API_BASE_URL}/version`, { cache: 'no-store' });
        if (!res.ok || cancelled) return;
        const { startedAt } = (await res.json()) as { startedAt?: string };
        if (cancelled || !startedAt) return;
        if (initialBackendVersion.current === null) {
          initialBackendVersion.current = startedAt;
          return;
        }
        if (startedAt !== initialBackendVersion.current) setUpdateAvailable(true);
      } catch {
        // Network hiccup - just try again on the next interval.
      }
    }

    function checkVersion() {
      checkFrontendVersion();
      checkBackendVersion();
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
