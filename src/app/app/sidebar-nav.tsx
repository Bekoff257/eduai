"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  OverviewIcon,
  ConversationsIcon,
  CustomersIcon,
  LeadsIcon,
  CoursesIcon,
  AppointmentsIcon,
  TelegramIcon,
  AutomationsIcon,
  AISettingsIcon,
  OrgSettingsIcon,
} from "@/components/ui/icons";

const NAV_ITEMS = [
  { href: "/app/dashboard", label: "Overview", Icon: OverviewIcon },
  { href: "/app/inbox", label: "Conversations", Icon: ConversationsIcon },
  { href: "/app/customers", label: "Customers", Icon: CustomersIcon },
  { href: "/app/leads", label: "Leads", Icon: LeadsIcon },
  { href: "/app/courses", label: "Courses", Icon: CoursesIcon },
  { href: "/app/appointments", label: "Appointments", Icon: AppointmentsIcon },
  { href: "/app/automations", label: "Automations", Icon: AutomationsIcon },
  { href: "/app/telegram", label: "Telegram", Icon: TelegramIcon },
  { href: "/app/ai-settings", label: "AI Settings", Icon: AISettingsIcon },
] as const;

const SETTINGS_ITEM = { href: "/app/settings", label: "Organization Settings", Icon: OrgSettingsIcon };

export function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();

  function isActive(href: string) {
    return pathname === href || pathname?.startsWith(`${href}/`);
  }

  function linkClasses(active: boolean) {
    return `flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
      active
        ? "bg-accent/10 text-accent"
        : "text-foreground/80 hover:bg-surface-hover hover:text-foreground"
    }`;
  }

  return (
    <nav className="flex flex-1 flex-col gap-0.5 p-3">
      {NAV_ITEMS.map(({ href, label, Icon }) => (
        <Link key={href} href={href} onClick={onNavigate} className={linkClasses(isActive(href))}>
          <Icon className="h-4 w-4 shrink-0" />
          {label}
        </Link>
      ))}

      <div className="mt-auto pt-3">
        <Link
          href={SETTINGS_ITEM.href}
          onClick={onNavigate}
          className={linkClasses(isActive(SETTINGS_ITEM.href))}
        >
          <SETTINGS_ITEM.Icon className="h-4 w-4 shrink-0" />
          {SETTINGS_ITEM.label}
        </Link>
      </div>
    </nav>
  );
}
