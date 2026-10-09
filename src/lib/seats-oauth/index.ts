/**
 * Login with Seats.aero for the web app: the account's connection (./store.ts), its renewal and use (./access.ts),
 * connecting (./connect.ts, ./state.ts, ./config.ts), the token service client (./broker.ts) and short-term caching
 * (./retention.ts). The web app has no other way to reach seats.aero: there is no pasted key and no server key.
 */
export {
  SeatsNotConnectedError,
  SeatsRenewalUnavailableError,
  authorizationSecrets,
  renewSeatsAuthorization,
  seatsAuthorization,
  withSeatsAuthorization,
  type SeatsAccessOptions,
} from "./access";
export { type TokenBroker, createTokenBroker } from "./broker";
export { seatsOAuthConfigFromEnv, consentUrl, type SeatsOAuthConfig } from "./config";
export { CONNECT_OUTCOMES, finishConnect, isConnectOutcome, type ConnectOutcome } from "./connect";
export { SHORT_TERM_MAX_AGE_MINUTES, SHORT_TERM_MAX_AGE_MS, purgeSeatsDataForUser, shortTermCutoff, sweepSeatsData } from "./retention";
export { beginConnect, clearPendingStates } from "./state";
export { connectionStatus, deleteConnection, dismissReconnectNotice, isSeatsConnected, reconnectNoticeDue, type ConnectionStatus } from "./store";
