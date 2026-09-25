import type { Metadata } from "next";
import { SavedApp } from "@/components/workspace/saved-app";
import { requireUser } from "@/lib/auth/next";

export const metadata: Metadata = { title: "Saved" };
export const dynamic = "force-dynamic";

export default async function SavedPage() {
  const user = await requireUser();
  return <SavedApp userId={user.id} />;
}
