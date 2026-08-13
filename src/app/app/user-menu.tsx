"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { signOut } from "@/lib/dashboard/browser-auth";

export function UserMenu({
  email,
  organizationName,
}: {
  email: string;
  organizationName: string | null;
}) {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  async function handleSignOut() {
    await signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <div ref={menuRef} className="relative">
      <button
        type="button"
        onClick={() => setIsOpen((open) => !open)}
        className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-foreground hover:bg-border/50"
        aria-haspopup="menu"
        aria-expanded={isOpen}
      >
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-accent/10 text-xs font-medium text-accent">
          {email.charAt(0).toUpperCase()}
        </span>
        <span className="max-w-[160px] truncate">{email}</span>
      </button>

      {isOpen && (
        <div
          role="menu"
          className="absolute right-0 top-full z-10 mt-1 w-56 rounded-md border border-border bg-surface py-1 shadow-md"
        >
          <div className="border-b border-border px-3 py-2">
            <p className="truncate text-sm font-medium text-foreground">{email}</p>
            {organizationName && <p className="truncate text-xs text-muted">{organizationName}</p>}
          </div>
          <button
            type="button"
            role="menuitem"
            onClick={handleSignOut}
            className="w-full px-3 py-2 text-left text-sm text-foreground hover:bg-border/50"
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
