/**
 * Ask's runtime parts, in one module that app/bootstrap.ts loads with `import()` only in a build that has Ask (every
 * build but the App Store one, app/flags.ts STORE), as it loads ../oauth/kit.ts only in the OAuth flavour: the service
 * and its conversation file, the permission it checks before every question, the Anthropic key's Keychain item, and
 * Anthropic's idle timeout for its own transport.
 *
 * The App Store build never loads this chunk, so none of it is in that bundle: no Ask service, tool runner or prompt,
 * no Anthropic SDK, no Anthropic endpoint and no Keychain item for an Anthropic key (scripts/check-store-bundle.mjs).
 */
export { ANTHROPIC_IDLE_TIMEOUT_MS } from "@awardgrid/core/ask/limits";
export { createAskService } from "./ask-service";
export { aiConsent } from "./consent";
export { anthropicKeychain } from "../native/anthropic-key";
export { AskStore } from "../store/ask-store";
