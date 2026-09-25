import { it, expect } from 'vitest';
import { capabilityMessageKey } from './watch-capabilities';
it('copy follows capabilities rather than viewport', () => {
  expect(capabilityMessageKey({ checkOnForeground: true, scheduledChecks: false, pushEnabled: false })).toBe('watch.foreground_only');
  expect(capabilityMessageKey({ checkOnForeground: false, scheduledChecks: true, pushEnabled: true })).toBe('watch.scheduled_with_push');
  expect(capabilityMessageKey({ checkOnForeground: false, scheduledChecks: false, pushEnabled: false })).toBe('watch.unavailable');
});
