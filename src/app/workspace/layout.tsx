/**
 * /workspace — the UI/UX v1 Web workspace (T18; laid out in T19). Signed-in only; the account comes from the server's
 * session. The existing /grid, /queries and /settings are unchanged.
 */
import type { ReactNode } from "react";
import { WorkspaceShell } from "@/components/workspace/workspace-shell";
import { requireUser } from "@/lib/auth/next";
import "@/styles/workspace.css";

export const dynamic = "force-dynamic";

export default async function WorkspaceLayout({ children }: { children: ReactNode }) {
  await requireUser();
  return <WorkspaceShell>{children}</WorkspaceShell>;
}
