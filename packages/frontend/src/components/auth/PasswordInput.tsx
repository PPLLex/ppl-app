'use client';

/**
 * PasswordInput — the one password input to rule them all.
 *
 * Drop-in replacement for `<input type="password" className="ppl-input" />`.
 * Adds, for free:
 *   • Show/hide toggle (eye icon button, accessible)
 *   • Caps Lock detection + live warning
 *   • Optional strength meter (variant="create")
 *   • Optional match indicator (matchValue prop)
 *   • Optional common-password warning tied into the strength meter
 *
 * Variants:
 *   • variant="login"   — minimum bar: show/hide + Caps Lock. Used on login,
 *                         current-password confirmations.
 *   • variant="create"  — everything above + strength meter + common-password
 *                         rejection. Used on register / reset / password-change.
 *
 * Security notes:
 *   • The toggle switches <input type> between "password" and "text". Browsers
 *     still NEVER autofill into type=text for current-password flows. That's
 *     why autoComplete is "new-password" on create and "current-password" on
 *     login — preserved through the toggle.
 *   • Client-side checks are UX only. Backend re-validates length, common
 *     blocklist, and HIBP breach set.
 */

import { forwardRef, useEffect, useId, useState, type InputHTMLAttributes, type KeyboardEvent } from 'react';
import { scorePassword } from '@/lib/password-strength';

type Variant = 'login' | 'create';

export interface PasswordInputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'className'> {
  variant?: Variant;
  /** When provided, shows a "passwords match" / "don't match" indicator. */
  matchValue?: string;
  /** Label for the match indicator ("Passwords match" default). */
  matchLabel?: string;
  /** Override the default wrapper className (rarely needed). */
  className?: string;
  /** Override the <input> className (default: ppl-input). */
  inputClassName?: string;
}

export const PasswordInput = forwardRef<HTMLInputElement, PasswordInputProps>(
  function PasswordInput(
    {
      variant = 'login',
      matchValue,
      matchLabel = 'Passwords match',
      className = '',
      inputClassName = 'ppl-input pr-11',
      value = '',
      placeholder,
      autoComplete,
      minLength = 8,
      ...rest
    },
    ref
  ) {
    const [reveal, setReveal] = useState(false);
    const [capsLock, setCapsLock] = useState(false);
    const [focused, setFocused] = useState(false);
    const fieldId = useId();

    // Default autocomplete per variant — callers can override.
    const effectiveAutoComplete =
      autoComplete ?? (variant === 'login' ? 'current-password' : 'new-password');

    const effectivePlaceholder = placeholder ?? (variant === 'create' ? '8+ characters' : '');

    const pwValue = typeof value === 'string' ? value : '';
    const strength = variant === 'create' ? scorePassword(pwValue) : null;

    // Match indicator (only render if caller provided matchValue prop)
    const showMatchIndicator = matchValue !== undefined && pwValue.length > 0 && matchValue.length > 0;
    const matches = showMatchIndicator && pwValue === matchValue;

    const handleKey = (e: KeyboardEvent<HTMLInputElement>) => {
      // getModifierState is in all modern browsers (incl. iOS Safari 16+).
      // Silently no-op if not supported.
      if (typeof e.getModifierState === 'function') {
        setCapsLock(e.getModifierState('CapsLock'));
      }
    };

    // Clear caps-lock warning when field loses focus.
    useEffect(() => {
      if (!focused) setCapsLock(false);
    }, [focused]);

    return (
      <div className={`relative ${className}`}>
        <div className="relative">
          <input
            ref={ref}
            id={rest.id ?? fieldId}
            type={reveal ? 'text' : 'password'}
            value={value}
            placeholder={effectivePlaceholder}
            autoComplete={effectiveAutoComplete}
            minLength={minLength}
            onKeyDown={handleKey}
            onKeyUp={handleKey}
            onFocus={(e) => {
              setFocused(true);
              rest.onFocus?.(e);
            }}
            onBlur={(e) => {
              setFocused(false);
              rest.onBlur?.(e);
            }}
            className={inputClassName}
            aria-describedby={
              [
                capsLock ? `${fieldId}-caps` : '',
                strength && pwValue ? `${fieldId}-strength` : '',
                showMatchIndicator ? `${fieldId}-match` : '',
              ]
                .filter(Boolean)
                .join(' ') || undefined
            }
            {...rest}
          />

          {/* Show/hide toggle — absolutely positioned inside the input.
              Uses mousedown instead of click so focus stays in the input
              (click would move focus → blur fires → caps-lock clears). */}
          <button
            type="button"
            onMouseDown={(e) => {
              e.preventDefault();
              setReveal((r) => !r);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                setReveal((r) => !r);
              }
            }}
            tabIndex={-1}
            aria-label={reveal ? 'Hide password' : 'Show password'}
            aria-pressed={reveal}
            className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-md text-muted hover:text-foreground hover:bg-surface-hover transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
          >
            {reveal ? (
              // eye-off
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
                <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
                <path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
                <line x1="2" y1="2" x2="22" y2="22" />
              </svg>
            ) : (
              // eye
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            )}
          </button>
        </div>

        {/* Caps Lock warning */}
        {capsLock && (
          <p
            id={`${fieldId}-caps`}
            role="status"
            className="mt-1.5 flex items-center gap-1.5 text-[11px] text-warning"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="m6 15 6-6 6 6" />
              <rect x="4" y="17" width="16" height="4" rx="1" />
            </svg>
            Caps Lock is on
          </p>
        )}

        {/* Strength meter (create variant only) */}
        {strength && pwValue && (
          <div id={`${fieldId}-strength`} className="mt-1.5">
            <div className="flex items-center gap-2">
              <div className="flex-1 h-1 rounded-full bg-border overflow-hidden">
                <div
                  className="h-full transition-[width,background-color] duration-200 ease-out"
                  style={{ width: `${strength.percent}%`, backgroundColor: strength.color }}
                />
              </div>
              <span
                className="text-[11px] font-medium tabular-nums"
                style={{ color: strength.color }}
              >
                {strength.label}
              </span>
            </div>
            {strength.isCommon && (
              <p className="mt-1 text-[11px] text-danger">
                This password appears in breach lists. Please choose something different.
              </p>
            )}
          </div>
        )}

        {/* Match indicator */}
        {showMatchIndicator && (
          <p
            id={`${fieldId}-match`}
            className={`mt-1.5 flex items-center gap-1.5 text-[11px] ${matches ? 'text-primary-text' : 'text-danger'}`}
            role="status"
          >
            {matches ? (
              <>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M20 6 9 17l-5-5" />
                </svg>
                {matchLabel}
              </>
            ) : (
              <>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M18 6 6 18" />
                  <path d="m6 6 12 12" />
                </svg>
                Passwords don&apos;t match
              </>
            )}
          </p>
        )}
      </div>
    );
  }
);
