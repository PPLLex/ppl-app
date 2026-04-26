'use client';

/**
 * Birthday confetti — Phase 2 (#12 from GHL).
 *
 * Mounts on the client dashboard. On mount, checks if today is the
 * logged-in athlete's birthday and if the celebration hasn't already
 * been dismissed today. If yes → renders confetti + balloons + a happy
 * birthday banner.
 *
 * "Already dismissed today" is tracked in sessionStorage with the key
 * `ppl-bday-shown:YYYY-MM-DD` so refreshing the page doesn't replay the
 * animation.
 */

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

const COLORS = ['#95C83C', '#5E9E50', '#F59E0B', '#3B82F6', '#EF4444', '#8B5CF6'];

export function BirthdayCelebration() {
  const [show, setShow] = useState(false);
  const [firstName, setFirstName] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.getProfile();
        if (cancelled) return;
        const profile = res.data as { fullName?: string; athleteProfile?: { dateOfBirth?: string | null } | null } | undefined;
        const dob = profile?.athleteProfile?.dateOfBirth;
        if (!dob) return;
        const dt = new Date(dob);
        const today = new Date();
        if (dt.getMonth() !== today.getMonth() || dt.getDate() !== today.getDate()) return;

        // Once-per-day dismiss
        const key = `ppl-bday-shown:${today.toISOString().slice(0, 10)}`;
        if (typeof window !== 'undefined' && window.sessionStorage.getItem(key)) return;

        setFirstName((profile.fullName ?? '').split(' ')[0] || 'champion');
        setShow(true);
      } catch {
        // Silently skip — birthday celebration is non-critical
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const handleDismiss = () => {
    const key = `ppl-bday-shown:${new Date().toISOString().slice(0, 10)}`;
    if (typeof window !== 'undefined') window.sessionStorage.setItem(key, '1');
    setShow(false);
  };

  if (!show) return null;

  return (
    <div className="fixed inset-0 z-[100] pointer-events-none overflow-hidden">
      {/* Confetti */}
      {Array.from({ length: 60 }).map((_, i) => {
        const left = Math.random() * 100;
        const delay = Math.random() * 1.5;
        const duration = 2.8 + Math.random() * 1.6;
        const color = COLORS[i % COLORS.length];
        const size = 6 + Math.random() * 6;
        const rotate = Math.random() * 360;
        return (
          <span
            key={i}
            className="absolute"
            style={{
              left: `${left}%`,
              top: '-20px',
              width: `${size}px`,
              height: `${size * 1.5}px`,
              background: color,
              transform: `rotate(${rotate}deg)`,
              animation: `pplConfettiFall ${duration}s ${delay}s linear forwards`,
              borderRadius: i % 3 === 0 ? '50%' : '2px',
            }}
          />
        );
      })}

      {/* Balloons */}
      {[...'🎈🎈🎈🎉🎈🎉'].map((emoji, i) => (
        <span
          key={`balloon-${i}`}
          className="absolute text-5xl"
          style={{
            left: `${10 + i * 15}%`,
            bottom: '-60px',
            animation: `pplBalloonRise ${5 + i * 0.4}s ease-out forwards`,
          }}
        >
          {emoji}
        </span>
      ))}

      {/* Banner */}
      <div className="pointer-events-auto absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 max-w-md w-full px-6">
        <div className="bg-surface border-2 border-highlight/50 rounded-2xl p-8 text-center shadow-2xl animate-pulse-once">
          <div className="text-6xl mb-3">🎂</div>
          <h2 className="text-3xl font-bold text-foreground mb-2">
            Happy Birthday, {firstName}!
          </h2>
          <p className="text-sm text-muted mb-5">
            From the whole PPL team — go throw something hard today.
          </p>
          <button
            onClick={handleDismiss}
            className="ppl-btn ppl-btn-primary text-sm"
          >
            Thanks!
          </button>
        </div>
      </div>

      <style jsx>{`
        @keyframes pplConfettiFall {
          0% { transform: translateY(-20px) rotate(0deg); opacity: 1; }
          100% { transform: translateY(110vh) rotate(720deg); opacity: 0.4; }
        }
        @keyframes pplBalloonRise {
          0% { transform: translateY(0) translateX(0); opacity: 0; }
          15% { opacity: 1; }
          100% { transform: translateY(-110vh) translateX(${Math.random() > 0.5 ? '-20px' : '20px'}); opacity: 0.5; }
        }
        @keyframes pplPulseOnce {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.04); }
        }
        :global(.animate-pulse-once) {
          animation: pplPulseOnce 1.4s ease-in-out;
        }
      `}</style>
    </div>
  );
}
