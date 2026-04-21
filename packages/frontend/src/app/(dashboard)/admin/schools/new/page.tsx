'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/api';

interface LocationOption {
  id: string;
  name: string;
}

export default function NewSchoolPage() {
  const router = useRouter();
  const [locations, setLocations] = useState<LocationOption[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Form state
  const [name, setName] = useState('');
  const [coachName, setCoachName] = useState('');
  const [coachEmail, setCoachEmail] = useState('');
  const [coachPhone, setCoachPhone] = useState('');
  const [paymentContactName, setPaymentContactName] = useState('');
  const [paymentContactEmail, setPaymentContactEmail] = useState('');
  const [primaryLocationId, setPrimaryLocationId] = useState('');
  const [primaryColor, setPrimaryColor] = useState('#1a3e72');
  const [secondaryColor, setSecondaryColor] = useState('#c4a34d');
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const logoInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await api.getLocations();
        if (res.data) setLocations(res.data);
      } catch {
        // locations load failed
      }
    })();
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setMessage({ type: 'error', text: 'School/team name is required' });
      return;
    }

    setIsSubmitting(true);
    setMessage(null);

    try {
      const res = await api.createSchool({
        name: name.trim(),
        coachName: coachName.trim() || null,
        coachEmail: coachEmail.trim() || null,
        coachPhone: coachPhone.trim() || null,
        paymentContactName: paymentContactName.trim() || null,
        paymentContactEmail: paymentContactEmail.trim() || null,
        primaryLocationId: primaryLocationId || null,
        brandColors: { primary: primaryColor, secondary: secondaryColor },
      });

      if (res.data) {
        // Upload logo if one was selected
        if (logoFile) {
          try {
            await api.uploadSchoolLogo(res.data.id, logoFile);
          } catch {
            // School created successfully, logo upload failed — continue anyway
            console.error('Logo upload failed, school was still created');
          }
        }
        router.push(`/admin/schools/${res.data.id}`);
      }
    } catch (err: unknown) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Failed to create partnership' });
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div>
      <div className="mb-6">
        <Link href="/admin/schools" className="text-sm text-muted hover:text-accent transition-colors">
          ← Back to Partner Schools
        </Link>
        <h1 className="text-2xl font-bold text-foreground mt-2">New Partnership</h1>
        <p className="text-sm text-muted mt-1">Set up a new school or team partnership</p>
      </div>

      {message && (
        <div className={`mb-4 p-3 rounded-lg text-sm ${
          message.type === 'success'
            ? 'bg-green-500/10 text-green-400 border border-green-500/20'
            : 'bg-red-500/10 text-red-400 border border-red-500/20'
        }`}>
          {message.text}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* School Info */}
        <div className="ppl-card">
          <h3 className="font-semibold text-foreground mb-4">School / Team Info</h3>
          <div className="space-y-4">
            <div>
              <label className="text-sm text-muted block mb-1">School or Team Name *</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Lexington Catholic Baseball"
                className="ppl-input w-full"
                required
              />
            </div>

            <div>
              <label className="text-sm text-muted block mb-1">Home Location</label>
              <select
                value={primaryLocationId}
                onChange={(e) => setPrimaryLocationId(e.target.value)}
                className="ppl-input w-full"
              >
                <option value="">Select location...</option>
                {locations.map((loc) => (
                  <option key={loc.id} value={loc.id}>{loc.name}</option>
                ))}
              </select>
            </div>

            {/* Team Logo */}
            <div>
              <label className="text-sm text-muted block mb-2">Team Logo</label>
              <div className="flex items-center gap-4">
                {logoPreview ? (
                  <div className="relative group">
                    <div className="w-16 h-16 rounded-lg bg-background border border-border flex items-center justify-center overflow-hidden">
                      <img src={logoPreview} alt="Logo preview" className="max-w-full max-h-full object-contain" />
                    </div>
                    <button
                      type="button"
                      onClick={() => { setLogoFile(null); setLogoPreview(null); if (logoInputRef.current) logoInputRef.current.value = ''; }}
                      className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-red-500 text-white rounded-full text-xs flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      &times;
                    </button>
                  </div>
                ) : (
                  <div className="w-16 h-16 rounded-lg bg-background border-2 border-dashed border-border flex items-center justify-center">
                    <svg className="w-6 h-6 text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3.75 21h16.5A2.25 2.25 0 0022.5 18.75V5.25A2.25 2.25 0 0020.25 3H3.75A2.25 2.25 0 001.5 5.25v13.5A2.25 2.25 0 003.75 21z" />
                    </svg>
                  </div>
                )}
                <div>
                  <input
                    ref={logoInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/svg+xml,image/gif"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) {
                        if (file.size > 2 * 1024 * 1024) {
                          setMessage({ type: 'error', text: 'Logo must be under 2MB' });
                          return;
                        }
                        setLogoFile(file);
                        setLogoPreview(URL.createObjectURL(file));
                      }
                    }}
                    className="hidden"
                    id="school-logo-upload"
                  />
                  <label htmlFor="school-logo-upload" className="ppl-btn ppl-btn-secondary text-xs cursor-pointer inline-block">
                    {logoPreview ? 'Change Logo' : 'Upload Logo'}
                  </label>
                  <p className="text-[10px] text-muted mt-1">PNG, JPG, WebP, SVG, or GIF. Max 2MB.</p>
                </div>
              </div>
            </div>

            {/* Brand Colors */}
            <div>
              <label className="text-sm text-muted block mb-2">Team Colors</label>
              <div className="flex gap-4">
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={primaryColor}
                    onChange={(e) => setPrimaryColor(e.target.value)}
                    className="w-10 h-10 rounded cursor-pointer border border-border"
                  />
                  <span className="text-sm text-muted">Primary</span>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={secondaryColor}
                    onChange={(e) => setSecondaryColor(e.target.value)}
                    className="w-10 h-10 rounded cursor-pointer border border-border"
                  />
                  <span className="text-sm text-muted">Secondary</span>
                </div>
              </div>
              {/* Preview */}
              <div className="mt-3 p-4 rounded-lg border border-border flex items-center gap-3">
                {logoPreview ? (
                  <div className="w-12 h-12 rounded-lg overflow-hidden border border-border">
                    <img src={logoPreview} alt="Logo" className="w-full h-full object-contain" />
                  </div>
                ) : (
                  <div
                    className="w-12 h-12 rounded-lg flex items-center justify-center text-white font-bold"
                    style={{ backgroundColor: primaryColor }}
                  >
                    {name ? name.charAt(0).toUpperCase() : '?'}
                  </div>
                )}
                <div>
                  <p className="font-semibold" style={{ color: primaryColor }}>{name || 'Team Name'}</p>
                  <p className="text-xs" style={{ color: secondaryColor }}>Partner with PPL</p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Coach Info */}
        <div className="ppl-card">
          <h3 className="font-semibold text-foreground mb-4">Head Coach</h3>
          <p className="text-xs text-muted mb-4">
            The coach will receive an invite link to enter their team roster.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-sm text-muted block mb-1">Coach Name</label>
              <input
                type="text"
                value={coachName}
                onChange={(e) => setCoachName(e.target.value)}
                placeholder="John Smith"
                className="ppl-input w-full"
              />
            </div>
            <div>
              <label className="text-sm text-muted block mb-1">Coach Email</label>
              <input
                type="email"
                value={coachEmail}
                onChange={(e) => setCoachEmail(e.target.value)}
                placeholder="coach@school.edu"
                className="ppl-input w-full"
              />
            </div>
            <div>
              <label className="text-sm text-muted block mb-1">Coach Phone</label>
              <input
                type="tel"
                value={coachPhone}
                onChange={(e) => setCoachPhone(e.target.value)}
                placeholder="(859) 555-1234"
                className="ppl-input w-full"
              />
            </div>
          </div>
        </div>

        {/* Billing Contact */}
        <div className="ppl-card">
          <h3 className="font-semibold text-foreground mb-4">Billing Contact</h3>
          <p className="text-xs text-muted mb-4">
            Who receives invoices and signs contracts? Leave blank if same as coach.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-sm text-muted block mb-1">Contact Name</label>
              <input
                type="text"
                value={paymentContactName}
                onChange={(e) => setPaymentContactName(e.target.value)}
                placeholder="Athletic Director name"
                className="ppl-input w-full"
              />
            </div>
            <div>
              <label className="text-sm text-muted block mb-1">Contact Email</label>
              <input
                type="email"
                value={paymentContactEmail}
                onChange={(e) => setPaymentContactEmail(e.target.value)}
                placeholder="ad@school.edu"
                className="ppl-input w-full"
              />
            </div>
          </div>
        </div>

        {/* Submit */}
        <div className="flex gap-3">
          <button
            type="submit"
            disabled={isSubmitting}
            className="ppl-btn ppl-btn-primary flex-1 py-3"
          >
            {isSubmitting ? 'Creating...' : 'Create Partnership'}
          </button>
          <Link href="/admin/schools" className="ppl-btn ppl-btn-secondary py-3">
            Cancel
          </Link>
        </div>
      </form>
    </div>
  );
}
