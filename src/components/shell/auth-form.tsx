"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { clearAskSession } from "@/components/ask/history";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { errorText } from "@/lib/i18n";
import { useLocale, useT } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";

export type AuthMode = "login" | "register";
/** Mirrors the API rule (src/lib/auth/users.ts `weak_password`). */
const PASSWORD_MIN_LENGTH = 8;
type Field = "inviteCode" | "username" | "password";

/** Which field an API error code belongs under; unknown codes sit under the last field. */
function fieldFor(code: string): Field {
  switch (code) {
    case "invalid_invite":
      return "inviteCode";
    case "username_taken":
    case "invalid_username":
      return "username";
    default:
      return "password";
  }
}

/**
 * The /login and /register form (docs/UI_PLAN.md §6.9): product name, page title, fields, one
 * full-width primary button, one line to the other page. No card, no border, no shadow. Errors
 * render inline under the field they belong to. Password state never leaves this component.
 */
export function AuthForm({ mode, initialInviteCode = "" }: { mode: AuthMode; initialInviteCode?: string }) {
  const t = useT();
  const locale = useLocale();
  const router = useRouter();
  const [inviteCode, setInviteCode] = useState(initialInviteCode);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<{ field: Field; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const isRegister = mode === "register";
  const passwordOk = password.length >= PASSWORD_MIN_LENGTH;

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/auth/${mode}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(isRegister ? { inviteCode, username, password } : { username, password }),
      });
      if (res.ok) {
        setPassword("");
        // Belt and braces with LogoutButton: whoever was in this tab before, their Ask history
        // does not follow the new session (sessionStorage survives a same-tab navigation).
        clearAskSession();
        router.push("/grid");
        router.refresh();
        return;
      }
      let code: string | undefined;
      try {
        code = ((await res.json()) as { error?: string }).error;
      } catch {
        code = undefined;
      }
      const resolved = code ?? (res.status === 429 ? "rate_limited" : "unknown");
      setError({ field: fieldFor(resolved), text: errorText(locale, resolved) });
    } catch {
      setError({ field: "password", text: errorText(locale, "network") });
    } finally {
      setBusy(false);
    }
  }

  function fieldError(field: Field) {
    if (error?.field !== field) return null;
    return (
      <p id={`${field}-error`} role="alert" className="t-meta text-error">
        {error.text}
      </p>
    );
  }
  const describedBy = (field: Field, hintId?: string) =>
    [error?.field === field ? `${field}-error` : null, hintId ?? null].filter(Boolean).join(" ") || undefined;

  return (
    <div className="flex w-full flex-col gap-8">
      <p className="t-body font-medium text-fg">{t("app.name")}</p>
      <div className="flex flex-col gap-6">
        <h1 className="t-title">{t(isRegister ? "auth.register.title" : "auth.login.title")}</h1>
        <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
          {isRegister && (
            <div className="flex flex-col gap-1">
              <Label htmlFor="inviteCode">{t("auth.invite_code")}</Label>
              <Input
                id="inviteCode"
                name="inviteCode"
                value={inviteCode}
                onChange={(e) => setInviteCode(e.target.value)}
                autoComplete="off"
                spellCheck={false}
                required
                aria-invalid={error?.field === "inviteCode" || undefined}
                aria-describedby={describedBy("inviteCode")}
              />
              {fieldError("inviteCode")}
            </div>
          )}
          <div className="flex flex-col gap-1">
            <Label htmlFor="username">{t("auth.username")}</Label>
            <Input
              id="username"
              name="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              required
              aria-invalid={error?.field === "username" || undefined}
              aria-describedby={describedBy("username", isRegister ? "username-hint" : undefined)}
            />
            {isRegister && (
              <p id="username-hint" className="t-meta text-fg-muted">
                {t("auth.username_hint")}
              </p>
            )}
            {fieldError("username")}
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="password">{t("auth.password")}</Label>
            <Input
              id="password"
              name="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={isRegister ? "new-password" : "current-password"}
              required
              aria-invalid={error?.field === "password" || undefined}
              aria-describedby={describedBy("password", isRegister ? "password-hint" : undefined)}
            />
            {isRegister && (
              // The rule reads muted until the typed password satisfies it, then in --fg (plan §6.9).
              <p id="password-hint" data-satisfied={passwordOk || undefined} className={cn("t-meta", passwordOk ? "text-fg" : "text-fg-muted")}>
                {t("auth.password_hint")}
              </p>
            )}
            {fieldError("password")}
          </div>
          <Button type="submit" size="lg" disabled={busy} className="mt-2 w-full">
            {busy
              ? t(isRegister ? "auth.register.submitting" : "auth.login.submitting")
              : t(isRegister ? "auth.register.submit" : "auth.login.submit")}
          </Button>
          <p className="t-meta text-fg-muted">
            {t(isRegister ? "auth.register.have_account" : "auth.login.no_account")}{" "}
            <Link href={isRegister ? "/login" : "/register"} className="link">
              {t(isRegister ? "auth.register.login_link" : "auth.login.register_link")}
            </Link>
          </p>
        </form>
      </div>
    </div>
  );
}
