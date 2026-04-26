'use client';

/**
 * Public consultation booking page — Phase 2 (#20).
 *
 * Available at /consult. No auth required. Lists open consult slots in
 * the next 14 days. Pick a slot → fill out a small form → backend
 * atomically books the slot and creates a Lead.
 *
 * Marketing site links here from "Book a free 15-min consult" CTAs.
 */

import { useEffect, useState, useMemo } from 'react';
import Image from 'next/image';

type Slot = {
  id: string;
  startTime: string;
  durationMinutes: number;
  location: { id: string; name: string } | null;
  host: { id: string; fullName: string } | null;
};

const API_BASE =
  process.env.NEXT_PUBLIC_API_URL || 'https://api.pitchingperformancelab.com/api';

export default function ConsultPage() {
  const [slots, setSlots] = useState<Slot[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<Slot | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/consultations/public/available?days=14`);
        const json = await res.json();
        if (!res.ok) throw new Error(json.message || 'Failed to load slots');
        setSlots((json.data as Slot[]) || []);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // Group slots by date for cleaner rendering
  const slotsByDate = useMemo(() => {
    const map = new Map<string, Slot[]>();
    for (const s of slots) {
      const key = new Date(s.startTime).toLocaleDateString('en-US', {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
      });
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(s);
    }
    return Array.from(map.entries());
  }, [slots]);

  return (
    <main className="min-h-screen bg-black text-white">
      <div className="max-w-3xl mx-auto px-6 py-12">
        <header className="text-center mb-10">
          <Image
            src="/ppl-logo.webp"
            alt="Pitching Performance Lab"
            width={64}
            height={64}
            className="mx-auto mb-4 rounded-full"
            unoptimized
            priority
          />
          <p className="text-[11px] uppercase tracking-[3px] text-[#95c83c] font-bold">
            Pitching Performance Lab
          </p>
          <h1 className="text-3xl font-bold mt-3">Book a Free Consultation</h1>
          <p className="text-sm text-gray-400 mt-2 max-w-md mx-auto">
            15 minutes on the phone. We'll talk about where your athlete is, where they want to go,
            and whether PPL is the right fit. No pressure, no pitch.
          </p>
        </header>

        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-16 bg-white/5 rounded-lg animate-pulse" />
            ))}
          </div>
        ) : error ? (
          <div className="rounded-lg bg-red-500/10 border border-red-500/30 p-4 text-sm text-red-400">
            {error}
          </div>
        ) : slots.length === 0 ? (
          <div className="text-center py-12 text-gray-400 text-sm">
            No open consult slots in the next two weeks. Email{' '}
            <a href="mailto:support@pitchingperformancelab.com" className="text-[#95c83c] underline">
              support@pitchingperformancelab.com
            </a>{' '}
            and we'll find a time.
          </div>
        ) : (
          <div className="space-y-6">
            {slotsByDate.map(([date, daySlots]) => (
              <div key={date}>
                <div className="text-xs uppercase tracking-wider text-[#95c83c] font-bold mb-2">{date}</div>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                  {daySlots.map((s) => {
                    const time = new Date(s.startTime).toLocaleTimeString('en-US', {
                      hour: 'numeric',
                      minute: '2-digit',
                    });
                    return (
                      <button
                        key={s.id}
                        onClick={() => setSelectedSlot(s)}
                        className="rounded-lg border border-white/10 bg-white/5 hover:bg-[#95c83c]/15 hover:border-[#95c83c]/40 px-3 py-2.5 text-sm font-medium transition"
                      >
                        {time}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}

        <p className="text-center text-xs text-gray-500 mt-12">
          Already a member? <a href="/login" className="text-[#95c83c] hover:underline">Sign in here</a>.
        </p>
      </div>

      {selectedSlot && (
        <BookingModal slot={selectedSlot} onClose={() => setSelectedSlot(null)} />
      )}
    </main>
  );
}

function BookingModal({ slot, onClose }: { slot: Slot; onClose: () => void }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [ageGroup, setAgeGroup] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !email.trim()) {
      setError('Name and email are required');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/consultations/public/book`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slotId: slot.id,
          name: name.trim(),
          email: email.trim(),
          phone: phone.trim() || undefined,
          ageGroup: ageGroup || undefined,
          notes: notes.trim() || undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.message || 'Booking failed');
      setSuccess(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Booking failed');
    } finally {
      setSubmitting(false);
    }
  };

  const dt = new Date(slot.startTime);
  const dateStr = dt.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
  const timeStr = dt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

  return (
    <div
      className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="bg-[#141414] border border-white/10 rounded-2xl max-w-md w-full overflow-hidden my-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-5 border-b border-white/10 flex items-start justify-between gap-3">
          <div>
            <p className="text-xs text-[#95c83c] uppercase tracking-wider font-bold">Book Consultation</p>
            <p className="text-base font-semibold mt-1">{dateStr} at {timeStr}</p>
            <p className="text-xs text-gray-400 mt-0.5">{slot.durationMinutes} minute call</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white p-1" aria-label="Close">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {success ? (
          <div className="p-8 text-center">
            <div className="w-16 h-16 mx-auto rounded-full bg-[#95c83c]/15 flex items-center justify-center mb-4">
              <svg className="w-8 h-8 text-[#95c83c]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h2 className="text-xl font-bold mb-1">You're booked.</h2>
            <p className="text-sm text-gray-400 mb-6">Check your inbox for a confirmation.</p>
            <button
              onClick={onClose}
              className="px-6 py-2 rounded-lg bg-[#95c83c] text-black font-semibold text-sm"
            >
              Done
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="p-5 space-y-3">
            {error && (
              <div className="p-2.5 rounded bg-red-500/10 border border-red-500/30 text-xs text-red-400">
                {error}
              </div>
            )}
            <div>
              <label className="text-[10px] uppercase tracking-wider text-gray-400">Your Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                className="w-full mt-1 px-3 py-2 bg-black/40 border border-white/10 rounded text-sm focus:outline-none focus:border-[#95c83c]"
              />
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-wider text-gray-400">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="w-full mt-1 px-3 py-2 bg-black/40 border border-white/10 rounded text-sm focus:outline-none focus:border-[#95c83c]"
              />
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-wider text-gray-400">Phone (optional)</label>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="w-full mt-1 px-3 py-2 bg-black/40 border border-white/10 rounded text-sm focus:outline-none focus:border-[#95c83c]"
              />
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-wider text-gray-400">Athlete's Level</label>
              <select
                value={ageGroup}
                onChange={(e) => setAgeGroup(e.target.value)}
                className="w-full mt-1 px-3 py-2 bg-black/40 border border-white/10 rounded text-sm focus:outline-none focus:border-[#95c83c]"
              >
                <option value="">— Select —</option>
                <option value="youth">Youth (12 and under)</option>
                <option value="ms_hs">Middle / High School</option>
                <option value="college">College</option>
                <option value="pro">Pro / MiLB</option>
              </select>
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-wider text-gray-400">
                What do you want to talk about? (optional)
              </label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
                className="w-full mt-1 px-3 py-2 bg-black/40 border border-white/10 rounded text-sm focus:outline-none focus:border-[#95c83c]"
                placeholder="e.g. wants to add velo for next season"
              />
            </div>
            <button
              type="submit"
              disabled={submitting}
              className="w-full py-2.5 rounded-lg bg-[#95c83c] text-black font-bold text-sm disabled:opacity-50"
            >
              {submitting ? 'Booking…' : 'Confirm Booking'}
            </button>
            <p className="text-[10px] text-gray-500 text-center">
              By booking you agree to be contacted by Pitching Performance Lab.
            </p>
          </form>
        )}
      </div>
    </div>
  );
}
