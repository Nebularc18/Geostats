"use client";

import { useClerk } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";

export function ClerkSignOutButton({ collapsed = false, onLocalLogout }: { collapsed?: boolean; onLocalLogout: () => Promise<void> }) {
  const { signOut } = useClerk();
  const router = useRouter();

  async function signOutEverywhere() {
    try {
      await onLocalLogout();
    } finally {
      await signOut();
      router.push("/login");
    }
  }

  return (
    <button className="ghost-button" type="button" onClick={() => void signOutEverywhere()} aria-label="Sign out" title={collapsed ? "Sign out" : undefined}>
      <LogOut size={18} aria-hidden="true" />
      <span className="nav-label">Sign out</span>
    </button>
  );
}
