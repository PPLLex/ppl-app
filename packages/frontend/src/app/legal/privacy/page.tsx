'use client';

/**
 * Privacy Policy — public route, no auth required.
 *
 * This is template copy derived from standard SaaS privacy practices for
 * a payment-processing app serving minors. Chad should review with a
 * lawyer before going live. Last-updated stamp auto-renders from the
 * constant below — bump when the content changes.
 */

import Link from 'next/link';

const LAST_UPDATED = 'April 23, 2026';

export default function PrivacyPolicyPage() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-12 sm:py-16">
        <Link href="/" className="text-sm text-muted hover:text-foreground">
          ← Home
        </Link>

        <h1 className="font-display text-3xl sm:text-4xl uppercase tracking-[0.04em] text-foreground mt-6">
          Privacy Policy
        </h1>
        <p className="text-xs text-muted mt-2 uppercase tracking-[0.12em]">
          Last updated: {LAST_UPDATED}
        </p>

        <div className="prose-ppl mt-8 space-y-6 text-foreground/90 leading-relaxed text-[15px]">
          <section>
            <h2 className="font-display uppercase tracking-[0.04em] text-foreground text-lg mb-2">
              1. Who we are
            </h2>
            <p>
              This Privacy Policy describes how Pitching Performance Lab (&ldquo;PPL,&rdquo;
              &ldquo;we,&rdquo; &ldquo;us&rdquo;) collects, uses, and protects information when you use the
              PPL web application at app.pitchingperformancelab.com. Contact us at{' '}
              <a
                href="mailto:support@pitchingperformancelab.com"
                className="text-accent-text hover:brightness-110 underline"
              >
                support@pitchingperformancelab.com
              </a>{' '}
              with any questions.
            </p>
          </section>

          <section>
            <h2 className="font-display uppercase tracking-[0.04em] text-foreground text-lg mb-2">
              2. Information we collect
            </h2>
            <p>
              <strong className="text-foreground">Account information.</strong> When you register we collect
              your name, email, phone number, password (hashed — we never see the plaintext), and
              the playing level of the athlete you&apos;re registering (youth, middle/high school,
              college, or pro).
            </p>
            <p>
              <strong className="text-foreground">Athlete information.</strong> If you register one or more
              athletes (your own kids or yourself), we collect each athlete&apos;s first and last
              name, date of birth, and optional contact info.
            </p>
            <p>
              <strong className="text-foreground">Payment information.</strong> Payments are processed by
              Stripe. We never store your full card number — Stripe holds that. We store only
              metadata (the last 4 digits, card brand, expiration, and a Stripe customer ID) so
              we can show you which card is on file and charge it on schedule.
            </p>
            <p>
              <strong className="text-foreground">Usage information.</strong> Bookings, session attendance,
              coach notes, and training program progress tied to each athlete&apos;s account.
            </p>
          </section>

          <section>
            <h2 className="font-display uppercase tracking-[0.04em] text-foreground text-lg mb-2">
              3. Minors (under 13)
            </h2>
            <p>
              PPL&apos;s Youth program serves athletes age 12 and under. These athletes do NOT have
              logins of their own — their parent or legal guardian creates and manages the account
              on their behalf. Parents are solely responsible for information submitted about their
              minor children. Consistent with COPPA, we do not knowingly collect information
              directly from children under 13, and we do not market to them through the app.
            </p>
          </section>

          <section>
            <h2 className="font-display uppercase tracking-[0.04em] text-foreground text-lg mb-2">
              4. How we use your information
            </h2>
            <p>We use the information we collect to:</p>
            <ul className="list-disc list-outside ml-6 space-y-1">
              <li>Run your account, authenticate you, and keep it secure.</li>
              <li>Process payments and send you receipts.</li>
              <li>Schedule sessions, deliver training programs, and share coach notes.</li>
              <li>Contact you about your account, scheduled sessions, and policy changes.</li>
              <li>Improve the app based on anonymous usage patterns.</li>
            </ul>
            <p>
              We do not sell your personal information. We do not show you advertising in the app,
              and we do not let third parties advertise to you through the app.
            </p>
          </section>

          <section>
            <h2 className="font-display uppercase tracking-[0.04em] text-foreground text-lg mb-2">
              5. Who we share it with
            </h2>
            <p>
              We share information only with service providers that help us run PPL, and only what
              each provider needs to do its job:
            </p>
            <ul className="list-disc list-outside ml-6 space-y-1">
              <li>
                <strong className="text-foreground">Stripe</strong> for payments.
              </li>
              <li>
                <strong className="text-foreground">Railway &amp; Vercel</strong> for hosting the app and database.
              </li>
              <li>
                <strong className="text-foreground">Google &amp; Apple</strong> if you sign in with their OAuth providers.
              </li>
              <li>
                <strong className="text-foreground">Hitting Performance Lab (HPL)</strong> when you enroll in a combined
                pitching + hitting plan or a joint private lesson. HPL receives the minimum
                information needed to schedule + coach your athlete.
              </li>
            </ul>
            <p>
              We will disclose information when legally required (subpoena, court order) and to
              protect PPL, our athletes, or the public from harm.
            </p>
          </section>

          <section>
            <h2 className="font-display uppercase tracking-[0.04em] text-foreground text-lg mb-2">
              6. Data security
            </h2>
            <p>
              Passwords are hashed with bcrypt at industry-standard cost. All traffic is over
              HTTPS. Cards are held at Stripe, which is PCI Level 1 certified. Access to the
              production database is restricted to PPL engineering staff. We will notify affected
              users without undue delay if we become aware of a data breach that materially
              affects them.
            </p>
          </section>

          <section>
            <h2 className="font-display uppercase tracking-[0.04em] text-foreground text-lg mb-2">
              7. Your rights
            </h2>
            <p>You may:</p>
            <ul className="list-disc list-outside ml-6 space-y-1">
              <li>Access the information we have about you from your account settings.</li>
              <li>
                Correct inaccurate information by editing your profile, or by emailing us to
                correct fields you can&apos;t edit yourself.
              </li>
              <li>
                Request deletion of your account and associated data by emailing us. We&apos;ll
                confirm before we delete, and retain what the law requires (e.g. payment records).
              </li>
              <li>
                Opt out of non-transactional emails. You cannot opt out of emails directly related
                to your account or scheduled sessions while your account is active.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="font-display uppercase tracking-[0.04em] text-foreground text-lg mb-2">
              8. Cookies &amp; tracking
            </h2>
            <p>
              We use only the cookies strictly necessary to run the app (authentication token,
              preferences). We do not use third-party advertising cookies. We do not run cross-
              site tracking.
            </p>
          </section>

          <section>
            <h2 className="font-display uppercase tracking-[0.04em] text-foreground text-lg mb-2">
              9. Changes to this policy
            </h2>
            <p>
              We&apos;ll post changes to this page and update the &ldquo;last updated&rdquo; date at the top.
              Material changes will also be emailed to account holders.
            </p>
          </section>

          <section>
            <h2 className="font-display uppercase tracking-[0.04em] text-foreground text-lg mb-2">
              10. Contact us
            </h2>
            <p>
              Email{' '}
              <a
                href="mailto:support@pitchingperformancelab.com"
                className="text-accent-text hover:brightness-110 underline"
              >
                support@pitchingperformancelab.com
              </a>{' '}
              with any privacy-related questions.
            </p>
          </section>
        </div>

        <div className="mt-12 pt-6 border-t border-border text-xs text-muted">
          <Link href="/legal/terms" className="hover:text-foreground">
            Terms of Service
          </Link>
          {' · '}
          <Link href="/" className="hover:text-foreground">
            Back to PPL
          </Link>
        </div>
      </div>
    </main>
  );
}
