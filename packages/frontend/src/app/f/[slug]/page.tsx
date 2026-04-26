'use client';

/**
 * Public form submission page — /f/[slug].
 *
 * Renders any MarketingForm by its public slug. No auth required. Adapts
 * to whatever fields the admin configured (TEXT, LONG_TEXT, EMAIL, PHONE,
 * NUMBER, DATE, BOOLEAN, SELECT, MULTI_SELECT, URL).
 *
 * Pulls the form definition from the public endpoint, renders the inputs,
 * POSTs back to /submit. Shows the configured success message (or
 * redirects if redirectUrl is set) on completion.
 */

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';

interface FieldDef {
  key: string;
  label: string;
  type: string;
  required?: boolean;
  options?: string[];
  placeholder?: string;
  helpText?: string;
}

interface PublicForm {
  id: string;
  slug: string;
  name: string;
  description?: string | null;
  fields: FieldDef[];
  submitMessage?: string | null;
  redirectUrl?: string | null;
  collectEmail: boolean;
  collectName: boolean;
}

const API_BASE =
  process.env.NEXT_PUBLIC_API_URL || 'https://app.pitchingperformancelab.com/api';

export default function PublicFormPage() {
  const params = useParams<{ slug: string }>();
  const slug = params?.slug;
  const [form, setForm] = useState<PublicForm | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, string | number | boolean | string[]>>({});
  const [meta, setMeta] = useState({ name: '', email: '', phone: '' });

  useEffect(() => {
    if (!slug) return;
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/marketing-forms/by-slug/${slug}`);
        if (!res.ok) {
          setNotFound(true);
          return;
        }
        const json = await res.json();
        setForm(json.data);
      } catch {
        setNotFound(true);
      } finally {
        setLoading(false);
      }
    })();
  }, [slug]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form) return;
    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch(`${API_BASE}/marketing-forms/by-slug/${form.slug}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          payload: values,
          submitterName: meta.name || undefined,
          submitterEmail: meta.email || undefined,
          submitterPhone: meta.phone || undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error?.message || 'Submission failed');
      }
      if (json.data?.redirectUrl) {
        window.location.href = json.data.redirectUrl;
        return;
      }
      setSubmitted(true);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0A0A0A] text-white flex items-center justify-center">
        <div className="text-muted">Loading…</div>
      </div>
    );
  }

  if (notFound || !form) {
    return (
      <div className="min-h-screen bg-[#0A0A0A] text-white flex items-center justify-center px-6">
        <div className="text-center max-w-md">
          <h1 className="text-2xl font-bold mb-2">Form not found</h1>
          <p className="text-muted">
            This form doesn&apos;t exist or is no longer accepting responses.
          </p>
        </div>
      </div>
    );
  }

  if (submitted) {
    return (
      <div className="min-h-screen bg-[#0A0A0A] text-white flex items-center justify-center px-6">
        <div className="max-w-md text-center bg-[#141414] border border-[#2A2A2A] rounded-xl p-10">
          <div className="text-6xl mb-4">✅</div>
          <h1 className="text-2xl font-bold mb-3">Thanks!</h1>
          <p className="text-muted">
            {form.submitMessage || 'Your submission has been received. We\'ll be in touch.'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0A0A0A] text-white py-12 px-6">
      <div className="max-w-xl mx-auto">
        <div className="bg-[#141414] border border-[#2A2A2A] rounded-xl p-8">
          <h1 className="text-2xl font-bold mb-2">{form.name}</h1>
          {form.description && (
            <p className="text-muted mb-6 whitespace-pre-line">{form.description}</p>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Identity fields — only render if the form collects them */}
            {form.collectName && (
              <Field label="Your name" required>
                <input
                  type="text"
                  required
                  value={meta.name}
                  onChange={(e) => setMeta({ ...meta, name: e.target.value })}
                  className="ppl-input"
                />
              </Field>
            )}
            {form.collectEmail && (
              <Field label="Email" required>
                <input
                  type="email"
                  required
                  value={meta.email}
                  onChange={(e) => setMeta({ ...meta, email: e.target.value })}
                  className="ppl-input"
                />
              </Field>
            )}

            {/* Custom fields */}
            {form.fields.map((f) => (
              <Field key={f.key} label={f.label} required={f.required} helpText={f.helpText}>
                {renderField(f, values, setValues)}
              </Field>
            ))}

            {error && (
              <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-sm text-red-400">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="ppl-btn ppl-btn-primary w-full"
            >
              {submitting ? 'Submitting…' : 'Submit'}
            </button>
          </form>
        </div>

        <p className="text-center text-xs text-muted mt-6">
          Powered by Pitching Performance Lab
        </p>
      </div>
    </div>
  );
}

function Field({
  label,
  required,
  helpText,
  children,
}: {
  label: string;
  required?: boolean;
  helpText?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-sm font-semibold text-foreground mb-1">
        {label} {required && <span className="text-red-400">*</span>}
      </label>
      {children}
      {helpText && <p className="text-xs text-muted mt-1">{helpText}</p>}
    </div>
  );
}

function renderField(
  f: FieldDef,
  values: Record<string, string | number | boolean | string[]>,
  setValues: React.Dispatch<React.SetStateAction<Record<string, string | number | boolean | string[]>>>
) {
  const v = values[f.key];
  const onChange = (newVal: string | number | boolean | string[]) =>
    setValues((prev) => ({ ...prev, [f.key]: newVal }));

  const inputCls = 'ppl-input';

  switch (f.type) {
    case 'LONG_TEXT':
      return (
        <textarea
          value={(v as string) ?? ''}
          required={f.required}
          placeholder={f.placeholder}
          onChange={(e) => onChange(e.target.value)}
          className={inputCls}
          rows={4}
        />
      );
    case 'NUMBER':
      return (
        <input
          type="number"
          value={(v as number) ?? ''}
          required={f.required}
          placeholder={f.placeholder}
          onChange={(e) => onChange(Number(e.target.value))}
          className={inputCls}
        />
      );
    case 'DATE':
      return (
        <input
          type="date"
          value={(v as string) ?? ''}
          required={f.required}
          onChange={(e) => onChange(e.target.value)}
          className={inputCls}
        />
      );
    case 'BOOLEAN':
      return (
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={!!v}
            onChange={(e) => onChange(e.target.checked)}
            className="w-4 h-4"
          />
          <span className="text-muted">{f.placeholder || 'Yes'}</span>
        </label>
      );
    case 'SELECT':
      return (
        <select
          value={(v as string) ?? ''}
          required={f.required}
          onChange={(e) => onChange(e.target.value)}
          className={inputCls}
        >
          <option value="">— select —</option>
          {(f.options || []).map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      );
    case 'MULTI_SELECT': {
      const arr = (v as string[]) ?? [];
      return (
        <div className="flex flex-wrap gap-2">
          {(f.options || []).map((opt) => {
            const checked = arr.includes(opt);
            return (
              <button
                type="button"
                key={opt}
                onClick={() =>
                  onChange(checked ? arr.filter((x) => x !== opt) : [...arr, opt])
                }
                className={`px-3 py-1.5 rounded-full text-sm border transition ${
                  checked
                    ? 'bg-[#5E9E50] border-[#5E9E50] text-white'
                    : 'bg-transparent border-[#2A2A2A] text-muted hover:border-[#5E9E50]'
                }`}
              >
                {opt}
              </button>
            );
          })}
        </div>
      );
    }
    case 'EMAIL':
      return (
        <input
          type="email"
          value={(v as string) ?? ''}
          required={f.required}
          placeholder={f.placeholder}
          onChange={(e) => onChange(e.target.value)}
          className={inputCls}
        />
      );
    case 'PHONE':
      return (
        <input
          type="tel"
          value={(v as string) ?? ''}
          required={f.required}
          placeholder={f.placeholder}
          onChange={(e) => onChange(e.target.value)}
          className={inputCls}
        />
      );
    case 'URL':
      return (
        <input
          type="url"
          value={(v as string) ?? ''}
          required={f.required}
          placeholder={f.placeholder || 'https://'}
          onChange={(e) => onChange(e.target.value)}
          className={inputCls}
        />
      );
    case 'TEXT':
    default:
      return (
        <input
          type="text"
          value={(v as string) ?? ''}
          required={f.required}
          placeholder={f.placeholder}
          onChange={(e) => onChange(e.target.value)}
          className={inputCls}
        />
      );
  }
}
