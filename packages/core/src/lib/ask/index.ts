/**
 * Ask: Claude answering award questions on the person's own Anthropic key.
 *
 * Nothing here knows about Capacitor or a WebView (eslint.config.mjs bans `@capacitor/*` in core): the
 * shell injects the native transport, and `createAskClient` refuses to run without one. The tools reach
 * seats.aero the same way, through the grid lane's transport, cache and Quota, which the shell hands over as
 * a `SeatsPort`. Every bound Ask works under is named once, in limits.ts.
 */
export * from "./budget";
export * from "./client";
export * from "./conversation";
export * from "./coverage";
export * from "./errors";
export * from "./guard";
export * from "./limits";
export * from "./loop";
export * from "./markdown";
export * from "./prompt";
export * from "./tools";
