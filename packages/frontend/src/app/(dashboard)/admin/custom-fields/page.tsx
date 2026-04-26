'use client';

/**
 * Custom field manager — Phase 1B surface.
 *
 * Lists definitions per entity type (Lead / User / Athlete). Admin can
 * create new fields, mark them required, reorder, or retire (soft delete
 * via active=false to preserve existing values).
 */

import { useEffect, useState, useCallback, useMemo } from 'react';
import { toast } from 'sonner';
import { api } from '@/lib/api';

type Field = NonNullable<Awaited<ReturnType<typeof api.listCustomFields>>['data']>[number];

const ENTITY_LABELS: Record<string, string> = {
  LEAD: 'Lead',
  USER: 'Member / User',
  ATHLETE_PROFILE: 'Athlete Profile',
};

const FIELD_TYPES = [
  { value: 'TEXT', label: 'Text' },
  { value: 'LONG_TEXT', label: 'Long Text' },
  { value: 'NUMBER', label: 'Number' },
  { value: 'DATE', label: 'Date' },
  { value: 'BOOLEAN', label: 'Yes / No' },
  { value: 'SELECT', label: 'Single Select' },
  { value: 'MULTI_SELECT', label: 'Multi-Select' },
  { value: 'EMAIL', label: 'Email' },
  { value: 'URL', label: 'URL' },
  { value: 'PHONE', label: 'Phone' },
];

export default function AdminCustomFieldsPage() {
  const [fields, setFields] = useState<Field[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNewModal, setShowNewModal] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.listCustomFields(undefined, true);
      setFields((res.data as Field[]) || []);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const fieldsByEntity = useMemo(() => {
    const map: Record<string, Field[]> = {};
    for (const f of fields) {
      if (!map[f.entityType]) map[f.entityType] = [];
      map[f.entityType].push(f);
    }
    return map;
  }, [fields]);

  return (
    <main className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Custom Fields</h1>
          <p className="text-sm text-muted mt-0.5">
            Track per-lead, per-member, and per-athlete data without changing the schema.
          </p>
        </div>
        <button onClick={() => setShowNewModal(true)} className="ppl-btn ppl-btn-primary text-sm">
          + New Field
        </button>
      </div>

      {loading ? (
        <div className="space-y-2">{[1, 2, 3].map((i) => <div key={i} className="ppl-card animate-pulse h-12" />)}</div>
      ) : fields.length === 0 ? (
        <div className="ppl-card text-center py-12">
          <p className="text-muted text-sm">No custom fields defined yet.</p>
        </div>
      ) : (
        <div className="space-y-6">
          {Object.entries(fieldsByEntity).map(([entity, list]) => (
            <div key={entity}>
              <h2 className="text-xs uppercase tracking-wider text-muted font-semibold mb-2">
                {ENTITY_LABELS[entity] ?? entity}
              </h2>
              <div className="space-y-1.5">
                {list
                  .slice()
                  .sort((a, b) => a.order - b.order)
                  .map((f) => <FieldRow key={f.id} field={f} onChanged={load} />)}
              </div>
            </div>
          ))}
        </div>
      )}

      {showNewModal && <NewFieldModal onClose={() => setShowNewModal(false)} onCreated={async () => { setShowNewModal(false); await load(); }} />}
    </main>
  );
}

function FieldRow({ field, onChanged }: { field: Field; onChanged: () => Promise<void> }) {
  const handleToggleActive = async () => {
    try {
      await api.updateCustomField(field.id, { active: !field.active });
      await onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed');
    }
  };
  const handleDelete = async () => {
    if (!confirm(`Permanently delete "${field.name}"? Erases all stored values for this field.`)) return;
    try {
      await api.deleteCustomField(field.id);
      toast.success('Field deleted');
      await onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Delete failed');
    }
  };
  return (
    <div className={`ppl-card flex items-center gap-3 flex-wrap ${field.active ? '' : 'opacity-60'}`}>
      <span className="text-sm font-semibold text-foreground">{field.name}</span>
      <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-background text-muted border border-border">
        {field.fieldType}
      </span>
      {field.required && (
        <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-red-500/10 text-red-400 border border-red-500/30">
          Required
        </span>
      )}
      {!field.active && (
        <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-gray-500/10 text-gray-400 border border-gray-500/30">
          Hidden
        </span>
      )}
      <code className="text-[11px] text-muted ml-auto">{field.slug}</code>
      <button onClick={handleToggleActive} className="text-[11px] text-accent-text hover:underline ml-2">
        {field.active ? 'Hide' : 'Show'}
      </button>
      <button onClick={handleDelete} className="text-[11px] text-red-400 hover:underline">Delete</button>
    </div>
  );
}

function NewFieldModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => Promise<void> }) {
  const [name, setName] = useState('');
  const [entityType, setEntityType] = useState('LEAD');
  const [fieldType, setFieldType] = useState('TEXT');
  const [optionsText, setOptionsText] = useState('');
  const [required, setRequired] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const needsOptions = fieldType === 'SELECT' || fieldType === 'MULTI_SELECT';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSubmitting(true);
    try {
      const config: Record<string, unknown> = {};
      if (needsOptions) {
        config.options = optionsText.split(/[,\n]/).map((o) => o.trim()).filter(Boolean);
      }
      await api.createCustomField({
        name: name.trim(),
        entityType,
        fieldType,
        config: needsOptions ? config : undefined,
        required,
      });
      toast.success('Field created');
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
          <h2 className="text-lg font-bold text-foreground">New Custom Field</h2>
        </div>
        <form onSubmit={handleSubmit} className="p-5 space-y-3">
          <div>
            <label className="text-xs text-muted uppercase tracking-wider">Field Name</label>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} required className="ppl-input w-full mt-1" placeholder='e.g. "Throws Hand"' />
          </div>
          <div>
            <label className="text-xs text-muted uppercase tracking-wider">Attached To</label>
            <select value={entityType} onChange={(e) => setEntityType(e.target.value)} className="ppl-input w-full mt-1">
              <option value="LEAD">Lead</option>
              <option value="USER">Member / User</option>
              <option value="ATHLETE_PROFILE">Athlete Profile</option>
            </select>
          </div>
          <div>
            <label className="text-xs text-muted uppercase tracking-wider">Field Type</label>
            <select value={fieldType} onChange={(e) => setFieldType(e.target.value)} className="ppl-input w-full mt-1">
              {FIELD_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
          {needsOptions && (
            <div>
              <label className="text-xs text-muted uppercase tracking-wider">Options (one per line)</label>
              <textarea
                value={optionsText}
                onChange={(e) => setOptionsText(e.target.value)}
                rows={4}
                className="ppl-input w-full mt-1 font-mono text-sm"
                placeholder={'Right\nLeft\nSwitch'}
              />
            </div>
          )}
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={required} onChange={(e) => setRequired(e.target.checked)} className="rounded" />
            <span className="text-foreground">Required field</span>
          </label>
          <div className="flex gap-2 justify-end pt-2">
            <button type="button" onClick={onClose} className="ppl-btn ppl-btn-secondary text-sm">Cancel</button>
            <button type="submit" disabled={submitting} className="ppl-btn ppl-btn-primary text-sm disabled:opacity-50">
              {submitting ? 'Creating…' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
