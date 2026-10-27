import type { MainExtensionContext, MainExtensionStart } from '../types';
import type { SponsorSegmentsHandler } from './contracts';
import {
  sponsorAvailabilityStates,
  validPlaybackDiagnostics,
  type SponsorAvailability,
} from './diagnostics';
import { createSponsorCoordinator } from './service';
import { createSponsorTransport } from './transport';
export { connectSponsorSegments as connect } from './bridge';

// All SponsorBlock-specific registration and diagnostic schemas live here.
export function sponsorMainContext(context: MainExtensionContext) {
  context.registerPageDiagnostics(validPlaybackDiagnostics);
  context.reportDiagnostics({ availability: 'unknown' });
  return {
    registerSponsorSegments(handler: SponsorSegmentsHandler) {
      if (typeof handler !== 'function')
        throw Error('Invalid SponsorBlock handler.');
      context.registerService(handler);
    },
    reportSponsorAvailability(value: SponsorAvailability) {
      if (value !== 'unknown' && sponsorAvailabilityStates.includes(value))
        context.reportDiagnostics({ availability: value });
    },
  };
}

// Keep rate-limit state across ordinary disable/re-enable cycles, without
// retaining the disabled instance's cache or pending work.
let coordinator: ReturnType<typeof createSponsorCoordinator> | undefined;
export const start: MainExtensionStart = (context) => {
  const sponsor = sponsorMainContext(context);
  coordinator ??= createSponsorCoordinator(createSponsorTransport());
  const instance = coordinator.start(sponsor.reportSponsorAvailability);
  try {
    sponsor.registerSponsorSegments(instance.get);
  } catch (cause) {
    instance.dispose();
    throw cause;
  }
  return () => instance.dispose();
};
