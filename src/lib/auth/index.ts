/**
 * Public surface of the auth module. Deliberately does NOT re-export ./next (server-only,
 * touches next/headers) so that plain library code and tests can import "@/lib/auth" freely;
 * import "@/lib/auth/next" directly from pages, actions and route handlers.
 */
export * from "@/lib/auth/errors";
export * from "@/lib/auth/clock";
export * from "@/lib/auth/password";
export * from "@/lib/auth/invites";
export * from "@/lib/auth/users";
export * from "@/lib/auth/session";
