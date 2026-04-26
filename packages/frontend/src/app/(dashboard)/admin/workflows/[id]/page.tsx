'use client';

/**
 * Workflow editor — chains steps for a single workflow. Pragmatic UI:
 * each step is a card with type-aware config. Reorder by editing
 * displayOrder. nextStepId chain is currently linear (next-in-list);
 * BRANCH steps explicitly point at trueNextStepId/falseNextStepId in
 * config.
 */

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { toast } from 'sonner';
import { api } from '@/lib/api';

type WorkflowDetail = NonNullable<Awaited<ReturnType<typeof api.getWorkflow>>['data']>;
type Step = WorkflowDetail['steps'][number];
type Run = WorkflowDetail['runs'][number];

const STEP_TYPES = [
  { value: 'WAIT', label: 'Wait', summary: 'Pause for X hours/days' },
  { value: 'SEND_EMAIL', label: 'Send Email', summary: 'Templated email to the context user' },
  { value: 'SEND_SMS', label: 'Send SMS', summary: 'Templated SMS to the context phone' },
  { value: 'SEND_NOTIFICATION', label: 'In-App Notification', summary: 'Push notification' },
  { value: 'ADD_TAG', label: 'Add Tag', summary: 'Attach a tag to the context entity' },
  { value: 'REMOVE_TAG', label: 'Remove Tag', summary: 'Detach a tag from the context entity' },
  { value: 'UPDATE_LEAD_STAGE', label: 'Update Lead Stage', summary: 'Move a lead to a different stage' },
  { value: 'UPDATE_LEAD_FIELD', label: 'Update Lead Fields', summary: 'Bulk patch lead fields' },
  { value: 'ASSIGN_OWNER', label: 'Assign Owner', summary: 'Set the lead\'s owner' },
  { value: 'SEND_WEBHOOK', label: 'Send Webhook', summary: 'POST to an external URL' },
  { value: 'BRANCH', label: 'Branch', summary: 'Take a different path based on a condition' },
  { value: 'END', label: 'End', summary: 'Explicitly terminate the run' },
];

const STATUS_STYLES: Record<string, string> = {
  PENDING: 'bg-gray-500/10 text-gray-400 border-gray-500/30',
  RUNNING: 'bg-blue-500/10 text-blue-400 border-blue-500/30',
  WAITING: 'bg-amber-500/10 text-amber-400 border-amber-500/30',
  COMPLETED: 'bg-green-500/10 text-green-400 border-green-500/30',
  FAILED: 'bg-red-500/10 text-red-400 border-red-500/30',
  CANCELLED: 'bg-gray-500/10 text-gray-500 border-gray-500/30',
};

export default function AdminWorkflowDetail() {
  const params = useParams();
  const router = useRouter();
  const id = params?.id as string;

  const [wf, setWf] = useState<WorkflowDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [editingMeta, setEditingMeta] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const res = await api.getWorkflow(id);
      if (res.data) {
        setWf(res.data);
        setName(res.data.name);
        setDescription(res.data.description ?? '');
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const handleSaveMeta = async () => {
    if (!wf) return;
    try {
      await api.updateWorkflow(wf.id, { name, description });
      toast.success('Saved');
      setEditingMeta(false);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Save failed');
    }
  };

  const handleToggleActive = async () => {
    if (!wf) return;
    try {
      await api.updateWorkflow(wf.id, { isActive: !wf.isActive });
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed');
    }
  };

  const handleDelete = async () => {
    if (!wf) return;
    if (!confirm(`Delete "${wf.name}"? Removes all steps and run history.`)) return;
    try {
      await api.deleteWorkflow(wf.id);
      toast.success('Deleted');
      router.push('/admin/workflows');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Delete failed');
    }
  };

  const handleAddStep = async (type: string) => {
    if (!wf) return;
    try {
      const newOrder = (wf.steps[wf.steps.length - 1]?.displayOrder ?? 0) + 1;
      await api.addWorkflowStep(wf.id, {
        type,
        config: defaultConfigForType(type),
        displayOrder: newOrder,
      });
      // Wire prior step's nextStepId → new step (linear chain)
      const lastStep = wf.steps[wf.steps.length - 1];
      const refreshed = await api.getWorkflow(wf.id);
      const newStep = refreshed.data?.steps.slice(-1)[0];
      if (lastStep && newStep) {
        await api.updateWorkflowStep(lastStep.id, { nextStepId: newStep.id });
      }
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed');
    }
  };

  if (loading) return <main className="p-6"><div className="ppl-card animate-pulse h-32" /></main>;
  if (!wf) return <main className="p-6"><p className="text-muted">Workflow not found.</p></main>;

  return (
    <main className="p-6 max-w-5xl mx-auto">
      <Link href="/admin/workflows" className="text-xs text-muted hover:text-foreground inline-block mb-3">
        ← All workflows
      </Link>

      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap mb-6">
        <div className="flex-1 min-w-0">
          {editingMeta ? (
            <div className="space-y-2">
              <input value={name} onChange={(e) => setName(e.target.value)} className="ppl-input w-full text-lg font-bold" />
              <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} className="ppl-input w-full text-sm" />
              <div className="flex gap-2">
                <button onClick={handleSaveMeta} className="ppl-btn ppl-btn-primary text-xs">Save</button>
                <button onClick={() => setEditingMeta(false)} className="ppl-btn ppl-btn-secondary text-xs">Cancel</button>
              </div>
            </div>
          ) : (
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-2xl font-bold text-foreground">{wf.name}</h1>
                {wf.isActive ? (
                  <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-green-500/10 text-green-400 border border-green-500/30">Active</span>
                ) : (
                  <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-gray-500/10 text-gray-400 border border-gray-500/30">Disabled</span>
                )}
              </div>
              <p className="text-sm text-muted mt-1">
                Trigger: <code className="text-accent-text">{wf.trigger}</code>
              </p>
              {wf.description && <p className="text-sm text-foreground/80 mt-2">{wf.description}</p>}
              <button onClick={() => setEditingMeta(true)} className="text-xs text-accent-text hover:underline mt-2">Edit name + description</button>
            </div>
          )}
        </div>
        <div className="flex gap-2 flex-shrink-0">
          <button onClick={handleToggleActive} className="ppl-btn ppl-btn-secondary text-xs">
            {wf.isActive ? 'Disable' : 'Enable'}
          </button>
          <button onClick={handleDelete} className="ppl-btn text-xs bg-red-500/10 text-red-400 border border-red-500/20">
            Delete
          </button>
        </div>
      </div>

      {/* Step chain */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-3">
          <h2 className="text-xs uppercase tracking-wider text-muted font-semibold">Steps</h2>
          {wf.steps.length === 0 ? (
            <div className="ppl-card text-center py-8">
              <p className="text-muted text-sm mb-3">No steps yet — pick one to add.</p>
            </div>
          ) : (
            wf.steps
              .slice()
              .sort((a, b) => a.displayOrder - b.displayOrder)
              .map((step, i) => (
                <div key={step.id}>
                  {i > 0 && (
                    <div className="text-center text-muted text-xs py-1">↓</div>
                  )}
                  <StepCard step={step} onChanged={load} />
                </div>
              ))
          )}

          {/* Add step palette */}
          <div className="ppl-card bg-background/40">
            <p className="text-xs uppercase tracking-wider text-muted font-semibold mb-2">+ Add step</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
              {STEP_TYPES.map((t) => (
                <button
                  key={t.value}
                  onClick={() => handleAddStep(t.value)}
                  className="text-left bg-background border border-border rounded p-2 hover:border-accent-text transition"
                >
                  <p className="text-xs font-semibold text-foreground">{t.label}</p>
                  <p className="text-[10px] text-muted mt-0.5">{t.summary}</p>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Run history sidebar */}
        <div>
          <h2 className="text-xs uppercase tracking-wider text-muted font-semibold mb-2">Recent Runs</h2>
          {wf.runs.length === 0 ? (
            <div className="ppl-card text-center py-6">
              <p className="text-muted text-xs">No runs yet.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {wf.runs.slice(0, 25).map((r) => <RunCard key={r.id} run={r} />)}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}

function StepCard({ step, onChanged }: { step: Step; onChanged: () => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [config, setConfig] = useState<string>(JSON.stringify(step.config, null, 2));
  const [saving, setSaving] = useState(false);

  const meta = STEP_TYPES.find((t) => t.value === step.type);

  const handleSave = async () => {
    setSaving(true);
    try {
      const parsed = JSON.parse(config);
      await api.updateWorkflowStep(step.id, { config: parsed });
      toast.success('Step updated');
      setEditing(false);
      await onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Invalid JSON or save failed');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm(`Delete this ${meta?.label ?? step.type} step?`)) return;
    try {
      await api.deleteWorkflowStep(step.id);
      toast.success('Step deleted');
      await onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Delete failed');
    }
  };

  return (
    <div className="ppl-card">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-highlight/15 text-accent-text border border-highlight/40 font-bold">
            {step.type}
          </span>
          <span className="text-xs text-muted">{meta?.summary ?? ''}</span>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setEditing(!editing)} className="text-[11px] text-accent-text hover:underline">
            {editing ? 'Cancel' : 'Edit'}
          </button>
          <button onClick={handleDelete} className="text-[11px] text-red-400 hover:underline">Delete</button>
        </div>
      </div>

      {editing ? (
        <div className="mt-3">
          <label className="text-[10px] uppercase tracking-wider text-muted">Config (JSON)</label>
          <textarea
            value={config}
            onChange={(e) => setConfig(e.target.value)}
            rows={Math.max(4, config.split('\n').length)}
            className="ppl-input w-full mt-1 font-mono text-xs"
          />
          <button onClick={handleSave} disabled={saving} className="ppl-btn ppl-btn-primary text-xs mt-2 disabled:opacity-50">
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      ) : (
        <pre className="mt-2 text-[11px] text-foreground/80 bg-background/50 p-2 rounded overflow-x-auto">
          {JSON.stringify(step.config, null, 2)}
        </pre>
      )}
    </div>
  );
}

function RunCard({ run }: { run: Run }) {
  const status = run.status;
  return (
    <Link
      href={`/admin/workflows/runs/${run.id}`}
      className="block ppl-card hover:border-highlight/40 transition"
    >
      <div className="flex items-center justify-between">
        <span className={`text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded border ${STATUS_STYLES[status] ?? ''}`}>
          {status}
        </span>
        <span className="text-[10px] text-muted">
          {new Date(run.startedAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
        </span>
      </div>
      <p className="text-[11px] text-muted mt-1">
        {run.contextType}: {run.contextId.slice(0, 8)}…
      </p>
      {run.error && <p className="text-[10px] text-red-400 mt-1 truncate">{run.error}</p>}
    </Link>
  );
}

function defaultConfigForType(type: string): Record<string, unknown> {
  switch (type) {
    case 'WAIT': return { hours: 24 };
    case 'SEND_EMAIL': return { subject: '', html: '<p>Hey {{firstName}},</p>' };
    case 'SEND_SMS': return { body: 'Hey {{firstName}}, ...' };
    case 'SEND_NOTIFICATION': return { title: '', body: '' };
    case 'ADD_TAG':
    case 'REMOVE_TAG': return { tagId: '' };
    case 'UPDATE_LEAD_STAGE': return { stage: 'CONTACTED' };
    case 'UPDATE_LEAD_FIELD': return { data: {} };
    case 'ASSIGN_OWNER': return { ownerUserId: '' };
    case 'SEND_WEBHOOK': return { url: '', method: 'POST' };
    case 'BRANCH': return { conditionField: '', operator: 'eq', value: '', trueNextStepId: '', falseNextStepId: '' };
    case 'END': return {};
    default: return {};
  }
}
