import { redirect } from "next/navigation";
import Link from "next/link";
import { getDashboardAuth } from "@/lib/dashboard/auth";
import { SidebarNav } from "@/app/app/sidebar-nav";
import { MobileNav } from "@/app/app/mobile-nav";
import { UserMenu } from "@/app/app/user-menu";
import { SignOutButton } from "@/app/app/sign-out-button";

/**
 * Defense in depth alongside src/proxy.ts: proxy already redirects
 * requests with no session cookie to /login before this ever renders, but
 * Next.js itself warns that proxy/middleware coverage can be silently
 * lost (a matcher change, a refactor). This layout independently
 * re-verifies the Firebase ID token server-side via getDashboardAuth()
 * rather than trusting that proxy definitely ran or that the cookie's
 * mere presence means anything.
 *
 * Organization resolution happens here too, once, for every /app/* route,
 * via the SAME getDashboardAuth() call — it resolves membership using the
 * service-role client filtered by the just-verified Firebase uid, never
 * anything the browser could supply directly.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const auth = await getDashboardAuth();

  if (auth.status === "unauthenticated") {
    redirect("/login");
  }

  const { user, organization: resolution } = auth;

  if (resolution.status === "none") {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background px-4 text-center">
        <p className="text-base font-medium text-foreground">
          You don&apos;t belong to an organization yet.
        </p>
        <p className="max-w-sm text-sm text-muted">
          Ask an organization owner to add you, or create your own organization to get started.
        </p>
        <Link
          href="/signup"
          className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-foreground hover:opacity-90"
        >
          Create your organization
        </Link>
        <SignOutButton className="text-sm text-muted hover:text-foreground hover:underline" />
      </div>
    );
  }

  if (resolution.status === "multiple") {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background px-4 text-center">
        <p className="text-base font-medium text-foreground">
          You belong to more than one organization.
        </p>
        <p className="max-w-sm text-sm text-muted">
          Switching between organizations isn&apos;t available yet — this is coming in a future
          update. Contact support if you need access to a specific one now.
        </p>
        <SignOutButton className="text-sm text-muted hover:text-foreground hover:underline" />
      </div>
    );
  }

  const { organization } = resolution;

  return (
    <div className="flex min-h-screen bg-background">
      <aside className="hidden w-60 shrink-0 flex-col border-r border-border bg-surface lg:flex">
        <div className="border-b border-border px-4 py-4">
          <span className="text-sm font-semibold tracking-tight text-foreground">EduAI</span>
        </div>
        <SidebarNav />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-border bg-surface px-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-2">
            <MobileNav orgName={organization.name} />
            <span className="truncate text-sm font-medium text-foreground">{organization.name}</span>
          </div>
          <UserMenu email={user.email ?? ""} organizationName={organization.name} />
        </header>

        <main className="min-w-0 flex-1 p-4 sm:p-6">{children}</main>
      </div>
    </div>
  );
}
