"use client";

import { useState } from "react";
import { SidebarNav } from "@/app/app/sidebar-nav";
import { MenuIcon, CloseIcon } from "@/components/ui/icons";

export function MobileNav({ orgName }: { orgName: string }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open navigation"
        className="rounded-md p-2 text-foreground hover:bg-surface-hover lg:hidden"
      >
        <MenuIcon className="h-5 w-5" />
      </button>

      {open && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />
          <div className="relative flex h-full w-72 max-w-[80vw] flex-col border-r border-border bg-surface">
            <div className="flex items-center justify-between border-b border-border px-4 py-4">
              <span className="text-sm font-semibold tracking-tight text-foreground">{orgName}</span>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close navigation"
                className="rounded-md p-1 text-muted hover:bg-surface-hover hover:text-foreground"
              >
                <CloseIcon className="h-4 w-4" />
              </button>
            </div>
            <SidebarNav onNavigate={() => setOpen(false)} />
          </div>
        </div>
      )}
    </>
  );
}
