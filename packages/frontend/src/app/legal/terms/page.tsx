'use client';

/**
 * Terms of Service — public route, no auth required.
 *
 * Template copy tailored to a recurring-billing training app. Chad to
 * review with a lawyer before going live.
 */

import Link from 'next/link';

const LAST_UPDATED = 'April 23, 2026';

export default function TermsPage() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-12 sm:py-16">
        <Link href="/" className="text-sm text-muted hover:text-foreground">
          ← Home
        </Link>

        <h1 className="font-display text-3xl sm:text-4xl uppercase tracking-[0.04em] text-foreground mt-6">
          Terms of Service
        </h1>
        <p className="text-xs text-muted mt-2 uppercase tracking-[0.12em]">
          Last updated: {LAST_UPDATED}
        </p>

        <div className="prose-ppl mt-8 space-y-6 text-foreground/90 leading-relaxed text-[15px]">
          <section>
            <p>
              These Terms of Service (&ldquo;Terms&rdquo;) govern your use of the Pitching Performance Lab
              web application and related training services (collectively, &ldquo;the Service&rdquo;) operated
              by Pitching Performance Lab (&ldquo;PPL,&rdquo; &ldquo;we,&rdquo; &ldquo;us&rdquo;). By creating an account or using
              the Service you agree to these Terms. If you do not agree, do not use the Service.
            </p>
          </section>

          <section>
            <h2 className="font-display uppercase tracking-[0.04em] text-foreground text-lg mb-2">
              1. Eligibility &amp; accounts
            </h2>
            <p>
              You must be at least 18 years old to create an account. If you are registering an
              athlete under 18 (including children aged 12 and under in our Youth program), you
              represent that you are their parent or legal guardian and accept these Terms on
              their behalf.
            </p>
            <p>
              You are responsible for maintaining the confidentiality of your login credentials
              and for all activity under your account.
            </p>
          </section>

          <section>
            <h2 className="font-display uppercase tracking-[0.04em] text-foreground text-lg mb-2">
              2. Membership &amp; billing
            </h2>
            <p>
              <strong className="text-foreground">Subscriptions.</strong> PPL memberships are recurring
              subscriptions processed via Stripe. Weekly plans bill every Monday or Thursday at
              9:00 AM Eastern Time; monthly (Pro) plans bill monthly from your signup date.
            </p>
            <p>
              <strong className="text-foreground">First charge.</strong> Your first charge is prorated for
              the days between signup and your first scheduled billing day. After that, your card
              on file will be charged the full plan price on every billing day until the plan is
              cancelled.
            </p>
            <p>
              <strong className="text-foreground">Onboarding fee.</strong> New athletes pay a one-time $300
              onboarding fee per athlete. Returning athletes and partner-school players are exempt.
            </p>
            <p>
              <strong className="text-foreground">Failed payments.</strong> If a payment fails, we will
              retry your card daily. While your account is past due, your access to bookings,
              programs, and other features will be suspended until payment is resolved.
            </p>
            <p>
              <strong className="text-foreground">Cancellation &amp; refunds.</strong> You may cancel your
              membership at any time from your account. Cancellation takes effect at the end of
              your current billing period; we do not prorate refunds for partial weeks or months.
              The $300 onboarding fee is non-refundable after services have been rendered.
            </p>
          </section>

          <section>
            <h2 className="font-display uppercase tracking-[0.04em] text-foreground text-lg mb-2">
              3. Training services &amp; risk
            </h2>
            <p>
              PPL provides in-person training, programming, video review, and coaching services
              for baseball pitchers and hitters. Baseball training involves physical activity and
              inherent risk of injury. You acknowledge that you or your athlete train at your own
              risk and agree to comply with our facility rules, coach instructions, and any
              liability waiver signed upon initial enrollment.
            </p>
          </section>

          <section>
            <h2 className="font-display uppercase tracking-[0.04em] text-foreground text-lg mb-2">
              4. Scheduling, cancellations &amp; no-shows
            </h2>
            <p>
              Sessions are booked through the app subject to capacity. You may cancel or
              reschedule up to the cancellation window shown on each session (typically 6 hours
              before start time). No-shows and late cancellations may result in a forfeited
              session credit and, for repeated occurrences, a small fine as disclosed at the time
              of booking.
            </p>
          </section>

          <section>
            <h2 className="font-display uppercase tracking-[0.04em] text-foreground text-lg mb-2">
              5. Acceptable use
            </h2>
            <p>You agree not to:</p>
            <ul className="list-disc list-outside ml-6 space-y-1">
              <li>Use the Service for any unlawful purpose.</li>
              <li>Attempt to access accounts or data that are not yours.</li>
              <li>Interfere with the app&apos;s operation or security.</li>
              <li>Impersonate another person or misrepresent your affiliation.</li>
              <li>Harass, threaten, or harm other members, staff, or coaches.</li>
            </ul>
            <p>
              We may suspend or terminate accounts that violate these Terms, without refund for
              any unused portion of a current billing period.
            </p>
          </section>

          <section>
            <h2 className="font-display uppercase tracking-[0.04em] text-foreground text-lg mb-2">
              6. Intellectual property
            </h2>
            <p>
              All content in the app — training programs, educational materials, video lessons,
              coach notes produced by PPL staff, software, design, branding — is the property of
              PPL or its licensors and is protected by copyright and other intellectual property
              laws. You may use it only for your personal, non-commercial training. You may not
              redistribute, resell, or publish PPL content without our written permission.
            </p>
          </section>

          <section>
            <h2 className="font-display uppercase tracking-[0.04em] text-foreground text-lg mb-2">
              7. Disclaimers
            </h2>
            <p>
              The Service is provided &ldquo;as is&rdquo; and &ldquo;as available.&rdquo; We do not guarantee that the
              Service will be uninterrupted, error-free, or secure against all threats. PPL makes
              no representation about specific training outcomes (velocity gains, college
              recruitment, professional advancement) — outcomes depend on individual effort,
              ability, and factors outside our control.
            </p>
          </section>

          <section>
            <h2 className="font-display uppercase tracking-[0.04em] text-foreground text-lg mb-2">
              8. Limitation of liability
            </h2>
            <p>
              To the maximum extent permitted by law, PPL shall not be liable for indirect,
              incidental, special, consequential, or punitive damages arising out of your use of
              the Service. Our total liability for any claim arising under these Terms shall not
              exceed the amount you paid PPL in the three months prior to the event giving rise
              to the claim.
            </p>
          </section>

          <section>
            <h2 className="font-display uppercase tracking-[0.04em] text-foreground text-lg mb-2">
              9. Governing law
            </h2>
            <p>
              These Terms are governed by the laws of the Commonwealth of Kentucky, without
              regard to conflict of law principles. Any dispute arising under these Terms will be
              resolved in the state or federal courts located in Jefferson County, Kentucky.
            </p>
          </section>

          <section>
            <h2 className="font-display uppercase tracking-[0.04em] text-foreground text-lg mb-2">
              10. Changes to these Terms
            </h2>
            <p>
              We may update these Terms from time to time. Material changes will be announced by
              email and/or in-app notification before they take effect. Your continued use of the
              Service after changes take effect constitutes acceptance of the updated Terms.
            </p>
          </section>

          <section>
            <h2 className="font-display uppercase tracking-[0.04em] text-foreground text-lg mb-2">
              11. Contact
            </h2>
            <p>
              Questions about these Terms? Email{' '}
              <a
                href="mailto:support@pitchingperformancelab.com"
                className="text-accent-text hover:brightness-110 underline"
              >
                support@pitchingperformancelab.com
              </a>
              .
            </p>
          </section>
        </div>

        <div className="mt-12 pt-6 border-t border-border text-xs text-muted">
          <Link href="/legal/privacy" className="hover:text-foreground">
            Privacy Policy
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
