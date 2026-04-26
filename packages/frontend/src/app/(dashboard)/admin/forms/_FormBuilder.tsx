'use client';

/**
 * Reusable Form Builder — shared by /admin/forms/new and /admin/forms/[id].
 *
 * Lets admins drag-construct a form from typed fields. Manages name/slug
 * /description, the trigger schedule, and the field array (label, type,
 * required, options for select/multi-select).
 *
 * No autosave — admin clicks Save explicitly. The parent passes onSave to
 * receive the payload and route appropriately.
 */

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { useAutoSaveDraft, AutoSaveIndicator } from '@/hooks/useAutoSaveDraft';

export interface FieldDef {
  key: string;
  label: string;
  type: string;
  required?: boolean;
  options?: string[];
  placeholder?: string;
  helpText?: string;
}

export interface FormPayload {
  name: string;
  slug?: string;
  description?: string;
  fields: FieldDef[];
  submitMessage?: string;
  redirectUrl?: string;
  collectEmail: boolean;
  collectName: boolean;
  isPublic: boolean;
  trigger: string;
  triggerDelayHours: number;
  autoCreateLead: boolean;
  autoTagIds: string[];
}

const FIELD_TYPES = [
  { value: 'TEXT', label: 'Text' },
  { value: 'LONG_TEXT', label: 'Long Text' },
  { value: 'EMAIL', label: 'Email' },
  { value: 'PHONE', label: 'Phone' },
  { value: 'NUMBER', label: 'Number' },
  { value: 'DATE', label: 'Date' },
  { value: 'BOOLEAN', label: 'Checkbox' },
  { value: 'SELECT', label: 'Single Select' },
  { value: 'MULTI_SELECT', label: 'Multi-Select' },
  { value: 'URL', label: 'URL' },
];

const TRIGGERS = [
  { value: 'MANUAL', label: 'Manual — I send it from the admin' },
  { value: 'POST_BOOKING_COMPLETE', label: 'Auto-send X hours after each booking ends' },
  { value: 'POST_FIRST_SESSION', label: "Auto-send after athlete's first-ever session" },
  { value: 'POST_MEMBERSHIP_START', label: 'Auto-send after a new membership starts' },
  { value: 'POST_LEAD_CREATED', label: 'Auto-send after a new lead is created' },
];

function slugify(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

export function FormBuilder({
  initial,
  onSave,
  saving,
  publicUrlBase,
  // Identifier used to scope the localStorage auto-save key. Pass the
  // form id when editing an existing form, or 'new' on the create page.
  draftKey = 'new',
}: {
  initial?: Partial<FormPayload> & { slug?: string };
  onSave: (payload: FormPayload) => void | Promise<void>;
  saving?: boolean;
  publicUrlBase?: string;
  draftKey?: string;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [slug, setSlug] = useState(initial?.slug ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [fields, setFields] = useState<FieldDef[]>(initial?.fields ?? []);
  const [submitMessage, setSubmitMessage] = useState(initial?.submitMessage ?? '');
  const [redirectUrl, setRedirectUrl] = useState(initial?.redirectUrl ?? '');
  const [collectEmail, setCollectEmail] = useState(initial?.collectEmail !== false);
  const [collectName, setCollectName] = useState(initial?.collectName !== false);
  const [isPublic, setIsPublic] = useState(initial?.isPublic !== false);
  const [trigger, setTrigger] = useState(initial?.trigger ?? 'MANUAL');
  const [triggerDelayHours, setTriggerDelayHours] = useState(initial?.triggerDelayHours ?? 24);
  const [autoCreateLead, setAutoCreateLead] = useState(initial?.autoCreateLead ?? false);

  // Auto-save (#U7). Persist the entire builder state under a per-form
  // key so a tab close doesn't lose 30+ minutes of building. Hydrates
  // ONCE on mount if there's no `initial` (new-form path); when editing
  // an existing form we trust the server-loaded data and skip hydration.
  const draftPayload = {
    name,
    slug,
    description,
    fields,
    submitMessage,
    redirectUrl,
    collectEmail,
    collectName,
    isPublic,
    trigger,
    triggerDelayHours,
    autoCreateLead,
  };
  const draft = useAutoSaveDraft<typeof draftPayload>(
    `form-builder-draft-${draftKey}`,
    draftPayload,
    /* enabled */ true
  );

  useEffect(() => {
    // Only auto-restore on the NEW path (initial === undefined). On the
    // edit path the server-side payload wins.
    if (initial) return;
    const restored = draft.hydrateDraft();
    if (!restored) return;
    if (typeof restored.name === 'string') setName(restored.name);
    if (typeof restored.slug === 'string') setSlug(restored.slug);
    if (typeof restored.description === 'string') setDescription(restored.description);
    if (Array.isArray(restored.fields)) setFields(restored.fields);
    if (typeof restored.submitMessage === 'string') setSubmitMessage(restored.submitMessage);
    if (typeof restored.redirectUrl === 'string') setRedirectUrl(restored.redirectUrl);
    if (typeof restored.collectEmail === 'boolean') setCollectEmail(restored.collectEmail);
    if (typeof restored.collectName === 'boolean') setCollectName(restored.collectName);
    if (typeof restored.isPublic === 'boolean') setIsPublic(restored.isPublic);
    if (typeof restored.trigger === 'string') setTrigger(restored.trigger);
    if (typeof restored.triggerDelayHours === 'number') setTriggerDelayHours(restored.triggerDelayHours);
    if (typeof restored.autoCreateLead === 'boolean') setAutoCreateLead(restored.autoCreateLead);
    toast.info('Restored your in-progress draft');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const addField = () => {
    setFields((f) => [
      ...f,
      { key: `field_${f.length + 1}`, label: 'New field', type: 'TEXT', required: false },
    ]);
  };

  const updateField = (idx: number, patch: Partial<FieldDef>) => {
    setFields((f) => f.map((field, i) => (i === idx ? { ...field, ...patch } : field)));
  };

  const removeField = (idx: number) => setFields((f) => f.filter((_, i) => i !== idx));

  const moveField = (idx: number, dir: -1 | 1) => {
    setFields((f) => {
      const next = [...f];
      const target = idx + dir;
      if (target < 0 || target >= next.length) return f;
      [next[idx], next[target]] = [next[target], next[idx]];
      return next;
    });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      toast.error('Form needs a name');
      return;
    }
    if (fields.length === 0) {
      toast.error('Add at least one field');
      return;
    }
    // Validate option fields
    for (const f of fields) {
      if (
        (f.type === 'SELECT' || f.type === 'MULTI_SELECT') &&
        (!f.options || f.options.length === 0)
      ) {
        toast.error(`Field "${f.label}" needs at least one option`);
        return;
      }
      if (!f.key.trim()) {
        toast.error(`Field "${f.label}" needs a key`);
        return;
      }
    }
    const payload: FormPayload = {
      name: name.trim(),
      slug: slug.trim() || slugify(name),
      description: description.trim() || undefined,
      fields,
      submitMessage: submitMessage.trim() || undefined,
      redirectUrl: redirectUrl.trim() || undefined,
      collectEmail,
      collectName,
      isPublic,
      trigger,
      triggerDelayHours,
      autoCreateLead,
      autoTagIds: [],
    };
    // Discard the auto-save draft on a clean submit so the next visit
    // doesn't restore yesterday's already-saved state.
    draft.discardDraft();
    void onSave(payload);
  };

  const previewSlug = slug || slugify(name) || 'your-form';

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="bg-surface border border-border rounded-xl p-6 space-y-4">
        <h2 className="text-lg font-bold text-foreground">Basics</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-semibold mb-1">Form name</label>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Free Bullpen Signup"
              className="ppl-input"
            />
          </div>
          <div>
            <label className="block text-sm font-semibold mb-1">Public URL slug</label>
            <input
              type="text"
              value={slug}
              onChange={(e) => setSlug(slugify(e.target.value))}
              placeholder={slugify(name) || 'auto-from-name'}
              className="ppl-input"
            />
            <p className="text-xs text-muted mt-1">
              Public URL: {publicUrlBase || ''}/f/{previewSlug}
            </p>
          </div>
        </div>
        <div>
          <label className="block text-sm font-semibold mb-1">Description (optional)</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            className="ppl-input"
            placeholder="Shown above the form fields."
          />
        </div>
      </div>

      <div className="bg-surface border border-border rounded-xl p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-foreground">Fields</h2>
          <button
            type="button"
            onClick={addField}
            className="text-sm px-3 py-1.5 bg-highlight/20 text-highlight border border-highlight/30 rounded-md hover:bg-highlight/30"
          >
            + Add Field
          </button>
        </div>
        {fields.length === 0 ? (
          <p className="text-muted text-sm">No fields yet — click Add Field above.</p>
        ) : (
          <div className="space-y-3">
            {fields.map((f, i) => (
              <FieldRow
                key={i}
                field={f}
                onChange={(patch) => updateField(i, patch)}
                onRemove={() => removeField(i)}
                onMove={(dir) => moveField(i, dir)}
                isFirst={i === 0}
                isLast={i === fields.length - 1}
              />
            ))}
          </div>
        )}
      </div>

      <div className="bg-surface border border-border rounded-xl p-6 space-y-4">
        <h2 className="text-lg font-bold text-foreground">Submitter Info</h2>
        <div className="space-y-2">
          <Toggle label="Collect submitter name" checked={collectName} onChange={setCollectName} />
          <Toggle label="Collect submitter email" checked={collectEmail} onChange={setCollectEmail} />
          <Toggle
            label="Auto-create a CRM lead from each submission"
            checked={autoCreateLead}
            onChange={setAutoCreateLead}
            helpText="Only fires when the email isn't already a member or lead."
          />
        </div>
      </div>

      <div className="bg-surface border border-border rounded-xl p-6 space-y-4">
        <h2 className="text-lg font-bold text-foreground">Delivery Schedule</h2>
        <div>
          <label className="block text-sm font-semibold mb-1">When should this form be sent?</label>
          <select value={trigger} onChange={(e) => setTrigger(e.target.value)} className="ppl-input">
            {TRIGGERS.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
        {trigger !== 'MANUAL' && (
          <div>
            <label className="block text-sm font-semibold mb-1">Delay (hours)</label>
            <input
              type="number"
              min={0}
              value={triggerDelayHours}
              onChange={(e) => setTriggerDelayHours(Number(e.target.value))}
              className="ppl-input w-32"
            />
            <p className="text-xs text-muted mt-1">
              How many hours after the trigger event should the form email be sent?
            </p>
          </div>
        )}
      </div>

      <div className="bg-surface border border-border rounded-xl p-6 space-y-4">
        <h2 className="text-lg font-bold text-foreground">After Submission</h2>
        <div>
          <label className="block text-sm font-semibold mb-1">Thank-you message</label>
          <textarea
            value={submitMessage}
            onChange={(e) => setSubmitMessage(e.target.value)}
            rows={2}
            className="ppl-input"
            placeholder="Thanks! Someone from PPL will be in touch shortly."
          />
        </div>
        <div>
          <label className="block text-sm font-semibold mb-1">Redirect URL (optional)</label>
          <input
            type="url"
            value={redirectUrl}
            onChange={(e) => setRedirectUrl(e.target.value)}
            placeholder="https://yoursite.com/thank-you"
            className="ppl-input"
          />
        </div>
        <Toggle
          label="Form is public (anyone with the link can submit)"
          checked={isPublic}
          onChange={setIsPublic}
          helpText="Turn off to require an authenticated session to submit."
        />
      </div>

      <div className="flex justify-end items-center gap-3">
        <AutoSaveIndicator status={draft.status} savedAt={draft.savedAt} />
        <button type="submit" disabled={saving} className="ppl-btn ppl-btn-primary">
          {saving ? 'Saving…' : 'Save Form'}
        </button>
      </div>
    </form>
  );
}

function FieldRow({
  field,
  onChange,
  onRemove,
  onMove,
  isFirst,
  isLast,
}: {
  field: FieldDef;
  onChange: (patch: Partial<FieldDef>) => void;
  onRemove: () => void;
  onMove: (dir: -1 | 1) => void;
  isFirst: boolean;
  isLast: boolean;
}) {
  const needsOptions = field.type === 'SELECT' || field.type === 'MULTI_SELECT';
  return (
    <div className="border border-border rounded-lg p-4 bg-bg-secondary/40">
      <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-start">
        <div className="md:col-span-4">
          <label className="block text-xs font-semibold text-muted mb-1">Label</label>
          <input
            type="text"
            value={field.label}
            onChange={(e) => onChange({ label: e.target.value })}
            className="ppl-input"
          />
        </div>
        <div className="md:col-span-3">
          <label className="block text-xs font-semibold text-muted mb-1">Key (data column)</label>
          <input
            type="text"
            value={field.key}
            onChange={(e) =>
              onChange({ key: e.target.value.replace(/[^a-zA-Z0-9_]/g, '_').toLowerCase() })
            }
            className="ppl-input font-mono text-sm"
          />
        </div>
        <div className="md:col-span-3">
          <label className="block text-xs font-semibold text-muted mb-1">Type</label>
          <select
            value={field.type}
            onChange={(e) => onChange({ type: e.target.value })}
            className="ppl-input"
          >
            {FIELD_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
        <div className="md:col-span-2 flex flex-col gap-1 pt-5">
          <label className="flex items-center gap-1 text-xs">
            <input
              type="checkbox"
              checked={!!field.required}
              onChange={(e) => onChange({ required: e.target.checked })}
            />
            <span>Required</span>
          </label>
        </div>
        {needsOptions && (
          <div className="md:col-span-12">
            <label className="block text-xs font-semibold text-muted mb-1">
              Options (one per line)
            </label>
            <textarea
              value={(field.options || []).join('\n')}
              onChange={(e) =>
                onChange({
                  options: e.target.value
                    .split('\n')
                    .map((s) => s.trim())
                    .filter(Boolean),
                })
              }
              rows={3}
              className="ppl-input"
              placeholder={'Option 1\nOption 2\nOption 3'}
            />
          </div>
        )}
        <div className="md:col-span-12">
          <label className="block text-xs font-semibold text-muted mb-1">Help text (optional)</label>
          <input
            type="text"
            value={field.helpText || ''}
            onChange={(e) => onChange({ helpText: e.target.value })}
            className="ppl-input"
            placeholder="Shown beneath the field"
          />
        </div>
      </div>
      <div className="flex justify-end gap-2 mt-3">
        <button
          type="button"
          disabled={isFirst}
          onClick={() => onMove(-1)}
          className="text-xs px-2 py-1 text-muted hover:text-foreground disabled:opacity-30"
        >
          ↑
        </button>
        <button
          type="button"
          disabled={isLast}
          onClick={() => onMove(1)}
          className="text-xs px-2 py-1 text-muted hover:text-foreground disabled:opacity-30"
        >
          ↓
        </button>
        <button
          type="button"
          onClick={onRemove}
          className="text-xs px-2 py-1 text-red-400 hover:text-red-300"
        >
          Remove
        </button>
      </div>
    </div>
  );
}

function Toggle({
  label,
  checked,
  onChange,
  helpText,
}: {
  label: string;
  checked: boolean;
  onChange: (b: boolean) => void;
  helpText?: string;
}) {
  return (
    <label className="flex items-start gap-3 cursor-pointer">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-1"
      />
      <div>
        <span className="text-sm text-foreground">{label}</span>
        {helpText && <p className="text-xs text-muted mt-0.5">{helpText}</p>}
      </div>
    </label>
  );
}
