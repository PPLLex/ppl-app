'use client';

import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { api, User, OAuthResult, ApiError } from '@/lib/api';
import { useRouter } from 'next/navigation';

/**
 * `login()` resolves to either:
 *   - { twoFactorRequired: true, challenge } — caller must collect a TOTP
 *     code and call verifyTwoFactorLogin to finish the session.
 *   - { twoFactorRequired: false } — session is established, user is set,
 *     routing has happened.
 */
export type LoginResult =
  | { twoFactorRequired: true; challenge: string; method: 'totp' }
  | { twoFactorRequired: false };

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<LoginResult>;
  verifyTwoFactorLogin: (
    challenge: string,
    code: string
  ) => Promise<{ recoveryCodesLow: boolean }>;
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
   * Stores the access token + (optional) refresh token, sets the user,
   * and routes by role.
   *
   * The refresh token is what powers the silent /auth/refresh exchange
   * inside ApiClient.tryRefresh. When it isn't present (legacy server
   * responses), the user gets the old behavior — kicked out at first
   * 401 — but new logins always include one.
   */
  const handleAuthSuccess = useCallback(
    (token: string, authUser: User, refreshToken?: string | null) => {
      localStorage.setItem('ppl_token', token);
      if (refreshToken) {
        localStorage.setItem('ppl_refresh', refreshToken);
      }
      setUser(authUser);
      routeByRole(authUser.role);
    },
    [routeByRole]
  );

  const login = async (email: string, password: string): Promise<LoginResult> => {
    const res = await api.login(email, password);
    if (!res.data) {
      throw new Error('Login failed');
    }
    if ('twoFactorRequired' in res.data && res.data.twoFactorRequired) {
      // 2FA gate — caller must collect a TOTP code and call verifyTwoFactorLogin.
      return { twoFactorRequired: true, challenge: res.data.challenge, method: res.data.method };
    }
    // Type narrowed: regular login response with token + user (+ optional refreshToken).
    const data = res.data as { token: string; user: User; refreshToken?: string };
    handleAuthSuccess(data.token, data.user, data.refreshToken);
    return { twoFactorRequired: false };
  };

  const verifyTwoFactorLogin = async (
    challenge: string,
    code: string
  ): Promise<{ recoveryCodesLow: boolean }> => {
    const res = await api.verifyTwoFactorLogin(challenge, code);
    if (!res.data) throw new Error('2FA verification failed');
    handleAuthSuccess(
      res.data.token,
      res.data.user,
      (res.data as { refreshToken?: string }).refreshToken
    );
    return { recoveryCodesLow: !!res.data.recoveryCodesLow };
  };

  const loginWithGoogle = async (idToken: string): Promise<OAuthResult> => {
    const res = await api.googleAuth({ idToken });
    if (!res.data) throw new Error('Google authentication failed');

    // If new user, don't auto-route — let the caller decide (they may need onboarding)
    localStorage.setItem('ppl_token', res.data.token);
    const oauthRefresh = (res.data as { refreshToken?: string }).refreshToken;
    if (oauthRefresh) localStorage.setItem('ppl_refresh', oauthRefresh);
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
    const appleRefresh = (res.data as { refreshToken?: string }).refreshToken;
    if (appleRefresh) localStorage.setItem('ppl_refresh', appleRefresh);
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
      handleAuthSuccess(
        res.data.token,
        res.data.user,
        (res.data as { refreshToken?: string }).refreshToken
      );
    }
  };

  const logout = () => {
    // Best-effort revocation server-side; never block the UI on it.
    const refreshToken =
      typeof window !== 'undefined'
        ? window.localStorage.getItem('ppl_refresh')
        : null;
    if (refreshToken) {
      void api.logout(refreshToken).catch(() => {
        /* ignore — local clear is what matters */
      });
    }
    localStorage.removeItem('ppl_token');
    localStorage.removeItem('ppl_refresh');
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
        verifyTwoFactorLogin,
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
