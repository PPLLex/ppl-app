'use client';

/**
 * Workflow run detail — Phase 2 (#124).
 *
 * Shows the full execution log of a single WorkflowRun. Each step entry
 * has its type, status, output/error, and timestamps. Drives the
 * "why didn't my workflow fire?" debug experience.
 */

import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/api';

type Run = NonNullable<Awaited<ReturnType<typeof api.getWorkflowRun>>['data']>;

type LogEntry = {
  stepId: string;
  type: string;
  startedAt: string;
  completedAt: string;
  ok: boolean;
  output?: unknown;
  error?: string;
};

const STATUS_STYLES: Record<string, string> = {
  PENDING: 'bg-gray-500/10 text-gray-400 border-gray-500/30',
  RUNNING: 'bg-blue-500/10 text-blue-400 border-blue-500/30',
  WAITING: 'bg-amber-500/10 text-amber-400 border-amber-500/30',
  COMPLETED: 'bg-green-500/10 text-green-400 border-green-500/30',
  FAILED: 'bg-red-500/10 text-red-400 border-red-500/30',
  CANCELLED: 'bg-gray-500/10 text-gray-500 border-gray-500/30',
};

export default function WorkflowRunDetailPage() {
  const params = useParams();
  const id = params?.id as string;
  const [run, setRun] = useState<Run | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const res = await api.getWorkflowRun(id);
      setRun(res.data ?? null);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <main className="p-6"><div className="ppl-card animate-pulse h-32" /></main>;
  if (!run) return <main className="p-6"><p className="text-muted">Run not found.</p></main>;

  const log = Array.isArray(run.log) ? (run.log as LogEntry[]) : [];

  return (
    <main className="p-6 max-w-4xl mx-auto">
      <Link href={`/admin/workflows/${run.workflow.id}`} className="text-xs text-muted hover:text-foreground inline-block mb-3">
        ← Back to {run.workflow.name}
      </Link>

      <div className="flex items-center gap-3 mb-6 flex-wrap">
        <h1 className="text-2xl font-bold text-foreground">Run Detail</h1>
        <span className={`text-[10px] uppercase tracking-wide px-2 py-0.5 rounded border ${STATUS_STYLES[run.status] ?? ''}`}>
          {run.status}
        </span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-6">
        <div className="ppl-card">
          <p className="text-[10px] uppercase tracking-wider text-muted mb-1">Trigger</p>
          <p className="text-sm text-foreground"><code className="text-accent-text">{run.workflow.trigger}</code></p>
        </div>
        <div className="ppl-card">
          <p className="text-[10px] uppercase tracking-wider text-muted mb-1">Context</p>
          <p className="text-sm text-foreground">{run.contextType}: <code className="text-xs">{run.contextId}</code></p>
        </div>
        <div className="ppl-card">
          <p className="text-[10px] uppercase tracking-wider text-muted mb-1">Started</p>
          <p className="text-sm text-foreground">{new Date(run.startedAt).toLocaleString()}</p>
        </div>
        <div className="ppl-card">
          <p className="text-[10px] uppercase tracking-wider text-muted mb-1">{run.completedAt ? 'Completed' : 'Resumes At'}</p>
          <p className="text-sm text-foreground">
            {run.completedAt
              ? new Date(run.completedAt).toLocaleString()
              : run.resumeAt
              ? new Date(run.resumeAt).toLocaleString()
              : '—'}
          </p>
        </div>
      </div>

      {run.error && (
        <div className="ppl-card mb-6 border-red-500/30 bg-red-500/5">
          <p className="text-[10px] uppercase tracking-wider text-red-400 font-semibold">Error</p>
          <p className="text-sm text-red-300 mt-1 whitespace-pre-wrap">{run.error}</p>
        </div>
      )}

      <h2 className="text-xs uppercase tracking-wider text-muted font-semibold mb-3">Step Log</h2>
      {log.length === 0 ? (
        <div className="ppl-card text-center py-6">
          <p className="text-muted text-sm">No step executions logged yet.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {log.map((entry, i) => (
            <div key={i} className={`ppl-card border-l-4 ${entry.ok ? 'border-l-green-500' : 'border-l-red-500'}`}>
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-highlight/10 text-accent-text font-bold">
                    {entry.type}
                  </span>
                  <span className={`text-[10px] uppercase tracking-wide font-semibold ${entry.ok ? 'text-green-400' : 'text-red-400'}`}>
                    {entry.ok ? 'OK' : 'Failed'}
                  </span>
                </div>
                <span className="text-[10px] text-muted">
                  {new Date(entry.startedAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit' })}
                  {' → '}
                  {new Date(entry.completedAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit' })}
                </span>
              </div>
              {entry.error && (
                <p className="text-xs text-red-400 mt-2 whitespace-pre-wrap">{entry.error}</p>
              )}
              {entry.output != null && (
                <pre className="mt-2 text-[11px] text-foreground/80 bg-background/50 p-2 rounded overflow-x-auto">
                  {JSON.stringify(entry.output, null, 2)}
                </pre>
              )}
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
