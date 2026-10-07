/**
 * Whether an Ask question is under way. The service runs it, not the Ask screen, so the Search header says so while the
 * person is elsewhere in the app.
 *
 * The App Store build (./flags.ts STORE) has no Ask to run one and no header link to say it: there it is the constant
 * false and never subscribes to the service.
 */
import { useSyncExternalStore } from "react";
import type { AppServices } from "./bootstrap";
import { STORE } from "./flags";

const noSubscription = () => () => {};
const notRunning = () => false;

export function useAskRunning(services: Pick<AppServices, "ask">): boolean {
  const subscribe = STORE ? noSubscription : services.ask.subscribe;
  const read = STORE ? notRunning : services.ask.isRunning;
  return useSyncExternalStore(subscribe, read, read);
}
