'use client';

/**
 * Admin — Liability Waiver management page.
 *
 * Two sections:
 *   1. Master text editor — update the waiver copy and bump the
 *      version string. Bumping the version invalidates EVERY existing
 *      signature and forces re-signing on next booking.
 *   2. Signature audit log — every signed waiver, newest first, with
 *      athlete, signer, version, and timestamp.
 */

import { useEffect, useMemo, useState } from 'react';
import Link from '@/components/PageTransitionLink';
import { api } from '@/lib/api';
import { toast } from 'sonner';

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

  // Master waiver text editor
  const [text, setText] = useState('');
  const [version, setVersion] = useState('');
  const [savedText, setSavedText] = useState('');
  const [savedVersion, setSavedVersion] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [showBumpConfirm, setShowBumpConfirm] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const [sigsRes, currentRes] = await Promise.all([
          api.listWaiverSignatures(),
          api.getCurrentWaiver(),
        ]);
        setRows(sigsRes.data || []);
        const t = currentRes.data?.text ?? '';
        const v = currentRes.data?.version ?? '';
        setText(t);
        setVersion(v);
        setSavedText(t);
        setSavedVersion(v);
      } catch (e) {
        setErr(e instanceof Error ? e.message : 'Failed to load');
      }
    })();
  }, []);

  const textDirty = text !== savedText;
  const versionDirty = version !== savedVersion;

  // Suggest a fresh date-based version tag when the user edits text but
  // hasn't touched the version yet — makes "bump on change" safe-by-default.
  const suggestedVersion = useMemo(() => {
    const d = new Date();
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }, []);

  const saveText = async () => {
    // Text-only edits (version untouched) don't invalidate signatures —
    // a typo-fix shouldn't force everyone to re-sign. Version bumps do.
    if (textDirty && !versionDirty) {
      setIsSaving(true);
      try {
        await api.updateBranding({ liabilityWaiverText: text });
        setSavedText(text);
        toast.success('Waiver text saved (version unchanged — no re-signing required)');
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Failed to save');
      } finally {
        setIsSaving(false);
      }
      return;
    }
    // Version change — confirm first, because this invalidates every signature.
    setShowBumpConfirm(true);
  };

  const confirmBump = async () => {
    setIsSaving(true);
    try {
      await api.updateBranding({
        liabilityWaiverText: text,
        liabilityWaiverVersion: version.trim(),
      });
      setSavedText(text);
      setSavedVersion(version.trim());
      setShowBumpConfirm(false);
      toast.success('Waiver saved and version bumped — all athletes must re-sign');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to save');
    } finally {
      setIsSaving(false);
    }
  };

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

        {/* Master waiver text editor */}
        <section className="mt-6 border border-border rounded-lg p-5 bg-card">
          <h2 className="font-display uppercase tracking-[0.04em] text-foreground text-base">
            Master Waiver Text
          </h2>
          <p className="text-xs text-muted mt-1 leading-relaxed">
            Edit the text that every parent/athlete sees and signs. Fixing a typo won&apos;t
            force re-signing — but bumping the <strong className="text-foreground">version</strong>{' '}
            will invalidate every existing signature.
          </p>

          <label className="ppl-label mt-5 block">Waiver text</label>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={14}
            className="ppl-input w-full text-sm leading-relaxed font-mono"
            placeholder="Paste or type your waiver copy here…"
          />

          <div className="mt-4 grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-3 items-end">
            <div>
              <label className="ppl-label">Version</label>
              <input
                type="text"
                value={version}
                onChange={(e) => setVersion(e.target.value)}
                className="ppl-input w-full font-mono text-sm"
                placeholder="e.g. 2026-04-23"
              />
              {textDirty && !versionDirty && version === savedVersion && (
                <button
                  type="button"
                  onClick={() => setVersion(suggestedVersion)}
                  className="text-[11px] text-accent-text hover:brightness-110 mt-1"
                >
                  Bump version to {suggestedVersion} →
                </button>
              )}
            </div>
            <button
              type="button"
              onClick={saveText}
              disabled={isSaving || (!textDirty && !versionDirty)}
              className="ppl-btn ppl-btn-primary text-sm disabled:opacity-60"
            >
              {isSaving ? 'Saving…' : versionDirty ? 'Save & force re-sign' : 'Save text'}
            </button>
          </div>
        </section>

        {/* Confirm version-bump modal — simple inline card for now */}
        {showBumpConfirm && (
          <div className="mt-4 p-4 border-2 border-amber-500/50 bg-amber-500/10 rounded-lg">
            <h3 className="font-display uppercase tracking-[0.04em] text-foreground text-sm">
              Bump waiver version?
            </h3>
            <p className="text-sm text-foreground/90 mt-2">
              Every athlete will be required to re-sign the new version before their next
              booking. The banner on their dashboard will appear until they do. This cannot be
              undone — existing signatures remain on file for audit but no longer satisfy the
              booking gate.
            </p>
            <div className="flex gap-2 mt-3">
              <button
                type="button"
                onClick={confirmBump}
                disabled={isSaving}
                className="ppl-btn ppl-btn-primary text-sm disabled:opacity-60"
              >
                {isSaving ? 'Saving…' : 'Yes, bump & force re-sign'}
              </button>
              <button
                type="button"
                onClick={() => setShowBumpConfirm(false)}
                className="text-sm text-muted hover:text-foreground px-3"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        <h2 className="font-display uppercase tracking-[0.04em] text-foreground text-base mt-10">
          Signature Log
        </h2>
        <section className="mt-3 border border-border rounded-lg overflow-hidden">
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
