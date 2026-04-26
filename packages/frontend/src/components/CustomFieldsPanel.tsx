'use client';

/**
 * Renders any custom fields admins have defined for the given entity type
 * and binds them to the entity's values. Drops into Lead detail + Member
 * detail pages so per-entity custom data is editable inline.
 */

import { useEffect, useState, useCallback } from 'react';
import { toast } from 'sonner';
import { api } from '@/lib/api';

type EntityType = 'LEAD' | 'USER' | 'ATHLETE_PROFILE';

type FieldDef = {
  id: string;
  name: string;
  slug: string;
  fieldType: string;
  config: Record<string, unknown> | null;
  required: boolean;
  order: number;
  active: boolean;
};

export function CustomFieldsPanel({
  entityType,
  entityId,
}: {
  entityType: EntityType;
  entityId: string;
}) {
  const [fields, setFields] = useState<FieldDef[]>([]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [defsRes, valsRes] = await Promise.all([
        api.listCustomFields(entityType),
        api.getCustomFieldValues(entityType, entityId),
      ]);
      const defs = (defsRes.data as FieldDef[]) || [];
      // Filter inactive defs out of the renderer
      const activeDefs = defs.filter((d) => d.active).sort((a, b) => a.order - b.order);
      setFields(activeDefs);
      const valMap: Record<string, string> = {};
      for (const v of (valsRes.data as Array<{ field: { slug: string }; value: string | null }>) || []) {
        valMap[v.field.slug] = v.value ?? '';
      }
      setValues(valMap);
      setDirty(false);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [entityType, entityId]);

  useEffect(() => { load(); }, [load]);

  const handleChange = (slug: string, value: string) => {
    setValues((prev) => ({ ...prev, [slug]: value }));
    setDirty(true);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      // Convert MULTI_SELECT comma-strings back into arrays for the API
      const out: Record<string, unknown> = {};
      for (const f of fields) {
        const v = values[f.slug];
        if (f.fieldType === 'MULTI_SELECT' && typeof v === 'string') {
          out[f.slug] = v.split(',').map((s) => s.trim()).filter(Boolean);
        } else {
          out[f.slug] = v;
        }
      }
      await api.setCustomFieldValues(entityType, entityId, out);
      toast.success('Saved');
      setDirty(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="ppl-card animate-pulse h-20" />;
  }
  if (fields.length === 0) {
    return null; // No defined fields → don't render the panel at all
  }

  return (
    <div className="ppl-card">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs uppercase tracking-[0.12em] text-muted font-semibold">Custom Fields</h3>
        {dirty && (
          <button onClick={handleSave} disabled={saving} className="ppl-btn ppl-btn-primary text-xs disabled:opacity-50">
            {saving ? 'Saving…' : 'Save'}
          </button>
        )}
      </div>
      <div className="space-y-3">
        {fields.map((f) => (
          <FieldInput
            key={f.id}
            field={f}
            value={values[f.slug] ?? ''}
            onChange={(v) => handleChange(f.slug, v)}
          />
        ))}
      </div>
    </div>
  );
}

function FieldInput({ field, value, onChange }: { field: FieldDef; value: string; onChange: (v: string) => void }) {
  const baseLabel = (
    <label className="text-xs font-medium text-foreground block mb-1">
      {field.name}
      {field.required && <span className="text-red-400 ml-1">*</span>}
    </label>
  );

  const cfg = (field.config ?? {}) as { options?: string[]; placeholder?: string };

  switch (field.fieldType) {
    case 'TEXT':
    case 'EMAIL':
    case 'URL':
    case 'PHONE':
      return (
        <div>
          {baseLabel}
          <input
            type={field.fieldType === 'EMAIL' ? 'email' : field.fieldType === 'URL' ? 'url' : field.fieldType === 'PHONE' ? 'tel' : 'text'}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={cfg.placeholder ?? ''}
            className="ppl-input w-full text-sm"
            required={field.required}
          />
        </div>
      );
    case 'LONG_TEXT':
      return (
        <div>
          {baseLabel}
          <textarea
            value={value}
            onChange={(e) => onChange(e.target.value)}
            rows={3}
            placeholder={cfg.placeholder ?? ''}
            className="ppl-input w-full text-sm"
          />
        </div>
      );
    case 'NUMBER':
      return (
        <div>
          {baseLabel}
          <input
            type="number"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="ppl-input w-full text-sm"
          />
        </div>
      );
    case 'DATE':
      return (
        <div>
          {baseLabel}
          <input
            type="date"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="ppl-input w-full text-sm"
          />
        </div>
      );
    case 'BOOLEAN':
      return (
        <label className="flex items-center gap-2 text-sm text-foreground">
          <input
            type="checkbox"
            checked={value === 'true'}
            onChange={(e) => onChange(e.target.checked ? 'true' : 'false')}
            className="rounded"
          />
          <span>{field.name}</span>
        </label>
      );
    case 'SELECT':
      return (
        <div>
          {baseLabel}
          <select value={value} onChange={(e) => onChange(e.target.value)} className="ppl-input w-full text-sm">
            <option value="">— Select —</option>
            {(cfg.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        </div>
      );
    case 'MULTI_SELECT': {
      // Stored as comma-joined while editing; converted to array on save.
      const selected = value.split(',').map((s) => s.trim()).filter(Boolean);
      return (
        <div>
          {baseLabel}
          <div className="flex flex-wrap gap-1.5">
            {(cfg.options ?? []).map((o) => {
              const active = selected.includes(o);
              return (
                <button
                  key={o}
                  type="button"
                  onClick={() => {
                    const next = active ? selected.filter((s) => s !== o) : [...selected, o];
                    onChange(next.join(', '));
                  }}
                  className={`text-xs px-2.5 py-1 rounded-full border transition ${
                    active
                      ? 'border-highlight text-foreground bg-highlight/20'
                      : 'border-border text-muted hover:text-foreground'
                  }`}
                >
                  {o}
                </button>
              );
            })}
          </div>
        </div>
      );
    }
    default:
      return (
        <div>
          {baseLabel}
          <input type="text" value={value} onChange={(e) => onChange(e.target.value)} className="ppl-input w-full text-sm" />
        </div>
      );
  }
}
