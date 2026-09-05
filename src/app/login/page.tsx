import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthForm } from "@/components/shell/auth-form";
import { getCurrentUser } from "@/lib/auth/next";

export const metadata: Metadata = { title: "Log in" };

export default async function LoginPage() {
  const user = await getCurrentUser();
  if (user) redirect("/grid");
  return (
    <div className="flex justify-center py-10">
      <AuthForm mode="login" />
    </div>
  );
}
