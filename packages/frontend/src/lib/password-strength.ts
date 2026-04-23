/**
 * Password strength scorer — weights length heavily (NIST-aligned) with
 * a small bonus for character-class diversity. Caps at "Weak" if the
 * password is on the common-password blocklist.
 *
 * Client-only — the backend does its own (stricter) evaluation including
 * the HIBP breach check.
 */
import { isCommonPassword } from './common-passwords';

export type StrengthLevel = 'empty' | 'weak' | 'fair' | 'good' | 'strong';

export interface StrengthResult {
  score: number;              // 0-4
  level: StrengthLevel;
  label: string;              // user-facing text
  color: string;              // hex for the bar
  percent: number;            // 0-100 for bar width
  isCommon: boolean;          // on the blocklist
}

export function scorePassword(pw: string): StrengthResult {
  if (!pw) {
    return { score: 0, level: 'empty', label: '', color: '#2A2A2A', percent: 0, isCommon: false };
  }

  const isCommon = isCommonPassword(pw);
  if (isCommon) {
    return {
      score: 0,
      level: 'weak',
      label: 'Too common — pick something unique',
      color: '#EF4444',
      percent: 20,
      isCommon: true,
    };
  }

  // Length tiers
  let score = 0;
  const len = pw.length;
  if (len >= 8) score += 1;
  if (len >= 12) score += 1;
  if (len >= 16) score += 1;

  // Character-class diversity
  const hasLower = /[a-z]/.test(pw);
  const hasUpper = /[A-Z]/.test(pw);
  const hasDigit = /\d/.test(pw);
  const hasSpecial = /[^A-Za-z0-9]/.test(pw);
  const classes = [hasLower, hasUpper, hasDigit, hasSpecial].filter(Boolean).length;
  if (classes >= 3) score += 1;
  if (classes === 4 && len >= 12) score += 1;

  // Clamp 0-4
  score = Math.max(0, Math.min(4, score));

  const levels: StrengthLevel[] = ['weak', 'weak', 'fair', 'good', 'strong'];
  const labels = ['Weak', 'Weak', 'Fair', 'Good', 'Strong'];
  const colors = ['#EF4444', '#EF4444', '#F59E0B', '#95C83C', '#5E9E50'];
  const percents = [25, 35, 55, 80, 100];

  return {
    score,
    level: levels[score],
    label: labels[score],
    color: colors[score],
    percent: percents[score],
    isCommon: false,
  };
}
