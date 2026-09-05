"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { errorText } from "@/lib/i18n";
import { useLocale, useT } from "@/lib/i18n/client";

export type AuthMode = "login" | "register";

/**
 * Shared username/password form for /login and /register. Posts JSON to /api/auth/<mode>,
 * shows the API error code translated, and on success navigates to /grid (router.refresh so the
 * layout's user menu re-renders with the new cookie). Password state never leaves this component.
 */
export function AuthForm({ mode, initialInviteCode = "" }: { mode: AuthMode; initialInviteCode?: string }) {
  const t = useT();
  const locale = useLocale();
  const router = useRouter();
  const [inviteCode, setInviteCode] = useState(initialInviteCode);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/auth/${mode}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(mode === "register" ? { inviteCode, username, password } : { username, password }),
      });
      if (res.ok) {
        setPassword("");
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
      setError(errorText(locale, code ?? (res.status === 429 ? "rate_limited" : "unknown")));
    } catch {
      setError(errorText(locale, "network"));
    } finally {
      setBusy(false);
    }
  }

  const isRegister = mode === "register";
  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle>{t(isRegister ? "auth.register.title" : "auth.login.title")}</CardTitle>
        <CardDescription>{t(isRegister ? "auth.register.subtitle" : "auth.login.subtitle")}</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="flex flex-col gap-3" noValidate>
          {isRegister && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="inviteCode">{t("auth.invite_code")}</Label>
              <Input
                id="inviteCode"
                name="inviteCode"
                value={inviteCode}
                onChange={(e) => setInviteCode(e.target.value)}
                autoComplete="off"
                spellCheck={false}
                required
                className="font-mono"
              />
            </div>
          )}
          <div className="flex flex-col gap-1.5">
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
            />
            {isRegister && <p className="text-xs text-muted-foreground">{t("auth.username_hint")}</p>}
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="password">{t("auth.password")}</Label>
            <Input
              id="password"
              name="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={isRegister ? "new-password" : "current-password"}
              required
            />
            {isRegister && <p className="text-xs text-muted-foreground">{t("auth.password_hint")}</p>}
          </div>
          {error && (
            <Alert variant="destructive" aria-live="polite">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <Button type="submit" disabled={busy} className="mt-1">
            {busy ? t("auth.submitting") : t(isRegister ? "auth.register.submit" : "auth.login.submit")}
          </Button>
          <p className="text-center text-xs text-muted-foreground">
            {t(isRegister ? "auth.register.have_account" : "auth.login.no_account")}{" "}
            <Link href={isRegister ? "/login" : "/register"} className="text-foreground underline underline-offset-2">
              {t(isRegister ? "auth.register.login_link" : "auth.login.register_link")}
            </Link>
          </p>
        </form>
      </CardContent>
    </Card>
  );
}
