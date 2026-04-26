'use client';

/**
 * Admin Marketing Forms — list + create.
 *
 * Lists every form in the org with submission count + public URL +
 * active status. Provides the "New Form" CTA which opens the builder
 * at /admin/forms/new. Each row links to the builder + submission viewer.
 */

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { api } from '@/lib/api';

type Form = NonNullable<Awaited<ReturnType<typeof api.listMarketingForms>>['data']>[number];

const TRIGGER_LABELS: Record<string, string> = {
  MANUAL: 'Manual send',
  POST_BOOKING_COMPLETE: 'After booking',
  POST_FIRST_SESSION: 'After first session',
  POST_MEMBERSHIP_START: 'After membership start',
  POST_LEAD_CREATED: 'After lead created',
};

export default function AdminFormsPage() {
  const [forms, setForms] = useState<Form[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.listMarketingForms();
      setForms((res.data as Form[]) || []);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load forms');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Delete "${name}"? This deletes all submissions too.`)) return;
    try {
      await api.deleteMarketingForm(id);
      toast.success('Form deleted');
      void load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Delete failed');
    }
  };

  const handleToggle = async (id: string, isActive: boolean) => {
    try {
      await api.updateMarketingForm(id, { isActive: !isActive });
      void load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Update failed');
    }
  };

  return (
    <div>
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Forms</h1>
          <p className="text-muted text-sm mt-1">
            Public lead-intake forms, surveys, and post-session feedback. Each form has a
            public URL you can share or embed, and can auto-create leads + tag submitters.
          </p>
        </div>
        <Link href="/admin/forms/new" className="ppl-btn ppl-btn-primary text-sm">
          + New Form
        </Link>
      </div>

      {loading ? (
        <div className="text-muted">Loading…</div>
      ) : forms.length === 0 ? (
        <div className="text-center py-12 bg-surface border border-border rounded-xl">
          <p className="text-muted">No forms yet.</p>
          <Link href="/admin/forms/new" className="ppl-btn ppl-btn-primary text-sm mt-4 inline-block">
            Create your first form
          </Link>
        </div>
      ) : (
        <div className="space-y-3">
          {forms.map((f) => (
            <div
              key={f.id}
              className="bg-surface border border-border rounded-xl p-5 flex items-start justify-between gap-4 hover:border-highlight/40 transition"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <Link
                    href={`/admin/forms/${f.id}`}
                    className="text-lg font-semibold text-foreground hover:text-highlight"
                  >
                    {f.name}
                  </Link>
                  <span
                    className={`text-xs px-2 py-0.5 rounded-full ${
                      f.isActive
                        ? 'bg-green-500/20 text-green-400'
                        : 'bg-zinc-500/20 text-zinc-400'
                    }`}
                  >
                    {f.isActive ? 'Active' : 'Inactive'}
                  </span>
                  <span className="text-xs px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-400">
                    {TRIGGER_LABELS[f.trigger] || f.trigger}
                  </span>
                </div>
                {f.description && (
                  <p className="text-sm text-muted mt-1 line-clamp-2">{f.description}</p>
                )}
                <div className="flex items-center gap-4 mt-2 text-xs text-muted">
                  <span>/f/{f.slug}</span>
                  <span>·</span>
                  <span>{f._count?.submissions ?? 0} submission{(f._count?.submissions ?? 0) === 1 ? '' : 's'}</span>
                </div>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <button
                  onClick={() => handleToggle(f.id, f.isActive)}
                  className="text-xs px-3 py-1.5 border border-border rounded-md hover:bg-bg-secondary"
                >
                  {f.isActive ? 'Pause' : 'Resume'}
                </button>
                <Link
                  href={`/admin/forms/${f.id}`}
                  className="text-xs px-3 py-1.5 border border-border rounded-md hover:bg-bg-secondary"
                >
                  Edit
                </Link>
                <button
                  onClick={() => handleDelete(f.id, f.name)}
                  className="text-xs px-3 py-1.5 border border-red-500/30 text-red-400 rounded-md hover:bg-red-500/10"
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
