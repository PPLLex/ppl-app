import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'PPL Kiosk — Self Check-In',
  description: 'Self-service check-in for Pitching Performance Lab',
};

export default function KioskLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[#0a1a0f]">
      {children}
    </div>
  );
}
