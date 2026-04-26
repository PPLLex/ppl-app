import Link from 'next/link';

/**
 * Branded 404 page.
 *
 * Premium-feel touches:
 *  - Big PPL gradient orb behind a stadium-sized 404
 *  - Two clear next-step CTAs (home + book session) instead of a single
 *    dead-end "Go Home"
 *  - Friendly copy that doesn't blame the user
 */
export default function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center px-4 bg-[#0A0A0A] text-foreground relative overflow-hidden">
      {/* Soft gradient glow behind the content for depth */}
      <div
        aria-hidden
        className="absolute -top-40 left-1/2 -translate-x-1/2 w-[640px] h-[640px] rounded-full bg-gradient-to-br from-[#5E9E50]/30 via-[#95C83C]/10 to-transparent blur-3xl pointer-events-none"
      />

      <div className="relative text-center max-w-md">
        <p className="text-[140px] leading-none font-black bg-gradient-to-br from-[#5E9E50] to-[#95C83C] bg-clip-text text-transparent tracking-tight">
          404
        </p>
        <h1 className="text-2xl font-bold mt-4">That page took a foul ball.</h1>
        <p className="text-muted mt-2">
          The page you were after either doesn&apos;t exist or has moved. Let&apos;s
          get you back to training.
        </p>
        <div className="flex items-center justify-center gap-3 mt-8">
          <Link href="/" className="ppl-btn ppl-btn-primary">
            Go Home
          </Link>
          <Link href="/client/book" className="ppl-btn ppl-btn-secondary">
            Book a Session
          </Link>
        </div>
      </div>
    </div>
  );
}
