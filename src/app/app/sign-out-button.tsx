"use client";

import { useRouter } from "next/navigation";
import { signOut } from "@/lib/dashboard/browser-auth";

export function SignOutButton({ className }: { className?: string }) {
  const router = useRouter();

  async function handleSignOut() {
    await signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <button type="button" onClick={handleSignOut} className={className}>
      Sign out
    </button>
  );
}
