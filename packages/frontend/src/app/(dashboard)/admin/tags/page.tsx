'use client';

/**
 * Tag manager — Phase 2 (Phase 1A surface).
 *
 * Lists all tags grouped by kind. System tags (locations, playing levels,
 * lifecycle) are protected — admins can recolor but not rename or delete.
 * Custom tags are fully CRUD.
 */

import { useEffect, useState, useCallback, useMemo } from 'react';
import { toast } from 'sonner';
import { api } from '@/lib/api';

type Tag = NonNullable<Awaited<ReturnType<typeof api.listTags>>['data']>[number];

const KIND_LABELS: Record<string, string> = {
  LOCATION: 'Location',
  PLAYING_LEVEL: 'Playing Level',
  LIFECYCLE: 'Lifecycle',
  CUSTOM: 'Custom',
};
const KIND_ORDER = ['LIFECYCLE', 'PLAYING_LEVEL', 'LOCATION', 'CUSTOM'];

export default function AdminTagsPage() {
  const [tags, setTags] = useState<Tag[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNewModal, setShowNewModal] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.listTags();
      setTags((res.data as Tag[]) || []);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load tags');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const tagsByKind = useMemo(() => {
    const map: Record<string, Tag[]> = {};
    for (const t of tags) {
      if (!map[t.kind]) map[t.kind] = [];
      map[t.kind].push(t);
    }
    return map;
  }, [tags]);

  return (
    <main className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Tags</h1>
          <p className="text-sm text-muted mt-0.5">
            Tag leads, members, and athletes for segmented campaigns and dashboards.
          </p>
        </div>
        <button onClick={() => setShowNewModal(true)} className="ppl-btn ppl-btn-primary text-sm">
          + New Tag
        </button>
      </div>

      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => <div key={i} className="ppl-card animate-pulse h-12" />)}
        </div>
      ) : (
        <div className="space-y-6">
          {KIND_ORDER.filter((k) => tagsByKind[k]?.length > 0).map((kind) => (
            <div key={kind}>
              <h2 className="text-xs uppercase tracking-wider text-muted font-semibold mb-2">
                {KIND_LABELS[kind] ?? kind}
              </h2>
              <div className="space-y-1.5">
                {tagsByKind[kind].map((t) => (
                  <TagRow key={t.id} tag={t} onChanged={load} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {showNewModal && <NewTagModal onClose={() => setShowNewModal(false)} onCreated={async () => { setShowNewModal(false); await load(); }} />}
    </main>
  );
}

function TagRow({ tag, onChanged }: { tag: Tag; onChanged: () => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(tag.name);
  const [color, setColor] = useState(tag.color);
  const [description, setDescription] = useState(tag.description ?? '');

  const handleSave = async () => {
    try {
      await api.updateTag(tag.id, {
        ...(tag.system ? {} : { name }),
        color,
        description,
      });
      toast.success('Tag updated');
      setEditing(false);
      await onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Save failed');
    }
  };

  const handleDelete = async () => {
    if (!confirm(`Delete "${tag.name}"? Removes the tag from every lead/member it's attached to.`)) return;
    try {
      await api.deleteTag(tag.id);
      toast.success('Tag deleted');
      await onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Delete failed');
    }
  };

  if (editing) {
    return (
      <div className="ppl-card flex items-center gap-2 flex-wrap">
        <input
          type="color"
          value={color}
          onChange={(e) => setColor(e.target.value)}
          className="w-8 h-8 rounded border-none cursor-pointer flex-shrink-0"
        />
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={tag.system}
          className="ppl-input text-sm flex-1 min-w-[120px]"
        />
        <input
          type="text"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Optional description"
          className="ppl-input text-sm flex-1 min-w-[140px]"
        />
        <button onClick={handleSave} className="ppl-btn ppl-btn-primary text-xs">Save</button>
        <button onClick={() => setEditing(false)} className="ppl-btn ppl-btn-secondary text-xs">Cancel</button>
      </div>
    );
  }

  return (
    <div className="ppl-card flex items-center gap-3 flex-wrap">
      <span
        className="w-3 h-3 rounded-full flex-shrink-0"
        style={{ background: tag.color }}
        title={tag.color}
      />
      <span className="text-sm font-semibold text-foreground">{tag.name}</span>
      {tag.system && (
        <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/30">
          System
        </span>
      )}
      {tag.description && (
        <span className="text-xs text-muted truncate flex-1 min-w-0">{tag.description}</span>
      )}
      <span className="text-[11px] text-muted ml-auto">
        {tag._count?.assignments ?? 0} assignment{(tag._count?.assignments ?? 0) === 1 ? '' : 's'}
      </span>
      <div className="flex gap-1">
        <button onClick={() => setEditing(true)} className="text-[11px] text-accent-text hover:underline">
          Edit
        </button>
        {!tag.system && (
          <button onClick={handleDelete} className="text-[11px] text-red-400 hover:underline ml-2">
            Delete
          </button>
        )}
      </div>
    </div>
  );
}

function NewTagModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => Promise<void> }) {
  const [name, setName] = useState('');
  const [color, setColor] = useState('#95C83C');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSubmitting(true);
    try {
      await api.createTag({ name: name.trim(), color, description: description.trim() || undefined });
      toast.success('Tag created');
      await onCreated();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-surface border border-border rounded-xl max-w-md w-full" onClick={(e) => e.stopPropagation()}>
        <div className="p-5 border-b border-border">
          <h2 className="text-lg font-bold text-foreground">New Tag</h2>
        </div>
        <form onSubmit={handleSubmit} className="p-5 space-y-3">
          <div>
            <label className="text-xs text-muted uppercase tracking-wider">Name</label>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} required className="ppl-input w-full mt-1" />
          </div>
          <div>
            <label className="text-xs text-muted uppercase tracking-wider">Color</label>
            <div className="flex gap-2 mt-1">
              <input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="w-10 h-10 rounded border-none cursor-pointer" />
              <input type="text" value={color} onChange={(e) => setColor(e.target.value)} className="ppl-input flex-1 font-mono text-sm" />
            </div>
          </div>
          <div>
            <label className="text-xs text-muted uppercase tracking-wider">Description (optional)</label>
            <input type="text" value={description} onChange={(e) => setDescription(e.target.value)} className="ppl-input w-full mt-1" />
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
