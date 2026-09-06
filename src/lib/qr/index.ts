/**
 * QR codes, dependency-free (Phase 6 §5: the Telegram deep link on the settings page).
 *
 *   encodeQr(text)            → { version, size, mask, modules }  byte mode, level M, v1–10
 *   toSvg(modules, options)   → one <svg> with a single <path>, "currentColor" by default
 *   qrSvg(text, options)      → both in one call
 */
export * from "./encode";
