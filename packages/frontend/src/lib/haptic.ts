/**
 * Haptic feedback — tiny tactile pings for button taps / successful actions
 * on mobile devices that support `navigator.vibrate` (Android browsers, iOS
 * PWA). Safari-on-iOS ignores `vibrate()` silently, which is fine — the
 * button-press styles already give visual feedback.
 *
 * Intentionally short durations (5-15ms) so the app feels responsive, not
 * buzzy. Longer patterns are reserved for errors and successes where we
 * WANT the user to notice.
 *
 * Everything no-ops on SSR or browsers without the API — safe to import
 * anywhere.
 */

function canVibrate(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
}

export const haptic = {
  /** Button tap — 5ms, barely-perceptible. */
  light(): void {
    if (canVibrate()) navigator.vibrate(5);
  },
  /** Meaningful action (plan select, step complete) — 10ms. */
  medium(): void {
    if (canVibrate()) navigator.vibrate(10);
  },
  /** Successful completion (account created, booking confirmed) — two quick pulses. */
  success(): void {
    if (canVibrate()) navigator.vibrate([8, 40, 12]);
  },
  /** Error state — two spaced pulses, longer and more insistent than success. */
  error(): void {
    if (canVibrate()) navigator.vibrate([20, 60, 20]);
  },
};
