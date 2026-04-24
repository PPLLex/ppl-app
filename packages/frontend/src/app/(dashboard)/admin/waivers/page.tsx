'use client';

/**
 * Admin — Liability Waiver audit page.
 *
 * Lists the most recent signed liability waivers (newest first) with
 * the athlete, signer name, version, and timestamp. Supports filtering
 * by athleteProfileId via ?athleteId=… in the URL.
 *
 * Editing the master waiver text + bumping the version happens on the
 * admin settings page (OrgSettings.liabilityWaiverText /
 * liabilityWaiverVersion).
 */

import { useEffect, useMemo, useState } from 'react';
import Link from '@/components/PageTransitionLink';
import { api } from '@/lib/api';

interface Sig {
  id: string;
  athleteProfileId: string;
  athleteName: string;
  signedByName: string;
  signedByUserId: string;
  waiverVersion: string;
  signedAt: string;
}

export default function AdminWaiversPage() {
  const [rows, setRows] = useState<Sig[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const res = await api.listWaiverSignatures();
        setRows(res.data || []);
      } catch (e) {
        setErr(e instanceof Error ? e.message : 'Failed to load');
      }
    })();
  }, []);

  const filtered = useMemo(() => {
    if (!rows) return null;
    const needle = q.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter(
      (r) =>
        r.athleteName.toLowerCase().includes(needle) ||
        r.signedByName.toLowerCase().includes(needle) ||
        r.waiverVersion.toLowerCase().includes(needle)
    );
  }, [rows, q]);

  return (
    <main className="ppl-page-root">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
        <Link href="/admin" className="text-sm text-muted hover:text-foreground">
          ← Admin
        </Link>

        <div className="flex items-end justify-between gap-4 mt-4 flex-wrap">
          <div>
            <h1 className="font-display text-2xl sm:text-3xl uppercase tracking-[0.04em] text-foreground">
              Liability Waivers
            </h1>
            <p className="text-sm text-muted mt-1">
              Every signed liability waiver, newest first. Edit the master text on the settings page.
            </p>
          </div>
          <input
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search athlete, signer, or version…"
            className="ppl-input text-sm max-w-xs w-full"
          />
        </div>

        {err && (
          <div className="mt-6 p-4 border border-destructive/40 rounded-lg text-sm text-destructive bg-destructive/10">
            {err}
          </div>
        )}

        <section className="mt-6 border border-border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-surface">
              <tr className="text-left text-[11px] uppercase tracking-[0.12em] text-muted">
                <th className="px-4 py-3 font-medium">Athlete</th>
                <th className="px-4 py-3 font-medium">Signed by</th>
                <th className="px-4 py-3 font-medium">Version</th>
                <th className="px-4 py-3 font-medium">Signed at</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered === null && (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-muted text-center">
                    Loading…
                  </td>
                </tr>
              )}
              {filtered !== null && filtered.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-muted text-center">
                    No signatures yet.
                  </td>
                </tr>
              )}
              {filtered?.map((r) => (
                <tr key={r.id} className="hover:bg-surface/50">
                  <td className="px-4 py-3 text-foreground font-medium">{r.athleteName}</td>
                  <td className="px-4 py-3 text-foreground/90">{r.signedByName}</td>
                  <td className="px-4 py-3 text-muted uppercase tracking-[0.08em] text-[11px]">
                    {r.waiverVersion}
                  </td>
                  <td className="px-4 py-3 text-muted">
                    {new Date(r.signedAt).toLocaleString(undefined, {
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric',
                      hour: 'numeric',
                      minute: '2-digit',
                    })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>
    </main>
  );
}
