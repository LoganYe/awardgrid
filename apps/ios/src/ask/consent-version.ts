/**
 * The wording a permission for Ask was given for (release decision D10): ./consent.ts keeps it with the permission
 * (in app/settings-store.ts's file), and ./consent-copy.ts holds the wording itself. Raise it when what is sent
 * changes: every earlier permission then counts as none, and the consent sheet asks again.
 *
 * On its own so ./consent.ts, which Ask's service reads, does not bring the consent sheet's sentences along. The App
 * Store build (app/flags.ts STORE) has no Ask, and its bundle carries neither (scripts/check-store-bundle.mjs).
 */
export const ANTHROPIC_CONSENT_VERSION = 1;
