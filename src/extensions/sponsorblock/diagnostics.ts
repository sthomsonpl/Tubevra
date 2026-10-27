import type { ExtensionDiagnostics, ExtensionState } from '../types';
import { sponsorPlaybackStates, type SponsorPlayback } from './player';

export const sponsorAvailabilityStates = [
  'unknown',
  'available',
  'network-error',
  'service-error',
  'timeout',
  'invalid-data',
  'rate-limited',
  'busy',
] as const;
export type SponsorAvailability = (typeof sponsorAvailabilityStates)[number];
export function validPlaybackDiagnostics(value: ExtensionDiagnostics): boolean {
  return (
    Object.keys(value).length === 1 &&
    sponsorPlaybackStates.includes(value.playback as SponsorPlayback)
  );
}
export function sponsorAvailability(
  item: ExtensionState,
): SponsorAvailability | null {
  const value = item.diagnostics?.main?.availability as SponsorAvailability;
  return sponsorAvailabilityStates.includes(value) ? value : null;
}
export function sponsorPlayback(item: ExtensionState): SponsorPlayback | null {
  const value = item.diagnostics?.page?.playback as SponsorPlayback;
  return sponsorPlaybackStates.includes(value) ? value : null;
}
