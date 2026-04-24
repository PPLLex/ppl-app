'use client';

/**
 * Admin — Educational Resources CRUD.
 *
 * Lets an admin manage the library of videos + guides shown on the
 * parent dashboard via the EducationalContent widget. Simple list +
 * inline form (no modal) so it works on mobile without a scroll-trap.
 */

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { toast } from 'sonner';

interface Resource {
  id: string;
  title: string;
  description: string;
  body: string | null;
  videoUrl: string | null;
  thumbnailUrl: string | null;
  category: string;
  ageGroupFilter: string | null;
  sortOrder: number;
  isPublished: boolean;
  createdAt: string;
  updatedAt: string;
}

const CATEGORIES = ['onboarding', 'mechanics', 'mindset', 'perks', 'general'] as const;
const AGE_GROUPS = ['youth', 'ms_hs', 'college', 'pro'] as const;

const blankForm = {
  title: '',
  description: '',
  body: '',
  videoUrl: '',
  thumbnailUrl: '',
  category: 'general',
  ageGroupFilter: [] as string[],
  sortOrder: 0,
  isPublished: true,
};

export default function AdminEducationalResourcesPage() {
  const [resources, setResources] = useState<Resource[] | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(blankForm);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    try {
      const res = await api.request<Resource[]>('/educational-resources');
      setResources(res.data ?? []);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load');
      setResources([]);
    }
  }

  function startNew() {
    setEditingId('new');
    setForm(blankForm);
  }

  function startEdit(r: Resource) {
    setEditingId(r.id);
    setForm({
      title: r.title,
      description: r.description,
      body: r.body || '',
      videoUrl: r.videoUrl || '',
      thumbnailUrl: r.thumbnailUrl || '',
      category: r.category,
      ageGroupFilter: r.ageGroupFilter ? r.ageGroupFilter.split(',').map((s) => s.trim()) : [],
      sortOrder: r.sortOrder,
      isPublished: r.isPublished,
    });
  }

  function cancel() {
    setEditingId(null);
    setForm(blankForm);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!form.title.trim() || !form.description.trim()) {
      toast.error('Title and description are required.');
      return;
    }
    setIsSaving(true);
    try {
      const payload = {
        title: form.title.trim(),
        description: form.description.trim(),
        body: form.body.trim() || null,
        videoUrl: form.videoUrl.trim() || null,
        thumbnailUrl: form.thumbnailUrl.trim() || null,
        category: form.category,
        ageGroupFilter: form.ageGroupFilter.length > 0 ? form.ageGroupFilter.join(',') : null,
        sortOrder: form.sortOrder,
        isPublished: form.isPublished,
      };
      if (editingId === 'new') {
        await api.request('/educational-resources', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        toast.success('Resource created');
      } else {
        await api.request(`/educational-resources/${editingId}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        });
        toast.success('Resource updated');
      }
      cancel();
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setIsSaving(false);
    }
  }

  async function remove(id: string) {
    if (!window.confirm('Delete this resource? This cannot be undone.')) return;
    try {
      await api.request(`/educational-resources/${id}`, { method: 'DELETE' });
      toast.success('Deleted');
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Delete failed');
    }
  }

  function toggleAgeGroup(g: string) {
    setForm((f) => ({
      ...f,
      ageGroupFilter: f.ageGroupFilter.includes(g)
        ? f.ageGroupFilter.filter((x) => x !== g)
        : [...f.ageGroupFilter, g],
    }));
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl uppercase tracking-[0.04em] text-foreground">
            Educational Resources
          </h1>
          <p className="text-sm text-muted mt-1">
            Videos, guides, and onboarding content surfaced on parents&apos; dashboards.
          </p>
        </div>
        {!editingId && (
          <button onClick={startNew} className="ppl-btn ppl-btn-primary text-sm">
            New Resource
          </button>
        )}
      </div>

      {/* Form — inline, shown only when editing */}
      {editingId && (
        <form onSubmit={save} className="ppl-card space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-display uppercase tracking-[0.04em] text-foreground text-sm">
              {editingId === 'new' ? 'New Resource' : 'Edit Resource'}
            </h2>
            <button
              type="button"
              onClick={cancel}
              className="text-xs text-muted hover:text-foreground"
            >
              Cancel
            </button>
          </div>

          <div>
            <label className="ppl-label">Title *</label>
            <input
              type="text"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              className="ppl-input"
              required
            />
          </div>
          <div>
            <label className="ppl-label">Short description *</label>
            <input
              type="text"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              className="ppl-input"
              placeholder="One sentence that fits on a dashboard card"
              required
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="ppl-label">Video URL</label>
              <input
                type="url"
                value={form.videoUrl}
                onChange={(e) => setForm({ ...form, videoUrl: e.target.value })}
                className="ppl-input"
                placeholder="https://youtube.com/embed/..."
              />
            </div>
            <div>
              <label className="ppl-label">Thumbnail URL</label>
              <input
                type="url"
                value={form.thumbnailUrl}
                onChange={(e) => setForm({ ...form, thumbnailUrl: e.target.value })}
                className="ppl-input"
                placeholder="https://..."
              />
            </div>
          </div>
          <div>
            <label className="ppl-label">Body (optional, markdown)</label>
            <textarea
              value={form.body}
              onChange={(e) => setForm({ ...form, body: e.target.value })}
              className="ppl-input"
              rows={4}
              placeholder="Longer article content. Leave blank for video-only resources."
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="ppl-label">Category</label>
              <select
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value })}
                className="ppl-input"
              >
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="ppl-label">Sort order</label>
              <input
                type="number"
                value={form.sortOrder}
                onChange={(e) => setForm({ ...form, sortOrder: parseInt(e.target.value) || 0 })}
                className="ppl-input"
              />
            </div>
          </div>
          <div>
            <label className="ppl-label">Visible to (leave all unchecked for &ldquo;everyone&rdquo;)</label>
            <div className="flex flex-wrap gap-2 mt-1">
              {AGE_GROUPS.map((g) => {
                const checked = form.ageGroupFilter.includes(g);
                return (
                  <button
                    key={g}
                    type="button"
                    onClick={() => toggleAgeGroup(g)}
                    className={`px-3 py-1.5 rounded-md text-xs font-medium border transition-all ${
                      checked
                        ? 'border-highlight bg-highlight/15 text-foreground'
                        : 'border-border bg-surface text-muted hover:border-border-light'
                    }`}
                  >
                    {g.replace('_', '/')}
                  </button>
                );
              })}
            </div>
          </div>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={form.isPublished}
              onChange={(e) => setForm({ ...form, isPublished: e.target.checked })}
              className="accent-[#5E9E50]"
            />
            <span className="text-sm text-foreground">Published (visible to clients)</span>
          </label>

          <button type="submit" disabled={isSaving} className="ppl-btn ppl-btn-primary">
            {isSaving ? 'Saving…' : editingId === 'new' ? 'Create Resource' : 'Save Changes'}
          </button>
        </form>
      )}

      {/* Table */}
      {resources === null ? (
        <div className="ppl-skeleton h-40" aria-hidden="true" />
      ) : resources.length === 0 ? (
        <div className="ppl-card text-center py-12">
          <p className="text-sm text-muted">No resources yet. Create your first one above.</p>
        </div>
      ) : (
        <div className="ppl-card p-0 overflow-hidden">
          <ul className="divide-y divide-border">
            {resources.map((r) => (
              <li key={r.id} className="p-4 flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-foreground">{r.title}</span>
                    <span className="text-[10px] uppercase tracking-[0.12em] text-accent-text">
                      {r.category}
                    </span>
                    {!r.isPublished && (
                      <span className="ppl-badge text-[10px] bg-surface text-muted">Draft</span>
                    )}
                  </div>
                  <p className="text-xs text-muted mt-1 line-clamp-2">{r.description}</p>
                  <p className="text-[10px] text-muted/70 mt-1">
                    {r.ageGroupFilter ? `Visible to: ${r.ageGroupFilter}` : 'Visible to everyone'}
                  </p>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button
                    onClick={() => startEdit(r)}
                    className="text-xs font-medium text-muted hover:text-foreground px-2 py-1"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => remove(r.id)}
                    className="text-xs font-medium text-danger hover:brightness-110 px-2 py-1"
                  >
                    Delete
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
