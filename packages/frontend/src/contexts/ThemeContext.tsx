'use client';

import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { api } from '@/lib/api';

interface ThemeColors {
  primaryColor: string;
  accentColor: string;
}

interface BrandingData extends ThemeColors {
  businessName: string;
  tagline: string;
  logoData: string | null;
}

interface ThemeContextType {
  branding: BrandingData;
  isLoaded: boolean;
  updateTheme: (colors: ThemeColors) => void;
  refreshBranding: () => Promise<void>;
}

const defaultBranding: BrandingData = {
  businessName: 'Pitching Performance Lab',
  tagline: 'Train like a pro.',
  logoData: null,
  primaryColor: '#5E9E50',
  accentColor: '#95C83C',
};

const ThemeContext = createContext<ThemeContextType>({
  branding: defaultBranding,
  isLoaded: false,
  updateTheme: () => {},
  refreshBranding: async () => {},
});

/** Derive rgba values from hex for use in opacity utilities like bg-primary/15 */
function hexToRgb(hex: string): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  return `${r} ${g} ${b}`;
}

function applyColorsToDOM(primary: string, accent: string) {
  const root = document.documentElement;
  root.style.setProperty('--color-primary', primary);
  root.style.setProperty('--color-accent', accent);
  root.style.setProperty('--color-primary-rgb', hexToRgb(primary));
  root.style.setProperty('--color-accent-rgb', hexToRgb(accent));
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [branding, setBranding] = useState<BrandingData>(defaultBranding);
  const [isLoaded, setIsLoaded] = useState(false);

  const refreshBranding = useCallback(async () => {
    try {
      const res = await api.getBranding();
      if (res.data) {
        const b = res.data;
        const data: BrandingData = {
          businessName: b.businessName || defaultBranding.businessName,
          tagline: b.tagline || defaultBranding.tagline,
          logoData: b.logoData || null,
          primaryColor: b.primaryColor || defaultBranding.primaryColor,
          accentColor: b.accentColor || defaultBranding.accentColor,
        };
        setBranding(data);
        applyColorsToDOM(data.primaryColor, data.accentColor);
      }
    } catch (err) {
      console.error('Failed to load branding:', err);
      // Apply defaults
      applyColorsToDOM(defaultBranding.primaryColor, defaultBranding.accentColor);
    } finally {
      setIsLoaded(true);
    }
  }, []);

  useEffect(() => {
    // Apply defaults immediately so there's no flash
    applyColorsToDOM(defaultBranding.primaryColor, defaultBranding.accentColor);
    refreshBranding();
  }, [refreshBranding]);

  const updateTheme = useCallback((colors: ThemeColors) => {
    setBranding((prev) => ({
      ...prev,
      primaryColor: colors.primaryColor,
      accentColor: colors.accentColor,
    }));
    applyColorsToDOM(colors.primaryColor, colors.accentColor);
  }, []);

  return (
    <ThemeContext.Provider value={{ branding, isLoaded, updateTheme, refreshBranding }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
