import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthForm } from "@/components/shell/auth-form";
import { getCurrentUser } from "@/lib/auth/next";

export const metadata: Metadata = { title: "Register" };

/** /register?code=… — the invite code from the query string is prefilled (kickoff §5). */
export default async function RegisterPage({ searchParams }: { searchParams: Promise<{ code?: string | string[] }> }) {
  const user = await getCurrentUser();
  if (user) redirect("/grid");
  const { code } = await searchParams;
  const initial = (Array.isArray(code) ? code[0] : code) ?? "";
  return (
    <div className="flex justify-center py-10">
      <AuthForm mode="register" initialInviteCode={initial.trim()} />
    </div>
  );
}
