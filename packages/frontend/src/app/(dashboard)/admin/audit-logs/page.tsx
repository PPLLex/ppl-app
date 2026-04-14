'use client';

import { useState, useEffect, useCallback } from 'react';
import { api, AuditLogEntry } from '@/lib/api';

const ACTION_COLORS: Record<string, string> = {
  CREATE: 'bg-green-500/10 text-green-400 border border-green-500/20',
  UPDATE: 'bg-blue-500/10 text-blue-400 border border-blue-500/20',
  DELETE: 'bg-red-500/10 text-red-400 border border-red-500/20',
  LOGIN: 'bg-purple-500/10 text-purple-400 border border-purple-500/20',
  CANCEL: 'bg-orange-500/10 text-orange-400 border border-orange-500/20',
};

const RESOURCE_TYPES = [
  'USER', 'MEMBERSHIP', 'BOOKING', 'SESSION', 'LOCATION', 'PLAN', 'PAYMENT',
];

const ACTIONS = ['CREATE', 'UPDATE', 'DELETE', 'LOGIN', 'CANCEL'];

export default function AuditLogsPage() {
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [actionFilter, setActionFilter] = useState('');
  const [resourceFilter, setResourceFilter] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await api.getAuditLogs({
        page,
        action: actionFilter || undefined,
        resourceType: resourceFilter || undefined,
      });
      if (res.data) setLogs(res.data);
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  }, [page, actionFilter, resourceFilter]);

  useEffect(() => {
    load();
  }, [load]);

  const formatTime = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  };

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-foreground">Audit Log</h1>
        <p className="text-sm text-muted mt-0.5">Track all system changes and user actions</p>
      </div>

      {/* Filters */}
      <div className="flex gap-3 mb-4">
        <select
          value={actionFilter}
          onChange={(e) => { setActionFilter(e.target.value); setPage(1); }}
          className="ppl-input w-auto text-sm"
        >
          <option value="">All Actions</option>
          {ACTIONS.map((a) => (
            <option key={a} value={a}>{a}</option>
          ))}
        </select>
        <select
          value={resourceFilter}
          onChange={(e) => { setResourceFilter(e.target.value); setPage(1); }}
          className="ppl-input w-auto text-sm"
        >
          <option value="">All Resources</option>
          {RESOURCE_TYPES.map((r) => (
            <option key={r} value={r}>{r}</option>
          ))}
        </select>
      </div>

      {/* Log Entries */}
      {isLoading ? (
        <div className="space-y-2">
          {[1, 2, 3, 4, 5].map((n) => (
            <div key={n} className="ppl-card animate-pulse h-16" />
          ))}
        </div>
      ) : logs.length > 0 ? (
        <div className="space-y-1">
          {logs.map((log) => (
            <div key={log.id} className="ppl-card">
              <button
                onClick={() => setExpandedId(expandedId === log.id ? null : log.id)}
                className="w-full flex items-center gap-3 text-left"
              >
                {/* Action Badge */}
                <span
                  className={`ppl-badge text-xs flex-shrink-0 ${
                    ACTION_COLORS[log.action] || 'bg-surface text-muted'
                  }`}
                >
                  {log.action}
                </span>

                {/* Resource */}
                <span className="text-sm font-medium text-foreground flex-shrink-0">
                  {log.resourceType}
                </span>

                {log.resourceId && (
                  <span className="text-xs text-muted font-mono truncate max-w-[120px]">
                    {log.resourceId.slice(0, 8)}...
                  </span>
                )}

                {/* User */}
                <span className="text-sm text-muted ml-auto flex-shrink-0">
                  {log.userName}
                  {log.userRole && (
                    <span className="text-xs text-muted/60 ml-1">({log.userRole})</span>
                  )}
                </span>

                {/* Time */}
                <span className="text-xs text-muted flex-shrink-0">{formatTime(log.createdAt)}</span>

                {/* Expand indicator */}
                {log.changes && (
                  <svg
                    className={`w-4 h-4 text-muted transition-transform ${
                      expandedId === log.id ? 'rotate-180' : ''
                    }`}
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                  </svg>
                )}
              </button>

              {/* Expanded Changes */}
              {expandedId === log.id && log.changes && (
                <div className="mt-3 pt-3 border-t border-border">
                  <pre className="text-xs text-muted font-mono bg-background rounded-lg p-3 overflow-x-auto">
                    {JSON.stringify(log.changes, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          ))}

          {/* Pagination */}
          <div className="flex items-center justify-center gap-2 pt-4">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className="ppl-btn ppl-btn-secondary text-xs disabled:opacity-30"
            >
              Previous
            </button>
            <span className="text-sm text-muted">Page {page}</span>
            <button
              onClick={() => setPage((p) => p + 1)}
              disabled={logs.length < 50}
              className="ppl-btn ppl-btn-secondary text-xs disabled:opacity-30"
            >
              Next
            </button>
          </div>
        </div>
      ) : (
        <div className="ppl-card text-center py-12">
          <p className="text-muted">No audit log entries found</p>
        </div>
      )}
    </div>
  );
}
