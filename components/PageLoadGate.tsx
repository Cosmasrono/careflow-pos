"use client";

import { Spinner } from "./ui";
import { BrandLogo } from "./BrandLogo";

/** Full-screen branded overlay shown while a route navigation is pending.
 *  Rendered by AppShell during the `useTransition` around router.push, so it
 *  appears only for as long as the next page actually takes to load. */
export function RouteLoadingOverlay() {
  return (
    <div className="fixed inset-0 z-90 grid place-items-center bg-linear-to-br from-teal-950 via-teal-900 to-teal-800 p-6 text-white">
      <div className="w-full max-w-sm rounded-2xl border border-white/15 bg-white/10 p-6 shadow-2xl backdrop-blur-sm">
        <div className="flex items-center gap-3">
          <BrandLogo size="lg" />
          <div>
            <p className="font-display text-lg font-semibold">CareFlow</p>
            <p className="text-xs text-teal-100/80">
              Preparing your workspace...
            </p>
          </div>
        </div>
        <p className="mt-5 flex items-center gap-2 text-xs text-teal-100/80">
          <Spinner className="size-4 text-teal-100" /> Loading…
        </p>
      </div>
    </div>
  );
}
