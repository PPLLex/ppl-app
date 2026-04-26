'use client';

/**
 * Top page-load progress bar (#140 — premium-feel polish).
 *
 * A thin gradient bar that animates across the top of the viewport
 * during route transitions. Inspired by NProgress + Vercel + Linear.
 *
 * Why hand-rolled instead of nprogress: zero npm cost, matches our
 * gradient theme exactly, and ties into Next 16's router events.
 *
 * Behavior:
 *  - Shows on link click / pushState
 *  - Fast animation to 80% as soon as nav starts
 *  - Pauses at 80% while data fetches
 *  - Snaps to 100% + fades when the new route's content renders
 */

import { useEffect, useState } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';

export function RouteProgress() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [progress, setProgress] = useState(0);
  const [visible, setVisible] = useState(false);

  // Whenever pathname OR searchParams change, the route just finished
  // committing. Snap the bar to 100 then fade.
  useEffect(() => {
    if (!visible) return;
    setProgress(100);
    const t = setTimeout(() => {
      setVisible(false);
      setProgress(0);
    }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, searchParams?.toString()]);

  // Listen for in-flight navigations by intercepting clicks on internal
  // anchors. Next.js doesn't expose router events in app-router, so this
  // is the cleanest way to detect "user just clicked a link."
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const anchor = target.closest('a') as HTMLAnchorElement | null;
      if (!anchor) return;
      // Skip external links, downloads, and modifier-clicks
      if (anchor.target === '_blank' || anchor.hasAttribute('download')) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const href = anchor.getAttribute('href');
      if (!href || href.startsWith('http') || href.startsWith('#')) return;
      // Ignore same-route clicks
      if (href === window.location.pathname + window.location.search) return;

      setVisible(true);
      setProgress(15);
      // Quickly ramp toward 80% while the route loads
      let p = 15;
      const id = setInterval(() => {
        p += Math.random() * 12;
        if (p >= 80) {
          p = 80;
          clearInterval(id);
        }
        setProgress(p);
      }, 120);
      // Auto-clear in case the navigation never completes (e.g. _blank)
      setTimeout(() => clearInterval(id), 4000);
    };
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, []);

  if (!visible) return null;

  return (
    <div
      aria-hidden
      className="fixed top-0 left-0 right-0 z-[60] h-[3px] pointer-events-none"
    >
      <div
        className="h-full bg-gradient-to-r from-[#5E9E50] via-[#95C83C] to-[#5E9E50] shadow-[0_0_8px_rgba(149,200,60,0.6)] transition-all duration-200 ease-out"
        style={{
          width: `${progress}%`,
          opacity: progress >= 100 ? 0 : 1,
          transitionDuration: progress >= 100 ? '250ms' : '200ms',
        }}
      />
    </div>
  );
}
