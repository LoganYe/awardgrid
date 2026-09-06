import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthForm } from "@/components/shell/auth-form";
import { getCurrentUser } from "@/lib/auth/next";

export const metadata: Metadata = { title: "Log in" };

/** /login — a 360 px column centered both ways: product name + form only (spec §2). */
export default async function LoginPage() {
  const user = await getCurrentUser();
  if (user) redirect("/grid");
  return (
    <div className="mx-auto my-auto w-full max-w-auth py-8">
      <AuthForm mode="login" />
    </div>
  );
}
