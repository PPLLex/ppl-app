'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';

export default function Home() {
  const { user, isLoading, isAuthenticated } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (isLoading) return;

    if (!isAuthenticated) {
      router.replace('/login');
      return;
    }

    // Redirect to role-appropriate dashboard
    switch (user?.role) {
      case 'ADMIN':
        router.replace('/admin');
        break;
      case 'STAFF':
        router.replace('/staff');
        break;
      case 'CLIENT':
        router.replace('/client');
        break;
      default:
        router.replace('/login');
    }
  }, [isLoading, isAuthenticated, user, router]);

  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="flex flex-col items-center gap-4">
        <div className="w-12 h-12 rounded-full ppl-gradient animate-pulse" />
        <p className="text-muted text-sm">Loading...</p>
      </div>
    </div>
  );
}
