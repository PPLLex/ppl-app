'use client';

import Link from 'next/link';

/**
 * MembershipLockout â "Dummy Mode" UI
 *
 * Displayed when the API returns a 403 with a membership-related message.
 * The client can only access payment/membership pages from here.
 */
export default function MembershipLockout({ message }: { message: string }) {
  return (
    <div className="min-h-[60vh] flex items-center justify-center px-4">
      <div className="max-w-md w-full text-center">
        {/* Warning icon */}
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-danger/10 mb-6">
          <svg className="w-8 h-8 text-danger" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
          </svg>
        </div>

        <h2 className="text-xl font-bold text-foreground mb-2">Account On Hold</h2>
        <p className="text-sm text-muted mb-6 leading-relaxed">
          {message}
        </p>

        <div className="space-y-3">
          <Link
            href="/client/membership"
            className="ppl-btn ppl-btn-primary w-full py-3 text-base inline-block text-center"
          >
            Manage Membership & Payment
          </Link>
          <Link
            href="/client/account"
            className="ppl-btn ppl-btn-secondary w-full py-3 text-sm inline-block text-center"
          >
            View Account Details
          </Link>
        </div>

        <p className="text-xs text-muted mt-6">
          Need help? Contact us at{' '}
          <a href="mailto:info@pitchingperformancelab.com" className="text-ppl-light-green hover:text-ppl-dark-green">
            info@pitchingperformancelab.com
          </a>
        </p>
      </div>
    </div>
  );
}
