'use client';

/**
 * Integration Health diagnostic — admin's at-a-glance view of every
 * external service the app talks to. Shows what's connected, what's
 * missing, and exactly which env vars / settings to add.
 *
 * One-stop launch checklist.
 */

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';

type HealthStatus = 'connected' | 'not_configured' | 'partial' | 'error' | string;
type HealthCheck = {
  status: HealthStatus;
  message?: string;
  missing?: string[];
};

const INTEGRATION_LABELS: Record<string, { label: string; purpose: string }> = {
  stripe: { label: 'Stripe', purpose: 'Payments + memberships + billing portal' },
  email: { label: 'SMTP / Email', purpose: 'Transactional + marketing email delivery' },
  twilio: { label: 'Twilio', purpose: 'SMS reminders, blasts, missed-call text-back, inbound calls' },
  ai: { label: 'Anthropic AI', purpose: 'AI email composer + AI review reply' },
  places: { label: 'Google Places', purpose: 'Review monitoring + auto-import' },
  resendInbound: { label: 'Resend Inbound', purpose: 'Inbound email → in-app conversations' },
  orgSettings: { label: 'Org Settings (Reviews)', purpose: 'Google review URL, Facebook review URL, Place ID' },
};

export default function AdminIntegrationsPage() {
  const [health, setHealth] = useState<Record<string, HealthCheck> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getIntegrationHealth();
      setHealth(res.data ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const counts = health
    ? Object.values(health).reduce(
        (acc, h) => {
          if (h.status === 'connected') acc.ok++;
          else if (h.status === 'partial') acc.partial++;
          else if (h.status === 'not_configured' || h.status === 'error') acc.bad++;
          return acc;
        },
        { ok: 0, partial: 0, bad: 0 }
      )
    : { ok: 0, partial: 0, bad: 0 };

  return (
    <main className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Integration Health</h1>
          <p className="text-sm text-muted mt-0.5">
            Status of every external service the app uses. Use this as a launch checklist.
          </p>
        </div>
        <button onClick={load} disabled={loading} className="ppl-btn ppl-btn-secondary text-sm">
          {loading ? 'Checking…' : 'Refresh'}
        </button>
      </div>

      {/* Top-line status */}
      {health && (
        <div className="grid grid-cols-3 gap-3 mb-6">
          <div className="ppl-card text-center">
            <div className="text-3xl font-bold text-accent-text">{counts.ok}</div>
            <div className="text-xs text-muted uppercase tracking-wider mt-1">Connected</div>
          </div>
          <div className="ppl-card text-center">
            <div className="text-3xl font-bold text-amber-400">{counts.partial}</div>
            <div className="text-xs text-muted uppercase tracking-wider mt-1">Partial</div>
          </div>
          <div className="ppl-card text-center">
            <div className="text-3xl font-bold text-red-400">{counts.bad}</div>
            <div className="text-xs text-muted uppercase tracking-wider mt-1">Missing / Broken</div>
          </div>
        </div>
      )}

      {error && (
        <div className="mb-4 p-3 rounded-lg bg-red-500/10 text-red-400 border border-red-500/30 text-sm">
          {error}
        </div>
      )}

      {loading && !health ? (
        <div className="space-y-3">
          {[1, 2, 3, 4].map((i) => <div key={i} className="ppl-card animate-pulse h-24" />)}
        </div>
      ) : health ? (
        <div className="space-y-3">
          {Object.entries(health).map(([key, check]) => (
            <IntegrationCard
              key={key}
              integrationKey={key}
              label={INTEGRATION_LABELS[key]?.label ?? key}
              purpose={INTEGRATION_LABELS[key]?.purpose ?? ''}
              check={check}
            />
          ))}
        </div>
      ) : null}

      <div className="mt-8 ppl-card bg-background/40">
        <h3 className="text-sm font-semibold text-foreground mb-2">How to fix anything red</h3>
        <ul className="text-xs text-muted space-y-1 list-disc list-inside">
          <li>
            <strong className="text-foreground">Env vars</strong> live in Railway's project settings
            under Variables. Add them, redeploy, and refresh this page.
          </li>
          <li>
            <strong className="text-foreground">OrgSettings fields</strong> (review URLs, place ID) are
            edited on the{' '}
            <Link href="/admin/settings" className="text-accent-text hover:underline">
              Settings page
            </Link>
            .
          </li>
          <li>
            <strong className="text-foreground">Twilio webhooks</strong> need to be pointed at this app
            from Twilio's phone-number console. Voice URL:{' '}
            <code className="text-accent-text">/api/twilio/voice</code>, SMS URL:{' '}
            <code className="text-accent-text">/api/twilio/sms</code>.
          </li>
        </ul>
      </div>
    </main>
  );
}

function IntegrationCard({
  integrationKey,
  label,
  purpose,
  check,
}: {
  integrationKey: string;
  label: string;
  purpose: string;
  check: HealthCheck;
}) {
  const styles: Record<HealthStatus, { dot: string; chip: string; label: string }> = {
    connected: { dot: 'bg-green-500', chip: 'bg-green-500/15 text-green-400 border-green-500/30', label: 'Connected' },
    partial: { dot: 'bg-amber-500', chip: 'bg-amber-500/15 text-amber-400 border-amber-500/30', label: 'Partial' },
    not_configured: { dot: 'bg-gray-500', chip: 'bg-gray-500/15 text-gray-400 border-gray-500/30', label: 'Not Configured' },
    error: { dot: 'bg-red-500', chip: 'bg-red-500/15 text-red-400 border-red-500/30', label: 'Error' },
  };
  const style = styles[check.status] || styles.error;

  return (
    <div className="ppl-card">
      <div className="flex items-start gap-3">
        <div className={`w-2.5 h-2.5 rounded-full ${style.dot} mt-2 flex-shrink-0`} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-semibold text-foreground text-sm">{label}</h3>
            <span className={`text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full border ${style.chip}`}>
              {style.label}
            </span>
            <span className="text-[10px] text-muted ml-auto">{integrationKey}</span>
          </div>
          {purpose && <p className="text-xs text-muted mt-0.5">{purpose}</p>}
          {check.message && <p className="text-sm text-foreground/80 mt-2">{check.message}</p>}
          {check.missing && check.missing.length > 0 && (
            <div className="mt-2 p-2 rounded bg-background/60">
              <p className="text-[10px] uppercase tracking-wider text-muted mb-1">Missing</p>
              <ul className="space-y-0.5">
                {check.missing.map((m) => (
                  <li key={m} className="text-xs">
                    <code className="text-amber-400">{m}</code>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
