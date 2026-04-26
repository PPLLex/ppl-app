'use client';

/**
 * Two-factor auth panel — drops into the profile/security page.
 *
 * Three states:
 *   - Loading status
 *   - 2FA OFF → "Set up two-factor" CTA → enrollment wizard (QR + verify)
 *   - 2FA ON  → status badge + "Disable" + "Regenerate recovery codes" actions
 *
 * Recovery codes are shown ONCE in a dedicated success state with a
 * "download as .txt" button. After the user dismisses, they can never be
 * shown again — only regenerated.
 *
 * Premium-feel notes (PREMIUM_AUDIT alignment):
 *   - Skeleton, not bare spinner, while status loads (U1 / P5).
 *   - Inline validation toasts on success/failure (U6).
 *   - QR code rendered as data URL inline — no flicker, paints with the page.
 *   - Recovery-codes copy uses a monospace + tracking treatment so the
 *     codes feel like real "secrets" the user wants to print.
 */

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { api } from '@/lib/api';

type Status = {
  enabled: boolean;
  enabledAt: string | null;
  recoveryCodesRemaining: number;
};

type SetupBundle = {
  secret: string;
  otpauthUrl: string;
  qrDataUrl: string;
};

export function TwoFactorPanel() {
  const [status, setStatus] = useState<Status | null>(null);
  const [loading, setLoading] = useState(true);

  // Enrollment wizard state
  const [setup, setSetup] = useState<SetupBundle | null>(null);
  const [enrollCode, setEnrollCode] = useState('');
  const [enrolling, setEnrolling] = useState(false);

  // One-time recovery codes display (only set right after a successful
  // enable or regenerate — clears on dismiss).
  const [shownRecoveryCodes, setShownRecoveryCodes] = useState<string[] | null>(null);

  // Disable form
  const [showDisable, setShowDisable] = useState(false);
  const [disablePassword, setDisablePassword] = useState('');
  const [disableCode, setDisableCode] = useState('');
  const [disabling, setDisabling] = useState(false);

  // Regenerate form
  const [showRegen, setShowRegen] = useState(false);
  const [regenCode, setRegenCode] = useState('');
  const [regenerating, setRegenerating] = useState(false);

  const loadStatus = async () => {
    try {
      const res = await api.getTwoFactorStatus();
      if (res.data) setStatus(res.data);
    } catch (err) {
      // Silent — the page is still useful without status; the actions
      // themselves will surface server errors via toast.
      console.error('2FA status load failed', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadStatus();
  }, []);

  const startSetup = async () => {
    try {
      const res = await api.setupTwoFactor();
      if (res.data) {
        setSetup(res.data);
        setEnrollCode('');
      }
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Could not start 2FA setup');
    }
  };

  const finishEnroll = async (e: React.FormEvent) => {
    e.preventDefault();
    setEnrolling(true);
    try {
      const res = await api.enableTwoFactor(enrollCode);
      if (res.data?.recoveryCodes) {
        setShownRecoveryCodes(res.data.recoveryCodes);
        setSetup(null);
        setEnrollCode('');
        toast.success('Two-factor authentication is now active');
        await loadStatus();
      }
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Verification failed');
    } finally {
      setEnrolling(false);
    }
  };

  const submitDisable = async (e: React.FormEvent) => {
    e.preventDefault();
    setDisabling(true);
    try {
      await api.disableTwoFactor(disablePassword, disableCode);
      toast.success('Two-factor authentication disabled');
      setShowDisable(false);
      setDisablePassword('');
      setDisableCode('');
      await loadStatus();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Could not disable 2FA');
    } finally {
      setDisabling(false);
    }
  };

  const submitRegen = async (e: React.FormEvent) => {
    e.preventDefault();
    setRegenerating(true);
    try {
      const res = await api.regenerateRecoveryCodes(regenCode);
      if (res.data?.recoveryCodes) {
        setShownRecoveryCodes(res.data.recoveryCodes);
        setShowRegen(false);
        setRegenCode('');
        toast.success('New recovery codes generated');
        await loadStatus();
      }
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Could not regenerate codes');
    } finally {
      setRegenerating(false);
    }
  };

  const downloadRecoveryCodes = () => {
    if (!shownRecoveryCodes) return;
    const body =
      'Pitching Performance Lab — Two-Factor Recovery Codes\n' +
      '=====================================================\n\n' +
      'Save these somewhere safe. Each code can be used ONCE to sign in if\n' +
      'you lose access to your authenticator app. Generated ' +
      new Date().toLocaleString() +
      '.\n\n' +
      shownRecoveryCodes.join('\n') +
      '\n';
    const blob = new Blob([body], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'ppl-2fa-recovery-codes.txt';
    a.click();
    URL.revokeObjectURL(url);
  };

  // ============================================================
  // Render
  // ============================================================

  if (loading) {
    return (
      <div className="ppl-card p-5 space-y-3">
        <div className="ppl-skeleton h-5 w-48 rounded" />
        <div className="ppl-skeleton h-4 w-72 rounded" />
        <div className="ppl-skeleton h-9 w-40 rounded" />
      </div>
    );
  }

  // Recovery-codes one-shot display takes over the whole panel — this is
  // a moment we want the user to slow down for.
  if (shownRecoveryCodes) {
    return (
      <div className="ppl-card p-5">
        <div className="mb-4">
          <h3 className="text-base font-semibold text-foreground">Save your recovery codes</h3>
          <p className="text-xs text-muted mt-1">
            These codes are shown once. Each can be used once to sign in if
            you lose your authenticator app. Save them somewhere only you can
            access — a password manager is ideal.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-2 font-mono text-sm tracking-widest p-4 rounded-lg bg-background border border-border">
          {shownRecoveryCodes.map((c) => (
            <div key={c} className="text-foreground select-all">
              {c}
            </div>
          ))}
        </div>
        <div className="flex flex-col sm:flex-row gap-2 mt-4">
          <button
            type="button"
            onClick={downloadRecoveryCodes}
            className="ppl-btn ppl-btn-primary flex-1"
          >
            Download as .txt
          </button>
          <button
            type="button"
            onClick={() => {
              navigator.clipboard.writeText(shownRecoveryCodes.join('\n'));
              toast.success('Copied to clipboard');
            }}
            className="ppl-btn ppl-btn-secondary flex-1"
          >
            Copy to clipboard
          </button>
          <button
            type="button"
            onClick={() => setShownRecoveryCodes(null)}
            className="ppl-btn flex-1"
          >
            I&apos;ve saved them
          </button>
        </div>
      </div>
    );
  }

  // Enrollment wizard — secret + QR + verify-code form.
  if (setup) {
    return (
      <div className="ppl-card p-5">
        <div className="mb-4">
          <h3 className="text-base font-semibold text-foreground">Set up two-factor</h3>
          <p className="text-xs text-muted mt-1">
            Scan this QR code in Google Authenticator, 1Password, Authy, or
            any TOTP-compatible app. Then enter the 6-digit code it shows
            to confirm.
          </p>
        </div>
        <div className="flex flex-col sm:flex-row gap-5 items-center sm:items-start">
          <div className="flex-shrink-0 p-2 rounded-lg bg-white">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={setup.qrDataUrl} alt="2FA QR code" width={200} height={200} />
          </div>
          <div className="flex-1 w-full">
            <p className="text-xs text-muted mb-1">Manual entry secret</p>
            <code className="block text-sm font-mono break-all p-3 rounded bg-background border border-border text-foreground select-all">
              {setup.secret}
            </code>
            <form onSubmit={finishEnroll} className="mt-4 space-y-3">
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">
                  Enter 6-digit code
                </label>
                <input
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  value={enrollCode}
                  onChange={(e) => setEnrollCode(e.target.value)}
                  placeholder="123 456"
                  className="ppl-input text-center tracking-[0.4em] text-lg font-mono"
                  required
                />
              </div>
              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={enrolling || enrollCode.length < 6}
                  className="ppl-btn ppl-btn-primary flex-1"
                >
                  {enrolling ? 'Verifying...' : 'Activate two-factor'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSetup(null);
                    setEnrollCode('');
                  }}
                  className="ppl-btn"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>
    );
  }

  // Default: status + actions.
  return (
    <div className="ppl-card p-5">
      <div className="flex items-start gap-4">
        <div
          className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${
            status?.enabled ? 'bg-highlight/20 text-accent-text' : 'bg-amber-500/15 text-amber-400'
          }`}
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 11c0-1.1.9-2 2-2s2 .9 2 2-2 2-2 2v1m-4 4h8a2 2 0 002-2v-7a2 2 0 00-2-2h-1V6a3 3 0 00-6 0v1H8a2 2 0 00-2 2v7a2 2 0 002 2z" />
          </svg>
        </div>
        <div className="flex-1">
          <h3 className="text-base font-semibold text-foreground">
            Two-factor authentication
          </h3>
          {status?.enabled ? (
            <p className="text-xs text-muted mt-1">
              Active since {status.enabledAt ? new Date(status.enabledAt).toLocaleDateString() : 'recently'}.
              You have <strong className="text-foreground">{status.recoveryCodesRemaining}</strong>{' '}
              recovery code{status.recoveryCodesRemaining === 1 ? '' : 's'} remaining.
            </p>
          ) : (
            <p className="text-xs text-muted mt-1">
              Add a second sign-in step using an authenticator app. Highly
              recommended for admin accounts.
            </p>
          )}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {status?.enabled ? (
          <>
            <button
              type="button"
              onClick={() => setShowRegen((v) => !v)}
              className="ppl-btn ppl-btn-secondary text-sm"
            >
              {showRegen ? 'Cancel' : 'Regenerate recovery codes'}
            </button>
            <button
              type="button"
              onClick={() => setShowDisable((v) => !v)}
              className="ppl-btn text-sm"
            >
              {showDisable ? 'Cancel' : 'Disable two-factor'}
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={startSetup}
            className="ppl-btn ppl-btn-primary text-sm"
          >
            Set up two-factor
          </button>
        )}
      </div>

      {showRegen && (
        <form onSubmit={submitRegen} className="mt-4 space-y-3 border-t border-border pt-4">
          <p className="text-xs text-muted">
            This will invalidate your existing recovery codes. Enter your
            current 6-digit authenticator code to confirm.
          </p>
          <input
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            value={regenCode}
            onChange={(e) => setRegenCode(e.target.value)}
            placeholder="123 456"
            className="ppl-input text-center tracking-[0.4em] text-lg font-mono"
            required
          />
          <button
            type="submit"
            disabled={regenerating || regenCode.length < 6}
            className="ppl-btn ppl-btn-primary w-full"
          >
            {regenerating ? 'Generating...' : 'Generate new codes'}
          </button>
        </form>
      )}

      {showDisable && (
        <form onSubmit={submitDisable} className="mt-4 space-y-3 border-t border-border pt-4">
          <p className="text-xs text-muted">
            Confirm with your password and a current 2FA code (or recovery
            code). Disabling removes the second sign-in step entirely.
          </p>
          <input
            type="password"
            value={disablePassword}
            onChange={(e) => setDisablePassword(e.target.value)}
            placeholder="Current password"
            autoComplete="current-password"
            className="ppl-input"
            required
          />
          <input
            type="text"
            inputMode="text"
            autoComplete="one-time-code"
            value={disableCode}
            onChange={(e) => setDisableCode(e.target.value)}
            placeholder="6-digit code or recovery code"
            className="ppl-input text-center tracking-widest font-mono"
            required
          />
          <button
            type="submit"
            disabled={disabling}
            className="ppl-btn w-full"
          >
            {disabling ? 'Disabling...' : 'Disable two-factor'}
          </button>
        </form>
      )}
    </div>
  );
}
