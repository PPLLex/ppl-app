'use client';

/**
 * Client — Liability Waiver signing page.
 *
 * Shows the current master waiver text and the list of athletes the
 * logged-in user is responsible for. Each unsigned athlete gets a
 * "Sign for X" card with a typed-name input + "I agree" checkbox.
 *
 * After signing, the page refreshes the status so the banner on the
 * parent dashboard clears. Booking is gated on having a signature
 * against the current waiver version (enforced server-side; UI
 * reinforces this by surfacing the pending list first).
 */

import { useEffect, useMemo, useState } from 'react';
import Link from '@/components/PageTransitionLink';
import { api } from '@/lib/api';
import { toast } from 'sonner';

interface WaiverAthlete {
  athleteProfileId: string;
  athleteName: string;
  signed: boolean;
  signedAt: string | null;
  signedBy: string | null;
}

export default function WaiverPage() {
  const [text, setText] = useState<string | null>(null);
  const [version, setVersion] = useState<string | null>(null);
  const [athletes, setAthletes] = useState<WaiverAthlete[] | null>(null);
  const [signingId, setSigningId] = useState<string | null>(null);
  const [typedNames, setTypedNames] = useState<Record<string, string>>({});
  const [agreed, setAgreed] = useState<Record<string, boolean>>({});
  const [err, setErr] = useState<string | null>(null);

  const load = async () => {
    try {
      const [w, s] = await Promise.all([api.getCurrentWaiver(), api.getWaiverStatus()]);
      setText(w.data?.text ?? '');
      setVersion(w.data?.version ?? null);
      setAthletes(s.data?.athletes ?? []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to load waiver');
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const pending = useMemo(() => (athletes || []).filter((a) => !a.signed), [athletes]);
  const signed = useMemo(() => (athletes || []).filter((a) => a.signed), [athletes]);

  const onSign = async (athleteProfileId: string) => {
    const name = (typedNames[athleteProfileId] || '').trim();
    if (name.length < 2) {
      toast.error('Type your full name to sign');
      return;
    }
    if (!agreed[athleteProfileId]) {
      toast.error('Check the box to confirm you agree');
      return;
    }
    setSigningId(athleteProfileId);
    try {
      await api.signWaiver({ athleteProfileId, signedByName: name });
      toast.success('Waiver signed');
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to sign');
    } finally {
      setSigningId(null);
    }
  };

  return (
    <main className="ppl-page-root">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8">
        <Link href="/client" className="text-sm text-muted hover:text-foreground">
          ← Back to dashboard
        </Link>

        <h1 className="font-display text-2xl sm:text-3xl uppercase tracking-[0.04em] text-foreground mt-4">
          Liability Waiver
        </h1>
        <p className="text-sm text-muted mt-2">
          Every athlete in your family must have a signed waiver on file before their next booking.
          {version && (
            <span className="ml-1 uppercase tracking-[0.12em] text-[11px]">
              Version {version}
            </span>
          )}
        </p>

        {err && (
          <div className="mt-6 p-4 border border-destructive/40 rounded-lg text-sm text-destructive bg-destructive/10">
            {err}
          </div>
        )}

        {/* Waiver text */}
        <section className="mt-6 border border-border rounded-lg bg-card">
          <div className="p-5 max-h-[420px] overflow-y-auto whitespace-pre-wrap text-[14px] leading-relaxed text-foreground/90">
            {text ?? 'Loading…'}
          </div>
        </section>

        {/* Pending signatures */}
        <section className="mt-8">
          <h2 className="font-display uppercase tracking-[0.04em] text-foreground text-base mb-3">
            Athletes needing a signature {pending.length > 0 && `(${pending.length})`}
          </h2>
          {athletes === null && <p className="text-sm text-muted">Loading…</p>}
          {athletes !== null && pending.length === 0 && (
            <p className="text-sm text-muted">
              Everyone in your family has signed the current waiver. Thank you.
            </p>
          )}
          <div className="space-y-4">
            {pending.map((a) => (
              <div
                key={a.athleteProfileId}
                className="border border-border rounded-lg p-4 sm:p-5 bg-card"
              >
                <div className="flex items-center justify-between gap-3">
                  <h3 className="font-display text-lg text-foreground">{a.athleteName}</h3>
                  <span className="text-[10px] uppercase tracking-[0.16em] text-destructive">
                    Unsigned
                  </span>
                </div>

                <label className="block mt-4 text-xs uppercase tracking-[0.12em] text-muted mb-1">
                  Typed signature (parent / guardian full name)
                </label>
                <input
                  type="text"
                  value={typedNames[a.athleteProfileId] || ''}
                  onChange={(e) =>
                    setTypedNames((m) => ({ ...m, [a.athleteProfileId]: e.target.value }))
                  }
                  placeholder="e.g. Chad Martin"
                  className="ppl-input w-full"
                />

                <label className="flex items-start gap-2 mt-3 text-sm text-foreground/90 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={!!agreed[a.athleteProfileId]}
                    onChange={(e) =>
                      setAgreed((m) => ({ ...m, [a.athleteProfileId]: e.target.checked }))
                    }
                    className="mt-[3px]"
                  />
                  <span>
                    I have read and agree to the waiver above on behalf of{' '}
                    <strong className="text-foreground">{a.athleteName}</strong>. I confirm
                    I am the athlete or their parent / legal guardian.
                  </span>
                </label>

                <button
                  type="button"
                  onClick={() => onSign(a.athleteProfileId)}
                  disabled={signingId === a.athleteProfileId}
                  className="ppl-btn ppl-btn-primary mt-4 w-full sm:w-auto disabled:opacity-60"
                >
                  {signingId === a.athleteProfileId ? 'Signing…' : `Sign for ${a.athleteName}`}
                </button>
              </div>
            ))}
          </div>
        </section>

        {/* Already signed */}
        {signed.length > 0 && (
          <section className="mt-10">
            <h2 className="font-display uppercase tracking-[0.04em] text-foreground text-base mb-3">
              Already signed
            </h2>
            <ul className="divide-y divide-border border border-border rounded-lg bg-card">
              {signed.map((a) => (
                <li key={a.athleteProfileId} className="flex items-center justify-between p-4">
                  <div>
                    <div className="text-foreground font-medium">{a.athleteName}</div>
                    <div className="text-xs text-muted mt-0.5">
                      Signed by {a.signedBy}
                      {a.signedAt &&
                        ' on ' +
                          new Date(a.signedAt).toLocaleDateString(undefined, {
                            month: 'short',
                            day: 'numeric',
                            year: 'numeric',
                          })}
                    </div>
                  </div>
                  <span className="text-[10px] uppercase tracking-[0.16em] text-accent-text">
                    On file
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </main>
  );
}
