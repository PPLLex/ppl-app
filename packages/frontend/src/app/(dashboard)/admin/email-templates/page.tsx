'use client';

/**
 * Admin email template preview + test-send.
 *
 * Lets the admin pick any of the 10 role-specific invite emails, see the
 * rendered HTML in a real iframe (so the styling is honest — no global
 * CSS bleeding in), tweak the sample data, and ship a test send to their
 * own inbox to see how it lands in Gmail / Outlook / etc.
 *
 * The frame uses srcDoc instead of an `src` URL so we don't need a hosted
 * preview endpoint — the email HTML lives in memory and gets injected
 * directly into the iframe document.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { toast } from 'sonner';

type RoleOption = { role: string; label: string };

const LOCATION_SCOPED = new Set([
  'COORDINATOR',
  'PERFORMANCE_COACH',
  'CONTENT_MARKETING',
  'MEDICAL',
]);

export default function AdminEmailTemplatesPage() {
  const [roles, setRoles] = useState<RoleOption[]>([]);
  const [selectedRole, setSelectedRole] = useState<string>('');
  const [preview, setPreview] = useState<{
    subject: string;
    html: string;
    text: string;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);

  // Sample-data overrides
  const [fullName, setFullName] = useState('Sample Recipient');
  const [invitedByName, setInvitedByName] = useState('Chad Martin');
  const [locationName, setLocationName] = useState('PPL Lexington');
  const [schoolName, setSchoolName] = useState('Lafayette High School');
  const [testTo, setTestTo] = useState('');
  const [showText, setShowText] = useState(false);

  // Initial role list
  useEffect(() => {
    (async () => {
      try {
        const res = await api.listInvitableEmailRoles();
        const list = res.data || [];
        setRoles(list);
        if (list.length > 0) setSelectedRole(list[0].role);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to load template list');
      }
    })();
  }, []);

  const loadPreview = useCallback(async () => {
    if (!selectedRole) return;
    setLoading(true);
    try {
      const res = await api.previewInviteEmail(selectedRole, {
        fullName: fullName || undefined,
        invitedByName: invitedByName || undefined,
        locationName: locationName || undefined,
        schoolName: schoolName || undefined,
      });
      if (res.data) {
        setPreview({ subject: res.data.subject, html: res.data.html, text: res.data.text });
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load preview');
    } finally {
      setLoading(false);
    }
  }, [selectedRole, fullName, invitedByName, locationName, schoolName]);

  // Re-render preview whenever role or sample data changes (debounced)
  useEffect(() => {
    const t = setTimeout(loadPreview, 250);
    return () => clearTimeout(t);
  }, [loadPreview]);

  const sendTest = async () => {
    if (!selectedRole) return;
    setSending(true);
    try {
      await api.sendInviteEmailTest(selectedRole, testTo.trim() || undefined);
      toast.success(
        testTo.trim()
          ? `Test invite sent to ${testTo.trim()}`
          : 'Test invite sent to your account email'
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to send test');
    } finally {
      setSending(false);
    }
  };

  const showLocationField = useMemo(
    () => LOCATION_SCOPED.has(selectedRole),
    [selectedRole]
  );
  const showSchoolField = useMemo(() => selectedRole === 'PARTNERSHIP_COACH', [selectedRole]);

  return (
    <main className="ppl-page-root">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
        <Link href="/admin" className="text-sm text-muted hover:text-foreground">
          ← Admin
        </Link>
        <div className="mt-4 mb-6 flex items-end justify-between flex-wrap gap-3">
          <div>
            <h1 className="font-display text-2xl sm:text-3xl uppercase tracking-[0.04em] text-foreground">
              Email templates
            </h1>
            <p className="text-sm text-muted mt-1">
              Preview the role-specific invite emails before you send the real one.
              Every change here is just a preview &mdash; no real recipients are touched
              unless you click <strong className="text-foreground">Send test</strong>.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-6">
          {/* Sidebar — role picker + sample data */}
          <aside className="space-y-4">
            <section className="ppl-card">
              <h2 className="font-display text-sm uppercase tracking-[0.04em] text-foreground mb-3">
                Role
              </h2>
              <div className="space-y-1">
                {roles.map((r) => (
                  <button
                    key={r.role}
                    onClick={() => setSelectedRole(r.role)}
                    className={`w-full text-left px-3 py-2 rounded-md text-sm transition ${
                      selectedRole === r.role
                        ? 'bg-highlight/15 text-highlight-text border border-highlight/30'
                        : 'border border-transparent text-muted hover:text-foreground hover:bg-surface'
                    }`}
                  >
                    {r.label}
                  </button>
                ))}
              </div>
            </section>

            <section className="ppl-card">
              <h2 className="font-display text-sm uppercase tracking-[0.04em] text-foreground mb-3">
                Sample data
              </h2>
              <div className="space-y-3 text-sm">
                <div>
                  <label className="ppl-label">Recipient name</label>
                  <input
                    type="text"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    className="ppl-input w-full"
                  />
                </div>
                <div>
                  <label className="ppl-label">Invited by</label>
                  <input
                    type="text"
                    value={invitedByName}
                    onChange={(e) => setInvitedByName(e.target.value)}
                    className="ppl-input w-full"
                  />
                </div>
                {showLocationField && (
                  <div>
                    <label className="ppl-label">Location name</label>
                    <input
                      type="text"
                      value={locationName}
                      onChange={(e) => setLocationName(e.target.value)}
                      className="ppl-input w-full"
                    />
                  </div>
                )}
                {showSchoolField && (
                  <div>
                    <label className="ppl-label">Partner school</label>
                    <input
                      type="text"
                      value={schoolName}
                      onChange={(e) => setSchoolName(e.target.value)}
                      className="ppl-input w-full"
                    />
                  </div>
                )}
              </div>
            </section>

            <section className="ppl-card">
              <h2 className="font-display text-sm uppercase tracking-[0.04em] text-foreground mb-3">
                Send a test
              </h2>
              <p className="text-xs text-muted mb-2">
                Sends to your inbox by default; override below to send to a specific
                address (use this for testing across email clients).
              </p>
              <input
                type="email"
                value={testTo}
                onChange={(e) => setTestTo(e.target.value)}
                className="ppl-input w-full text-sm mb-3"
                placeholder="leave empty for your own inbox"
              />
              <button
                onClick={sendTest}
                disabled={sending || !selectedRole}
                className="ppl-btn ppl-btn-primary w-full text-sm disabled:opacity-60"
              >
                {sending ? 'Sending\u2026' : 'Send test'}
              </button>
            </section>
          </aside>

          {/* Preview pane */}
          <section className="space-y-3">
            <div className="ppl-card">
              <p className="text-xs uppercase tracking-[0.12em] text-muted mb-1">Subject</p>
              <p className="text-foreground font-semibold text-base">
                {preview?.subject || '\u00A0'}
              </p>
            </div>

            <div className="ppl-card overflow-hidden p-0">
              <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-surface text-xs">
                <span className="uppercase tracking-[0.12em] text-muted">
                  {showText ? 'Plain-text fallback' : 'HTML preview'}
                </span>
                <button
                  onClick={() => setShowText((v) => !v)}
                  className="text-accent-text hover:brightness-110"
                >
                  {showText ? 'Show HTML' : 'Show plain-text'}
                </button>
              </div>

              {loading && !preview ? (
                <div className="h-[600px] animate-pulse bg-surface" />
              ) : showText ? (
                <pre className="p-4 text-xs text-muted whitespace-pre-wrap min-h-[400px] max-h-[700px] overflow-auto font-mono">
                  {preview?.text || ''}
                </pre>
              ) : (
                <iframe
                  title="Email preview"
                  srcDoc={preview?.html || ''}
                  // sandbox restricts the iframe — no scripts, no top-level
                  // navigation, but allow same-origin so styles render
                  // naturally and the Google Fonts <link> can resolve.
                  sandbox="allow-same-origin"
                  className="w-full min-h-[800px] bg-white"
                />
              )}
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
