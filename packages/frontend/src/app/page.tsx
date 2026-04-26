'use client';

/**
 * Public landing page for unauthenticated visitors. Authenticated users
 * are bounced to their role-appropriate dashboard (admin/staff/client).
 *
 * Goal: a clear "what is PPL App" hero with two CTAs:
 *   1. Book a free consultation → /consult
 *   2. Sign in (existing members) → /login
 *
 * Plus a short value-prop strip + the address/contact line. Keeps
 * existing-user UX (auto-redirect) untouched.
 */

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { useAuth } from '@/contexts/AuthContext';

export default function Home() {
  const { user, isLoading, isAuthenticated } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (isLoading) return;
    if (!isAuthenticated) return; // show landing
    // Authenticated → redirect to role dashboard
    switch (user?.role) {
      case 'ADMIN':
        router.replace('/admin');
        break;
      case 'STAFF':
        router.replace('/staff');
        break;
      case 'CLIENT':
        router.replace('/client');
        break;
      default:
        router.replace('/login');
    }
  }, [isLoading, isAuthenticated, user, router]);

  if (isLoading || isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-black">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 rounded-full bg-[#95c83c]/30 animate-pulse" />
          <p className="text-gray-400 text-sm">Loading…</p>
        </div>
      </div>
    );
  }

  return (
    <main className="min-h-screen bg-black text-white">
      <header className="border-b border-white/10">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Image
              src="/ppl-logo.webp"
              alt="PPL"
              width={40}
              height={40}
              className="rounded-full"
              unoptimized
              priority
            />
            <div>
              <p className="text-[10px] uppercase tracking-[3px] text-[#95c83c] font-bold leading-none">
                Pitching
              </p>
              <p className="text-[10px] uppercase tracking-[3px] text-[#95c83c] font-bold leading-none mt-0.5">
                Performance Lab
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Link href="/login" className="text-sm text-gray-300 hover:text-white">
              Sign in
            </Link>
            <Link
              href="/consult"
              className="hidden sm:inline-block px-4 py-2 rounded-lg bg-[#95c83c] text-black font-bold text-sm"
            >
              Book a Consult
            </Link>
          </div>
        </div>
      </header>

      <section className="max-w-4xl mx-auto px-6 pt-24 pb-16 text-center">
        <p className="text-[11px] uppercase tracking-[3px] text-[#95c83c] font-bold mb-4">
          Pitching Performance Lab
        </p>
        <h1 className="text-4xl sm:text-6xl font-bold leading-[1.05] mb-5">
          Train like a pro. Pitch like one too.
        </h1>
        <p className="text-base sm:text-lg text-gray-400 max-w-2xl mx-auto mb-10">
          Data-driven pitching development for athletes from middle school through MiLB.
          Locations in Lexington and Louisville.
        </p>
        <div className="flex items-center justify-center gap-3 flex-wrap">
          <Link
            href="/consult"
            className="px-6 py-3 rounded-lg bg-[#95c83c] text-black font-bold text-sm hover:bg-[#a8d65c] transition"
          >
            Book a Free 15-min Consult
          </Link>
          <Link
            href="/register"
            className="px-6 py-3 rounded-lg border border-white/20 text-white font-semibold text-sm hover:bg-white/5 transition"
          >
            Create an Account
          </Link>
        </div>
      </section>

      <section className="border-t border-white/10 bg-[#0a0a0a]">
        <div className="max-w-5xl mx-auto px-6 py-16 grid grid-cols-1 md:grid-cols-3 gap-6">
          <Tile
            title="Trackman + video"
            body="Every session is measured. Velo, spin, command, mechanics — all tracked over time so you see what's actually changing."
          />
          <Tile
            title="Coaches who've been there"
            body="Our staff has D1, MiLB, and pro pedigrees. They've thrown the bullpens you're throwing — and the ones you want to throw."
          />
          <Tile
            title="Built around your schedule"
            body="Self-serve booking, easy reschedules, cancel up to 4 hours out. We make it easy to be consistent."
          />
        </div>
      </section>

      <section className="border-t border-white/10">
        <div className="max-w-5xl mx-auto px-6 py-16 grid grid-cols-1 sm:grid-cols-2 gap-6">
          <LocationCard name="PPL Lexington" address="Lexington, KY" />
          <LocationCard name="PPL Louisville" address="Louisville, KY" />
        </div>
      </section>

      <section className="border-t border-white/10 bg-[#0a0a0a]">
        <div className="max-w-3xl mx-auto px-6 py-16 text-center">
          <h2 className="text-3xl font-bold mb-4">Ready to get started?</h2>
          <p className="text-gray-400 mb-8">
            Book a free 15-minute call. We'll talk about your athlete, what they want to work on, and
            whether PPL is the right fit. Zero pressure.
          </p>
          <Link
            href="/consult"
            className="inline-block px-8 py-3 rounded-lg bg-[#95c83c] text-black font-bold text-sm hover:bg-[#a8d65c] transition"
          >
            Book a Free Consult
          </Link>
        </div>
      </section>

      <footer className="border-t border-white/10">
        <div className="max-w-5xl mx-auto px-6 py-6 text-center text-xs text-gray-500">
          <p>© Pitching Performance Lab</p>
          <p className="mt-1">
            <a href="mailto:support@pitchingperformancelab.com" className="hover:text-[#95c83c]">
              support@pitchingperformancelab.com
            </a>
          </p>
        </div>
      </footer>
    </main>
  );
}

function Tile({ title, body }: { title: string; body: string }) {
  return (
    <div className="text-center">
      <div className="w-1 h-6 bg-[#95c83c] mx-auto mb-3" />
      <h3 className="text-base font-bold mb-2">{title}</h3>
      <p className="text-sm text-gray-400 leading-relaxed">{body}</p>
    </div>
  );
}

function LocationCard({ name, address }: { name: string; address: string }) {
  return (
    <div className="border border-white/10 rounded-lg p-6 hover:border-[#95c83c]/40 transition">
      <p className="text-[10px] uppercase tracking-[2px] text-[#95c83c] font-bold mb-2">Location</p>
      <h3 className="text-xl font-bold mb-1">{name}</h3>
      <p className="text-sm text-gray-400">{address}</p>
    </div>
  );
}
