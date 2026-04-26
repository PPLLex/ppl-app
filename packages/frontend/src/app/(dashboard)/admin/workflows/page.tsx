'use client';

/**
 * Workflows list — Phase 2 surface for the workflow engine I shipped.
 *
 * Each row links to the editor where the admin builds the step chain.
 * "+ New Workflow" prompts for name + trigger and creates a draft.
 */

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { api } from '@/lib/api';

type Workflow = NonNullable<Awaited<ReturnType<typeof api.listWorkflows>>['data']>[number];

const TRIGGERS = [
  { value: 'BOOKING_CREATED', label: 'When a booking is created' },
  { value: 'BOOKING_CANCELLED', label: 'When a booking is cancelled' },
  { value: 'BOOKING_COMPLETED', label: 'When a session is marked completed' },
  { value: 'BOOKING_NO_SHOW', label: 'When a session is marked no-show' },
  { value: 'LEAD_CREATED', label: 'When a new lead is created' },
  { value: 'LEAD_STAGE_CHANGED', label: 'When a lead changes stage' },
  { value: 'LEAD_FORM_SUBMITTED', label: 'When a public form is submitted' },
  { value: 'USER_REGISTERED', label: 'When a new account is registered' },
  { value: 'MEMBER_PAYMENT_FAILED', label: 'When a payment fails' },
  { value: 'MEMBER_PAYMENT_SUCCEEDED', label: 'When a payment succeeds' },
  { value: 'MEMBER_BIRTHDAY', label: 'On a member\'s birthday' },
  { value: 'MEMBER_TRIAL_ENDING', label: 'When a trial is ending' },
  { value: 'MEMBER_CHURNED', label: 'When a member churns' },
  { value: 'MANUAL', label: 'Manual trigger only' },
  { value: 'SCHEDULED', label: 'On a schedule (cron)' },
];

export default function AdminWorkflowsPage() {
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNewModal, setShowNewModal] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.listWorkflows();
      setWorkflows((res.data as Workflow[]) || []);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load workflows');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <main className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Workflows</h1>
          <p className="text-sm text-muted mt-0.5">
            Build automations that fire on PPL events. Each workflow chains steps (email, SMS, wait, tag, branch, webhook).
          </p>
        </div>
        <button onClick={() => setShowNewModal(true)} className="ppl-btn ppl-btn-primary text-sm">+ New Workflow</button>
      </div>

      {loading ? (
        <div className="space-y-2">{[1, 2, 3].map((i) => <div key={i} className="ppl-card animate-pulse h-20" />)}</div>
      ) : workflows.length === 0 ? (
        <div className="ppl-card text-center py-12">
          <p className="text-muted text-sm">No workflows yet. Click "New Workflow" to build your first automation.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {workflows.map((w) => (
            <Link
              key={w.id}
              href={`/admin/workflows/${w.id}`}
              className="ppl-card flex items-center gap-4 hover:border-highlight/40 transition flex-wrap"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="font-semibold text-foreground text-sm">{w.name}</h3>
                  {w.isActive ? (
                    <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-green-500/10 text-green-400 border border-green-500/30">
                      Active
                    </span>
                  ) : (
                    <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-gray-500/10 text-gray-400 border border-gray-500/30">
                      Disabled
                    </span>
                  )}
                </div>
                <p className="text-xs text-muted mt-0.5">
                  Trigger: <code className="text-accent-text">{w.trigger}</code>
                </p>
                {w.description && <p className="text-xs text-foreground/80 mt-1 truncate">{w.description}</p>}
              </div>
              <div className="text-right text-[11px] text-muted flex-shrink-0">
                <div>{w._count?.steps ?? 0} steps</div>
                <div>{w._count?.runs ?? 0} runs</div>
              </div>
            </Link>
          ))}
        </div>
      )}

      {showNewModal && <NewWorkflowModal triggers={TRIGGERS} onClose={() => setShowNewModal(false)} onCreated={async () => { setShowNewModal(false); await load(); }} />}
    </main>
  );
}

function NewWorkflowModal({
  triggers,
  onClose,
  onCreated,
}: {
  triggers: { value: string; label: string }[];
  onClose: () => void;
  onCreated: () => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [trigger, setTrigger] = useState('BOOKING_CREATED');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSubmitting(true);
    try {
      const res = await api.createWorkflow({
        name: name.trim(),
        description: description.trim() || undefined,
        trigger,
      });
      toast.success('Workflow created — add steps next');
      void res; // navigate to detail in onCreated callback
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
          <h2 className="text-lg font-bold text-foreground">New Workflow</h2>
        </div>
        <form onSubmit={handleSubmit} className="p-5 space-y-3">
          <div>
            <label className="text-xs text-muted uppercase tracking-wider">Name</label>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} required className="ppl-input w-full mt-1" placeholder="e.g. Welcome new members" />
          </div>
          <div>
            <label className="text-xs text-muted uppercase tracking-wider">Description (optional)</label>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} className="ppl-input w-full mt-1" />
          </div>
          <div>
            <label className="text-xs text-muted uppercase tracking-wider">Trigger</label>
            <select value={trigger} onChange={(e) => setTrigger(e.target.value)} className="ppl-input w-full mt-1">
              {triggers.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
          <div className="flex gap-2 justify-end pt-2">
            <button type="button" onClick={onClose} className="ppl-btn ppl-btn-secondary text-sm">Cancel</button>
            <button type="submit" disabled={submitting || !name.trim()} className="ppl-btn ppl-btn-primary text-sm disabled:opacity-50">
              {submitting ? 'Creating…' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
