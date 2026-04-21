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

/* ============================================================
   COLOR CONTRAST UTILITIES
   ============================================================
   These functions ensure text is always readable regardless
   of which primary/accent colors the admin picks.
   ============================================================ */

/** Convert a hex color to linearized sRGB channel values */
function hexToLinear(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const channels = [
    parseInt(h.substring(0, 2), 16) / 255,
    parseInt(h.substring(2, 4), 16) / 255,
    parseInt(h.substring(4, 6), 16) / 255,
  ] as [number, number, number];
  return channels.map((c) =>
    c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
  ) as [number, number, number];
}

/** WCAG relative luminance (0 = black, 1 = white) */
function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToLinear(hex);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two luminance values */
function contrastRatio(l1: number, l2: number): number {
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

/** Parse hex to RGB components */
function hexToRgbComponents(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [
    parseInt(h.substring(0, 2), 16),
    parseInt(h.substring(2, 4), 16),
    parseInt(h.substring(4, 6), 16),
  ];
}

/** Format RGB components back to hex */
function rgbToHex(r: number, g: number, b: number): string {
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

/**
 * Lighten a color until it meets the minimum contrast ratio against
 * the app's dark background. Preserves the hue by scaling toward white.
 */
function ensureReadableOnDark(hex: string, bgHex: string = '#0A0A0A', minRatio: number = 4.5): string {
  const bgLum = relativeLuminance(bgHex);
  const colorLum = relativeLuminance(hex);

  if (contrastRatio(colorLum, bgLum) >= minRatio) return hex;

  // Lighten by mixing toward white in small steps
  let [r, g, b] = hexToRgbComponents(hex);
  for (let t = 0.05; t <= 1.0; t += 0.05) {
    const nr = Math.round(r + (255 - r) * t);
    const ng = Math.round(g + (255 - g) * t);
    const nb = Math.round(b + (255 - b) * t);
    const candidate = rgbToHex(nr, ng, nb);
    if (contrastRatio(relativeLuminance(candidate), bgLum) >= minRatio) {
      return candidate;
    }
  }

  return '#FFFFFF';
}

/** Choose white or dark text for maximum contrast on a given background */
function textOnBackground(bgHex: string): string {
  const lum = relativeLuminance(bgHex);
  // Use a lower threshold (0.35) so we prefer white text on medium colors
  return lum > 0.35 ? '#111111' : '#FFFFFF';
}

/** Derive space-separated RGB string for Tailwind opacity utilities */
function hexToRgb(hex: string): string {
  const [r, g, b] = hexToRgbComponents(hex);
  return `${r} ${g} ${b}`;
}

/* ============================================================
   DOM APPLICATION
   ============================================================ */

function applyColorsToDOM(primary: string, accent: string) {
  const root = document.documentElement;

  // Raw brand colors — used for backgrounds, gradients, borders
  root.style.setProperty('--color-primary', primary);
  root.style.setProperty('--color-accent', accent);
  root.style.setProperty('--color-primary-rgb', hexToRgb(primary));
  root.style.setProperty('--color-accent-rgb', hexToRgb(accent));

  // Contrast-safe text colors — used when primary/accent appear as TEXT on the dark bg
  const primaryText = ensureReadableOnDark(primary);
  const accentText = ensureReadableOnDark(accent);
  root.style.setProperty('--color-primary-text', primaryText);
  root.style.setProperty('--color-accent-text', accentText);

  // "On" colors — text to place ON a solid primary/accent background
  root.style.setProperty('--color-on-primary', textOnBackground(primary));
  root.style.setProperty('--color-on-accent', textOnBackground(accent));

  // Highlight color — whichever brand color is more visible on the dark background.
  // Used for active states, selection tints, borders — ensures they're always visible
  // even if the admin sets one brand color to something very dark.
  const primaryLum = relativeLuminance(primary);
  const accentLum = relativeLuminance(accent);
  const highlight = accentLum >= primaryLum ? accent : primary;
  const highlightText = ensureReadableOnDark(highlight);
  root.style.setProperty('--color-highlight', highlight);
  root.style.setProperty('--color-highlight-text', highlightText);
  root.style.setProperty('--color-highlight-rgb', hexToRgb(highlight));
}

/* ============================================================
   PROVIDER
   ============================================================ */

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
      applyColorsToDOM(defaultBranding.primaryColor, defaultBranding.accentColor);
    } finally {
      setIsLoaded(true);
    }
  }, []);

  useEffect(() => {
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
