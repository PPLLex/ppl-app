'use client';

import { useState, useRef } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useRouter, usePathname } from 'next/navigation';
import { useEffect } from 'react';
import Sidebar from '@/components/layout/Sidebar';
import NotificationBell from '@/components/layout/NotificationBell';
import PushNotificationPrompt from '@/components/notifications/PushNotificationPrompt';

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, isLoading, isAuthenticated } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  // Scroll-linked header treatment — the top bar gains a shadow + frosted
  // backdrop blur once the user scrolls more than a few pixels. Gives
  // every page a subtle "I'm a real app, not a document" depth cue.
  // Apple, Stripe, Linear all do this. 10px threshold prevents flicker
  // from rubber-band scroll on iOS.
  const [scrolled, setScrolled] = useState(false);
  const mainRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = mainRef.current;
    if (!el) return;
    const onScroll = () => setScrolled(el.scrollTop > 10);
    el.addEventListener('scroll', onScroll, { passive: true });
    // Initialize in case the page loads already-scrolled (deep-link case).
    onScroll();
    return () => el.removeEventListener('scroll', onScroll);
  }, [user]);

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.push('/login');
      return;
    }

    // Role-based URL enforcement.
    //
    // CLIENT accounts can only browse /client/* (plus the shared /profile).
    // Trying to navigate to /admin/... or /staff/... silently bounced to a
    // page shell full of 403 errors — better to redirect them home.
    //
    // ADMIN and STAFF are allowed to roam: admins sometimes want to view
    // the client-side experience for support, and staff use /admin/checkin
    // as a shared kiosk route. The sidebar already shows the nav matching
    // their actual role regardless of URL.
    if (!isLoading && user) {
      const goesToAdmin = pathname?.startsWith('/admin') ?? false;
      const goesToStaff = pathname?.startsWith('/staff') ?? false;
      if (user.role === 'CLIENT' && (goesToAdmin || goesToStaff)) {
        router.replace('/client');
        return;
      }
      if (user.role === 'STAFF' && goesToAdmin) {
        // Allow STAFF into /admin/checkin (kiosk) but nothing else.
        if (!pathname?.startsWith('/admin/checkin')) {
          router.replace('/staff');
          return;
        }
      }
    }
  }, [isLoading, isAuthenticated, user, pathname, router]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 rounded-full ppl-gradient animate-pulse" />
          <p className="text-muted text-sm">Loading...</p>
        </div>
      </div>
    );
  }

  if (!user) return null;

  return (
    <div className="min-h-screen flex">
      <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <main ref={mainRef} className="flex-1 overflow-auto flex flex-col min-w-0">
        {/* Top Bar — sticky so scroll-shadow is visible on top of content.
            When scrolled > 10px we apply a backdrop blur + shadow for the
            "floating header" effect that Apple/Stripe/Linear use. */}
        <div
          className={`sticky top-0 z-20 h-14 border-b border-border flex items-center justify-between px-4 sm:px-6 flex-shrink-0 transition-[background,backdrop-filter,box-shadow] duration-200 ${
            scrolled
              ? 'bg-background/75 backdrop-blur-md shadow-[0_4px_20px_-8px_rgba(0,0,0,0.6)]'
              : 'bg-background'
          }`}>
          {/* Mobile hamburger */}
          <button
            onClick={() => setSidebarOpen(true)}
            className="lg:hidden p-2 -ml-2 text-muted hover:text-foreground"
            aria-label="Open menu"
          >
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
            </svg>
          </button>

          {/* Mobile brand (shown when sidebar is hidden) */}
          <div className="lg:hidden flex items-center gap-2">
            <div className="w-7 h-7 rounded-full ppl-gradient flex items-center justify-center">
              <span className="text-white text-xs font-bold">P</span>
            </div>
            <span className="text-sm font-bold text-foreground">PPL</span>
          </div>

          {/* Desktop spacer */}
          <div className="hidden lg:block" />

          <NotificationBell />
        </div>

        {/* Page content — `ppl-page-root` gives the View Transitions API a
            named element to crossfade when the route changes. The key forces
            React to recompute the subtree per pathname so transitions have
            distinct old/new views to animate between. */}
        <div
          className="flex-1 p-4 sm:p-6 max-w-7xl mx-auto w-full ppl-page-root"
          key={pathname}
        >
          {children}
        </div>
      </main>

      {/* Push notification opt-in prompt */}
      <PushNotificationPrompt />
    </div>
  );
}
