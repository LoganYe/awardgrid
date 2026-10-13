/**
 * Whether an Ask question is under way. The service runs it, not the Ask screen, so the Search header says so while the
 * person is elsewhere in the app.
 *
 * The App Store build (./flags.ts STORE) has no Ask to run one and no header link to say it: there it is the constant
 * false and never subscribes to anything (its services have no `ask`, ./bootstrap.ts).
 */
import { useSyncExternalStore } from "react";
import type { AppServices } from "./bootstrap";
import { STORE } from "./flags";

const noSubscription = () => () => {};
const notRunning = () => false;

export function useAskRunning(services: Pick<AppServices, "ask">): boolean {
  const ask = STORE ? undefined : services.ask;
  const subscribe = ask ? ask.subscribe : noSubscription;
  const read = ask ? ask.isRunning : notRunning;
  return useSyncExternalStore(subscribe, read, read);
}
