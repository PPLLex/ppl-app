'use client';

/**
 * Outbound webhooks admin — Phase 2 (#43 surface).
 *
 * List + create + test outbound webhooks. Each webhook subscribes to one
 * or more WorkflowTrigger events and receives an HMAC-signed POST whenever
 * those events fire.
 */

import { useEffect, useState, useCallback } from 'react';
import { toast } from 'sonner';
import { api } from '@/lib/api';

type Webhook = NonNullable<Awaited<ReturnType<typeof api.listOutboundWebhooks>>['data']>[number];

const ALL_EVENTS = [
  'BOOKING_CREATED',
  'BOOKING_CANCELLED',
  'BOOKING_COMPLETED',
  'BOOKING_NO_SHOW',
  'LEAD_CREATED',
  'LEAD_STAGE_CHANGED',
  'LEAD_FORM_SUBMITTED',
  'MEMBER_PAYMENT_FAILED',
  'MEMBER_PAYMENT_SUCCEEDED',
  'MEMBER_BIRTHDAY',
  'MEMBER_TRIAL_ENDING',
  'MEMBER_CHURNED',
];

export default function AdminWebhooksPage() {
  const [webhooks, setWebhooks] = useState<Webhook[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNewModal, setShowNewModal] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.listOutboundWebhooks();
      setWebhooks((res.data as Webhook[]) || []);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <main className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Outbound Webhooks</h1>
          <p className="text-sm text-muted mt-0.5">
            Send HMAC-signed POSTs to external systems (Zapier, Make, your own backend) when PPL events fire.
          </p>
        </div>
        <button onClick={() => setShowNewModal(true)} className="ppl-btn ppl-btn-primary text-sm">+ New Webhook</button>
      </div>

      {loading ? (
        <div className="space-y-2">{[1, 2, 3].map((i) => <div key={i} className="ppl-card animate-pulse h-24" />)}</div>
      ) : webhooks.length === 0 ? (
        <div className="ppl-card text-center py-12">
          <p className="text-muted text-sm">
            No webhooks yet. Click "New Webhook" to subscribe an external URL to PPL events.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {webhooks.map((w) => <WebhookCard key={w.id} webhook={w} onChanged={load} />)}
        </div>
      )}

      {showNewModal && <NewWebhookModal onClose={() => setShowNewModal(false)} onCreated={async () => { setShowNewModal(false); await load(); }} />}
    </main>
  );
}

function WebhookCard({ webhook, onChanged }: { webhook: Webhook; onChanged: () => Promise<void> }) {
  const [revealedSecret, setRevealedSecret] = useState(false);
  const [testing, setTesting] = useState(false);

  const handleTest = async () => {
    setTesting(true);
    try {
      const res = await api.testOutboundWebhook(webhook.id);
      const status = res.data?.statusCode;
      if (status && status >= 200 && status < 300) {
        toast.success(`Test ping returned HTTP ${status}`);
      } else {
        toast.error(res.data?.error || `Test ping returned HTTP ${status ?? '???'}`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Test failed');
    } finally {
      setTesting(false);
    }
  };

  const handleToggleActive = async () => {
    try {
      await api.updateOutboundWebhook(webhook.id, { isActive: !webhook.isActive });
      toast.success(webhook.isActive ? 'Disabled' : 'Enabled');
      await onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed');
    }
  };

  const handleRotate = async () => {
    if (!confirm('Generate a new signing secret? Your receiver will need to be updated with the new value.')) return;
    try {
      await api.rotateOutboundWebhookSecret(webhook.id);
      toast.success('New secret generated — refresh to view');
      await onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed');
    }
  };

  const handleDelete = async () => {
    if (!confirm(`Delete "${webhook.name}"?`)) return;
    try {
      await api.deleteOutboundWebhook(webhook.id);
      toast.success('Webhook deleted');
      await onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed');
    }
  };

  return (
    <div className={`ppl-card ${webhook.isActive ? '' : 'opacity-60'}`}>
      <div className="flex items-start gap-3 flex-wrap">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-semibold text-foreground text-sm">{webhook.name}</h3>
            {webhook.isActive ? (
              <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-green-500/10 text-green-400 border border-green-500/30">
                Active
              </span>
            ) : (
              <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-gray-500/10 text-gray-400 border border-gray-500/30">
                Disabled
              </span>
            )}
            {webhook.consecutiveFailures > 0 && (
              <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-red-500/10 text-red-400 border border-red-500/30">
                {webhook.consecutiveFailures} consecutive fails
              </span>
            )}
          </div>
          <code className="text-xs text-muted block mt-1 truncate">{webhook.url}</code>
          <div className="text-[11px] text-muted mt-1 flex flex-wrap gap-1">
            {webhook.events.map((e) => (
              <span key={e} className="bg-background px-1.5 py-0.5 rounded">{e}</span>
            ))}
          </div>
          {webhook.lastSuccessAt && (
            <p className="text-[11px] text-muted mt-1">
              Last successful delivery: {new Date(webhook.lastSuccessAt).toLocaleString()}
            </p>
          )}

          <div className="mt-2 text-[11px]">
            <span className="text-muted">Signing secret: </span>
            {revealedSecret ? (
              <code className="text-amber-400 break-all">{webhook.secret}</code>
            ) : (
              <button onClick={() => setRevealedSecret(true)} className="text-accent-text hover:underline">
                Reveal
              </button>
            )}
          </div>
        </div>
        <div className="flex flex-col gap-1 flex-shrink-0">
          <button onClick={handleTest} disabled={testing} className="ppl-btn ppl-btn-secondary text-xs disabled:opacity-50">
            {testing ? 'Pinging…' : 'Test'}
          </button>
          <button onClick={handleToggleActive} className="text-[11px] text-accent-text hover:underline">
            {webhook.isActive ? 'Disable' : 'Enable'}
          </button>
          <button onClick={handleRotate} className="text-[11px] text-amber-400 hover:underline">
            Rotate secret
          </button>
          <button onClick={handleDelete} className="text-[11px] text-red-400 hover:underline">
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}

function NewWebhookModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => Promise<void> }) {
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [selectedEvents, setSelectedEvents] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const toggle = (e: string) => {
    setSelectedEvents((prev) => prev.includes(e) ? prev.filter((x) => x !== e) : [...prev, e]);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !url.trim() || selectedEvents.length === 0) return;
    setSubmitting(true);
    try {
      await api.createOutboundWebhook({ name: name.trim(), url: url.trim(), events: selectedEvents });
      toast.success('Webhook created');
      await onCreated();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4 overflow-y-auto" onClick={onClose}>
      <div className="bg-surface border border-border rounded-xl max-w-md w-full my-auto" onClick={(e) => e.stopPropagation()}>
        <div className="p-5 border-b border-border">
          <h2 className="text-lg font-bold text-foreground">New Outbound Webhook</h2>
        </div>
        <form onSubmit={handleSubmit} className="p-5 space-y-3">
          <div>
            <label className="text-xs text-muted uppercase tracking-wider">Friendly Name</label>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} required className="ppl-input w-full mt-1" placeholder="Zapier — new lead → Slack" />
          </div>
          <div>
            <label className="text-xs text-muted uppercase tracking-wider">URL</label>
            <input type="url" value={url} onChange={(e) => setUrl(e.target.value)} required className="ppl-input w-full mt-1" placeholder="https://hooks.zapier.com/..." />
          </div>
          <div>
            <label className="text-xs text-muted uppercase tracking-wider">Events to Subscribe</label>
            <div className="mt-1 space-y-1 max-h-64 overflow-y-auto">
              {ALL_EVENTS.map((e) => (
                <label key={e} className="flex items-center gap-2 text-xs text-foreground">
                  <input type="checkbox" checked={selectedEvents.includes(e)} onChange={() => toggle(e)} className="rounded" />
                  <code>{e}</code>
                </label>
              ))}
            </div>
          </div>
          <div className="flex gap-2 justify-end pt-2">
            <button type="button" onClick={onClose} className="ppl-btn ppl-btn-secondary text-sm">Cancel</button>
            <button type="submit" disabled={submitting || !name.trim() || !url.trim() || selectedEvents.length === 0} className="ppl-btn ppl-btn-primary text-sm disabled:opacity-50">
              {submitting ? 'Creating…' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
