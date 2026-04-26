'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { FormBuilder, type FormPayload } from '../_FormBuilder';

export default function NewFormPage() {
  const router = useRouter();
  const [saving, setSaving] = useState(false);

  const handleSave = async (payload: FormPayload) => {
    setSaving(true);
    try {
      const res = await api.createMarketingForm(payload);
      toast.success('Form created');
      router.push(`/admin/forms/${res.data!.id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const baseUrl =
    typeof window !== 'undefined' ? window.location.origin : '';

  return (
    <div>
      <div className="mb-6">
        <Link href="/admin/forms" className="text-sm text-muted hover:text-foreground">
          ← Back to forms
        </Link>
        <h1 className="text-2xl font-bold text-foreground mt-2">New Form</h1>
      </div>
      <FormBuilder onSave={handleSave} saving={saving} publicUrlBase={baseUrl} draftKey="new" />
    </div>
  );
}
