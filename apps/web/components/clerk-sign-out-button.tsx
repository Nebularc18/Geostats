"use client";

import { useClerk } from "@clerk/nextjs";
import { useRouter } from "next/navigation";

export function ClerkSignOutButton({ onLocalLogout }: { onLocalLogout: () => Promise<void> }) {
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
    <button className="ghost-button" type="button" onClick={() => void signOutEverywhere()}>
      Sign out
    </button>
  );
}
