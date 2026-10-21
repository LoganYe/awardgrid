/**
 * Ask's part of AppServices (../app/bootstrap.ts): the service and the Anthropic key's Keychain item. Every build but
 * the App Store one has it; there (../app/flags.ts STORE) bootstrap never loads Ask's code, and both are absent. Only a
 * build with Ask routes the Ask screens (App.tsx ASK_BUILT), so they read it through `withAsk`.
 */
import type { AppServices } from "../app/bootstrap";

export type AskServices = Required<Pick<AppServices, "ask" | "anthropicKeys">>;

/** `services`, with Ask's part known to be there. Throws in a build without Ask, which has no screen that asks. */
export function withAsk<T extends Partial<AskServices>>(services: T): T & AskServices {
  if (!services.ask || !services.anthropicKeys) throw new Error("This build has no Ask (app/flags.ts STORE).");
  return services as T & AskServices;
}
