'use client';

/**
 * Compact "Recent Automations" panel — drops into any entity detail page
 * (lead, member, athlete, booking) and shows workflow runs scoped to that
 * entity. Click any row to open the full step log.
 */

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';

type ContextType = 'lead' | 'user' | 'booking' | 'athlete';
type Run = NonNullable<Awaited<ReturnType<typeof api.listWorkflowRunsForEntity>>['data']>[number];

const STATUS_STYLES: Record<string, string> = {
  PENDING: 'bg-gray-500/10 text-gray-400 border-gray-500/30',
  RUNNING: 'bg-blue-500/10 text-blue-400 border-blue-500/30',
  WAITING: 'bg-amber-500/10 text-amber-400 border-amber-500/30',
  COMPLETED: 'bg-green-500/10 text-green-400 border-green-500/30',
  FAILED: 'bg-red-500/10 text-red-400 border-red-500/30',
  CANCELLED: 'bg-gray-500/10 text-gray-500 border-gray-500/30',
};

export function EntityWorkflowRuns({ contextType, contextId }: { contextType: ContextType; contextId: string }) {
  const [runs, setRuns] = useState<Run[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.listWorkflowRunsForEntity(contextType, contextId);
      setRuns((res.data as Run[]) || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [contextType, contextId]);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return <div className="ppl-card animate-pulse h-16" />;
  }
  if (runs.length === 0) {
    return null; // Don't render an empty card — keeps detail pages tight
  }

  return (
    <div className="ppl-card">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs uppercase tracking-[0.12em] text-muted font-semibold">Recent Automations</h3>
        <span className="text-[10px] text-muted">{runs.length} run{runs.length === 1 ? '' : 's'}</span>
      </div>
      <ul className="space-y-1.5">
        {runs.slice(0, 5).map((r) => (
          <li key={r.id}>
            <Link
              href={`/admin/workflows/runs/${r.id}`}
              className="flex items-center gap-2 p-2 rounded bg-background hover:bg-surface-hover transition"
            >
              <span className={`text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded border flex-shrink-0 ${STATUS_STYLES[r.status] ?? ''}`}>
                {r.status}
              </span>
              <span className="text-xs text-foreground truncate flex-1 min-w-0">{r.workflow.name}</span>
              <span className="text-[10px] text-muted flex-shrink-0">
                {new Date(r.startedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
              </span>
            </Link>
          </li>
        ))}
      </ul>
      {runs.length > 5 && (
        <p className="text-[11px] text-muted text-center mt-2">+ {runs.length - 5} more</p>
      )}
    </div>
  );
}
