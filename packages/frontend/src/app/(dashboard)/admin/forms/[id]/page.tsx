'use client';

/**
 * Form detail — edit + view submissions + send manually.
 */

import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { FormBuilder, type FormPayload } from '../_FormBuilder';

type FormDetail = NonNullable<Awaited<ReturnType<typeof api.getMarketingForm>>['data']>;
type Submission = NonNullable<Awaited<ReturnType<typeof api.listMarketingFormSubmissions>>['data']>[number];

export default function FormDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;
  const [form, setForm] = useState<FormDetail | null>(null);
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [tab, setTab] = useState<'edit' | 'submissions' | 'send'>('edit');
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendList, setSendList] = useState('');

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const [a, b] = await Promise.all([
        api.getMarketingForm(id),
        api.listMarketingFormSubmissions(id),
      ]);
      setForm(a.data as FormDetail);
      setSubmissions((b.data as Submission[]) || []);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load');
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!form) {
    return <div className="text-muted">Loading…</div>;
  }

  const handleSave = async (payload: FormPayload) => {
    if (!id) return;
    setSaving(true);
    try {
      await api.updateMarketingForm(id, payload as unknown as Record<string, unknown>);
      toast.success('Saved');
      void load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const handleSend = async () => {
    if (!id) return;
    const recipients = sendList
      .split(/[,\n]/)
      .map((s) => s.trim())
      .filter((s) => s.includes('@'))
      .map((email) => ({ email }));
    if (recipients.length === 0) {
      toast.error('Add at least one valid email');
      return;
    }
    setSending(true);
    try {
      const res = await api.sendMarketingForm(id, recipients);
      toast.success(`Sent ${res.data?.sent.length ?? 0} email(s)${res.data?.failed.length ? `, ${res.data.failed.length} failed` : ''}`);
      setSendList('');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Send failed');
    } finally {
      setSending(false);
    }
  };

  const baseUrl = typeof window !== 'undefined' ? window.location.origin : '';
  const publicUrl = `${baseUrl}/f/${form.slug}`;

  return (
    <div>
      <div className="mb-6">
        <Link href="/admin/forms" className="text-sm text-muted hover:text-foreground">
          ← Back to forms
        </Link>
        <div className="flex items-center justify-between mt-2 flex-wrap gap-3">
          <h1 className="text-2xl font-bold text-foreground">{form.name}</h1>
          <a
            href={publicUrl}
            target="_blank"
            rel="noreferrer"
            className="text-sm text-highlight hover:underline"
          >
            Open public link →
          </a>
        </div>
        <p className="text-xs text-muted font-mono mt-1">{publicUrl}</p>
      </div>

      <div className="flex gap-2 mb-6 border-b border-border">
        {(['edit', 'submissions', 'send'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm capitalize border-b-2 transition ${
              tab === t
                ? 'border-highlight text-foreground'
                : 'border-transparent text-muted hover:text-foreground'
            }`}
          >
            {t === 'submissions' ? `Submissions (${submissions.length})` : t}
          </button>
        ))}
      </div>

      {tab === 'edit' && (
        <FormBuilder
          initial={{
            name: form.name,
            slug: form.slug,
            description: form.description ?? undefined,
            fields: form.fields,
            submitMessage: form.submitMessage ?? undefined,
            redirectUrl: form.redirectUrl ?? undefined,
            collectEmail: form.collectEmail,
            collectName: form.collectName,
            isPublic: form.isPublic,
            trigger: form.trigger,
            triggerDelayHours: form.triggerDelayHours,
            autoCreateLead: form.autoCreateLead,
            autoTagIds: form.autoTagIds || [],
          }}
          onSave={handleSave}
          saving={saving}
          publicUrlBase={baseUrl}
          draftKey={form.id}
        />
      )}

      {tab === 'submissions' && (
        <div>
          {submissions.length === 0 ? (
            <p className="text-muted">No submissions yet.</p>
          ) : (
            <div className="space-y-3">
              {submissions.map((s) => (
                <div key={s.id} className="bg-surface border border-border rounded-xl p-5">
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <p className="font-semibold text-foreground">
                        {s.submitterName || 'Anonymous'}
                      </p>
                      <p className="text-xs text-muted">
                        {s.submitterEmail || 'no email'} ·{' '}
                        {new Date(s.submittedAt).toLocaleString()}
                      </p>
                    </div>
                    {s.lead && (
                      <Link
                        href={`/admin/crm/${s.lead.id}`}
                        className="text-xs px-2 py-1 rounded bg-blue-500/20 text-blue-400 hover:bg-blue-500/30"
                      >
                        View Lead
                      </Link>
                    )}
                    {s.user && (
                      <Link
                        href={`/admin/members/${s.user.id}`}
                        className="text-xs px-2 py-1 rounded bg-green-500/20 text-green-400 hover:bg-green-500/30"
                      >
                        View Member
                      </Link>
                    )}
                  </div>
                  <dl className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-2 text-sm">
                    {Object.entries(s.payload).map(([k, v]) => (
                      <div key={k}>
                        <dt className="text-xs text-muted uppercase tracking-wide">{k}</dt>
                        <dd className="text-foreground">
                          {Array.isArray(v) ? v.join(', ') : String(v ?? '—')}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'send' && (
        <div className="bg-surface border border-border rounded-xl p-6 max-w-2xl">
          <h2 className="text-lg font-bold mb-2">Send this form</h2>
          <p className="text-sm text-muted mb-4">
            Email the form link to one or more people. Paste emails separated by commas or
            new lines.
          </p>
          <textarea
            value={sendList}
            onChange={(e) => setSendList(e.target.value)}
            rows={6}
            className="ppl-input"
            placeholder={'parent1@example.com\nparent2@example.com'}
          />
          <button
            onClick={handleSend}
            disabled={sending}
            className="ppl-btn ppl-btn-primary mt-4"
          >
            {sending ? 'Sending…' : 'Send Form'}
          </button>
        </div>
      )}
    </div>
  );
}
