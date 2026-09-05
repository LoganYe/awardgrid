/**
 * Typed auth failures. Messages are safe to show to the user and never contain usernames,
 * codes, hashes or tokens (kickoff §10: no keys, chat IDs or usernames in errors/logs).
 */
export type AuthErrorCode =
  | "invalid_invite"
  | "username_taken"
  | "invalid_credentials"
  | "weak_password"
  | "invalid_username"
  | "session_expired";

const MESSAGES: Record<AuthErrorCode, string> = {
  invalid_invite: "That invite code is invalid or has already been used.",
  username_taken: "That username is already taken.",
  invalid_credentials: "Wrong username or password.",
  weak_password: "Password must be at least 8 characters.",
  invalid_username: "Username must be 3–32 characters: lowercase letters, digits, '_', '.' or '-'.",
  session_expired: "Your session has expired. Please sign in again.",
};

export class AuthError extends Error {
  readonly code: AuthErrorCode;
  constructor(code: AuthErrorCode, message?: string) {
    super(message ?? MESSAGES[code]);
    this.name = "AuthError";
    this.code = code;
  }
}

export function isAuthError(err: unknown, code?: AuthErrorCode): err is AuthError {
  return err instanceof AuthError && (code === undefined || err.code === code);
}

/** A user-settings field failed validation (locale, timezone, quiet hours). */
export class SettingsValidationError extends Error {
  readonly field: "locale" | "timezone" | "quietHoursStart" | "quietHoursEnd";
  constructor(field: SettingsValidationError["field"], message: string) {
    super(message);
    this.name = "SettingsValidationError";
    this.field = field;
  }
}
