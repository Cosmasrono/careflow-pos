"use client";

import { useEffect, useState, type ReactNode } from "react";

const PAGE_LOADER_MS = 4000;

export function PageLoadGate({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setReady(true), PAGE_LOADER_MS);
    return () => clearTimeout(timer);
  }, []);

  if (ready) return <>{children}</>;

  return (
    <div className="fixed inset-0 z-90 grid place-items-center bg-linear-to-br from-teal-950 via-teal-900 to-teal-800 p-6 text-white">
      <div className="w-full max-w-sm rounded-2xl border border-white/15 bg-white/10 p-6 shadow-2xl backdrop-blur-sm">
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-linear-to-br from-teal-400 to-teal-600 text-lg text-white shadow-inner shadow-white/20">
            ✚
          </span>
          <div>
            <p className="font-display text-lg font-semibold">CareFlow</p>
            <p className="text-xs text-teal-100/80">Preparing your workspace...</p>
          </div>
        </div>
        <div className="mt-5 h-2 w-full overflow-hidden rounded-full bg-white/20">
          <div className="h-full w-full origin-left animate-pulse rounded-full bg-teal-200" />
        </div>
        <p className="mt-3 text-xs text-teal-100/80">Loading for 4 seconds</p>
      </div>
    </div>
  );
}
