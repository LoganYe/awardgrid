/**
 * The OAuth flavour's runtime parts, in one module that app/bootstrap.ts loads with `import()` only when the build is
 * that flavour (or a test asks for it): the token service client, the token store and its Keychain vault, the connect
 * flow and the native sign-in sheet. The key flavour never loads this chunk, so it registers no SeatsAuth proxy and
 * runs none of this code.
 */
export { TOKEN_SERVICE_TIMEOUT_MS, createTokenBroker } from "./broker";
export { connectSeats } from "./connect";
export { authorizeWithSeats } from "./seats-auth-plugin";
export { TokenKeyStore } from "./token-store";
export { keychainTokenVault } from "./token-vault";
