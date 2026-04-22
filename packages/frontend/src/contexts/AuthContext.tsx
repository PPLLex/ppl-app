'use client';

import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { api, User, OAuthResult, ApiError } from '@/lib/api';
import { useRouter } from 'next/navigation';

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<void>;
  loginWithGoogle: (idToken: string) => Promise<OAuthResult>;
  loginWithApple: (identityToken: string, fullName?: { givenName: string; familyName: string }) => Promise<OAuthResult>;
  sendMagicLink: (email: string) => Promise<void>;
  verifyMagicLink: (token: string) => Promise<void>;
  logout: () => void;
  refreshUser: () => Promise<void>;
  routeByRole: (role: string) => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const router = useRouter();

  const refreshUser = useCallback(async () => {
    try {
      const token = localStorage.getItem('ppl_token');
      if (!token) {
        setUser(null);
        setIsLoading(false);
        return;
      }
      const res = await api.getMe();
      if (res.data) {
        setUser(res.data);
      }
    } catch {
      localStorage.removeItem('ppl_token');
      setUser(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshUser();
  }, [refreshUser]);

  const routeByRole = useCallback((role: string) => {
    switch (role) {
      case 'ADMIN':
        router.push('/admin');
        break;
      case 'STAFF':
        router.push('/staff');
        break;
      case 'CLIENT':
        router.push('/client');
        break;
    }
  }, [router]);

  /**
   * Handle the response from any auth flow (email/password, OAuth, magic link).
   * Stores the token, sets the user, and routes.
   */
  const handleAuthSuccess = useCallback((token: string, authUser: User) => {
    localStorage.setItem('ppl_token', token);
    setUser(authUser);
    routeByRole(authUser.role);
  }, [routeByRole]);

  const login = async (email: string, password: string) => {
    const res = await api.login(email, password);
    if (res.data) {
      handleAuthSuccess(res.data.token, res.data.user);
    }
  };

  const loginWithGoogle = async (idToken: string): Promise<OAuthResult> => {
    const res = await api.googleAuth({ idToken });
    if (!res.data) throw new Error('Google authentication failed');

    // If new user, don't auto-route — let the caller decide (they may need onboarding)
    localStorage.setItem('ppl_token', res.data.token);
    setUser(res.data.user);

    if (!res.data.isNewUser) {
      routeByRole(res.data.user.role);
    }

    return res.data;
  };

  const loginWithApple = async (
    identityToken: string,
    fullName?: { givenName: string; familyName: string }
  ): Promise<OAuthResult> => {
    const res = await api.appleAuth({ identityToken, fullName });
    if (!res.data) throw new Error('Apple authentication failed');

    localStorage.setItem('ppl_token', res.data.token);
    setUser(res.data.user);

    if (!res.data.isNewUser) {
      routeByRole(res.data.user.role);
    }

    return res.data;
  };

  const sendMagicLink = async (email: string) => {
    await api.sendMagicLink(email);
  };

  const verifyMagicLink = async (token: string) => {
    const res = await api.verifyMagicLink(token);
    if (res.data) {
      handleAuthSuccess(res.data.token, res.data.user);
    }
  };

  const logout = () => {
    localStorage.removeItem('ppl_token');
    setUser(null);
    router.push('/login');
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
        isAuthenticated: !!user,
        login,
        loginWithGoogle,
        loginWithApple,
        sendMagicLink,
        verifyMagicLink,
        logout,
        refreshUser,
        routeByRole,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
