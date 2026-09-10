/**
 * Ask: Claude answering award questions on the person's own Anthropic key.
 *
 * Nothing here knows about Capacitor or a WebView (eslint.config.mjs bans `@capacitor/*` in core): the
 * shell injects the native transport, and `createAskClient` refuses to run without one. Every bound Ask
 * works under is named once, in limits.ts.
 */
export * from "./client";
export * from "./errors";
export * from "./limits";
