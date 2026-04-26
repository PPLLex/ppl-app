'use client';

/**
 * Swift CSV importer — admin migration tool. Phase 2 launch unblocker.
 *
 * Two-step flow: upload + preview (dry run, no DB writes), then commit
 * to actually create rows. Idempotent on email so reruns are safe.
 */

import { useState } from 'react';
import { toast } from 'sonner';

const API_BASE =
  typeof window !== 'undefined' && window.location.host.includes('localhost')
    ? '/api'
    : process.env.NEXT_PUBLIC_API_URL || 'https://api.pitchingperformancelab.com/api';

type PreviewResult = {
  total: number;
  parsed: number;
  errors: Array<{ row: number; reason: string; raw: Record<string, string> }>;
  preview: Array<{ email: string; fullName: string; phone?: string | null; planName?: string | null; ageGroup?: string | null; locationName?: string | null }>;
  willCreate: number;
  willUpdate: number;
  membershipsCreated: number;
  ageGroupsAssigned: number;
  created?: number;
  updated?: number;
  skipped?: number;
};

async function authFetch(path: string, init?: RequestInit) {
  const token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null;
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers || {}),
    },
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.message || `Request failed: ${res.status}`);
  return json;
}

export default function AdminSwiftImportPage() {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [committing, setCommitting] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [committedResult, setCommittedResult] = useState<PreviewResult | null>(null);

  const handlePreview = async () => {
    if (!file) return;
    setPreviewing(true);
    setPreview(null);
    setCommittedResult(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await authFetch('/admin/swift-import/preview', { method: 'POST', body: fd });
      setPreview(res.data);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Preview failed');
    } finally {
      setPreviewing(false);
    }
  };

  const handleCommit = async () => {
    if (!file || !preview) return;
    if (!confirm(
      `Import ${preview.willCreate} new + ${preview.willUpdate} updated members? Idempotent (re-runs are safe).`
    )) return;
    setCommitting(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await authFetch('/admin/swift-import/commit', { method: 'POST', body: fd });
      setCommittedResult(res.data);
      toast.success(`Imported: ${res.data.created} created, ${res.data.updated} updated`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Commit failed');
    } finally {
      setCommitting(false);
    }
  };

  return (
    <main className="p-6 max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-foreground">Swift CSV Import</h1>
        <p className="text-sm text-muted mt-0.5">
          Upload a member export from Swift (or any compatible CSV) to migrate users into PPL App.
          Idempotent: re-running the same file updates existing members.
        </p>
      </div>

      {/* File picker */}
      <div className="ppl-card mb-6">
        <label className="text-xs uppercase tracking-wider text-muted block mb-2">CSV File</label>
        <input
          type="file"
          accept=".csv,text/csv"
          onChange={(e) => { setFile(e.target.files?.[0] ?? null); setPreview(null); setCommittedResult(null); }}
          className="block w-full text-sm text-muted file:mr-4 file:py-2 file:px-4 file:rounded file:border-0 file:bg-highlight/15 file:text-accent-text hover:file:bg-highlight/25"
        />
        <div className="mt-3 flex gap-2">
          <button onClick={handlePreview} disabled={!file || previewing} className="ppl-btn ppl-btn-primary text-sm disabled:opacity-50">
            {previewing ? 'Analyzing…' : 'Preview (dry run)'}
          </button>
          {preview && (
            <button onClick={handleCommit} disabled={committing || preview.parsed === 0} className="ppl-btn text-sm bg-green-500/15 text-green-400 border border-green-500/40 hover:bg-green-500/25 disabled:opacity-50">
              {committing ? 'Importing…' : `Import ${preview.parsed} rows`}
            </button>
          )}
        </div>

        <div className="mt-4 text-[11px] text-muted">
          <strong className="text-foreground">CSV columns recognized (case-insensitive):</strong>{' '}
          <code>email</code> (required), <code>name</code> or <code>first_name</code>+<code>last_name</code>,{' '}
          <code>phone</code>, <code>plan</code>, <code>age_group</code>, <code>location</code>, <code>status</code>.
        </div>
      </div>

      {/* Preview / commit results */}
      {(preview || committedResult) && (() => {
        const result = committedResult || preview!;
        return (
          <div className="space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="ppl-card text-center">
                <p className="text-2xl font-bold text-foreground">{result.parsed}</p>
                <p className="text-xs text-muted uppercase tracking-wider mt-1">Parsed Rows</p>
              </div>
              <div className="ppl-card text-center">
                <p className="text-2xl font-bold text-accent-text">{committedResult ? committedResult.created ?? 0 : result.willCreate}</p>
                <p className="text-xs text-muted uppercase tracking-wider mt-1">{committedResult ? 'Created' : 'Will Create'}</p>
              </div>
              <div className="ppl-card text-center">
                <p className="text-2xl font-bold text-blue-400">{committedResult ? committedResult.updated ?? 0 : result.willUpdate}</p>
                <p className="text-xs text-muted uppercase tracking-wider mt-1">{committedResult ? 'Updated' : 'Will Update'}</p>
              </div>
              <div className="ppl-card text-center">
                <p className="text-2xl font-bold text-amber-400">{result.errors.length}</p>
                <p className="text-xs text-muted uppercase tracking-wider mt-1">Errors</p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="ppl-card text-center">
                <p className="text-xl font-bold text-foreground">{result.membershipsCreated}</p>
                <p className="text-xs text-muted uppercase tracking-wider mt-1">Memberships Detected</p>
              </div>
              <div className="ppl-card text-center">
                <p className="text-xl font-bold text-foreground">{result.ageGroupsAssigned}</p>
                <p className="text-xs text-muted uppercase tracking-wider mt-1">Age Groups Assigned</p>
              </div>
            </div>

            {result.preview.length > 0 && (
              <div className="ppl-card">
                <h3 className="text-xs uppercase tracking-wider text-muted font-semibold mb-3">First {result.preview.length} rows</h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-left border-b border-border">
                        <th className="px-2 py-1 font-semibold text-foreground">Email</th>
                        <th className="px-2 py-1 font-semibold text-foreground">Name</th>
                        <th className="px-2 py-1 font-semibold text-foreground">Phone</th>
                        <th className="px-2 py-1 font-semibold text-foreground">Plan</th>
                        <th className="px-2 py-1 font-semibold text-foreground">Level</th>
                        <th className="px-2 py-1 font-semibold text-foreground">Location</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.preview.map((r, i) => (
                        <tr key={i} className="border-b border-border last:border-0">
                          <td className="px-2 py-1.5 text-foreground">{r.email}</td>
                          <td className="px-2 py-1.5 text-foreground">{r.fullName}</td>
                          <td className="px-2 py-1.5 text-muted">{r.phone ?? '—'}</td>
                          <td className="px-2 py-1.5 text-muted">{r.planName ?? '—'}</td>
                          <td className="px-2 py-1.5 text-muted">{r.ageGroup ?? '—'}</td>
                          <td className="px-2 py-1.5 text-muted">{r.locationName ?? '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {result.errors.length > 0 && (
              <div className="ppl-card border-red-500/30">
                <h3 className="text-xs uppercase tracking-wider text-red-400 font-semibold mb-3">
                  Errors ({result.errors.length})
                </h3>
                <ul className="text-xs space-y-1 max-h-48 overflow-y-auto">
                  {result.errors.slice(0, 25).map((e, i) => (
                    <li key={i} className="text-red-300">
                      Row {e.row}: {e.reason}
                    </li>
                  ))}
                  {result.errors.length > 25 && (
                    <li className="text-muted">…and {result.errors.length - 25} more</li>
                  )}
                </ul>
              </div>
            )}

            {committedResult && (
              <div className="ppl-card border-green-500/30 bg-green-500/5">
                <p className="text-sm text-green-400">
                  Import complete — <strong>{committedResult.created} created</strong>,{' '}
                  <strong>{committedResult.updated} updated</strong>
                  {committedResult.skipped ? `, ${committedResult.skipped} skipped due to errors` : ''}.
                </p>
                <p className="text-xs text-muted mt-1">
                  Imported users have placeholder passwords. They'll need to use "Forgot Password" to set their own
                  before they can log in.
                </p>
              </div>
            )}
          </div>
        );
      })()}
    </main>
  );
}
