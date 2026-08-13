"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { signUpWithPassword } from "@/lib/dashboard/browser-auth";

export default function SignupPage() {
  const router = useRouter();
  const [businessName, setBusinessName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (!businessName.trim()) {
      setError("Please enter a business name.");
      return;
    }

    setIsSubmitting(true);

    try {
      await signUpWithPassword(email, password);
    } catch (err) {
      const message = err instanceof Error ? err.message : "";
      setError(
        message.toLowerCase().includes("already-in-use") || message.toLowerCase().includes("already registered")
          ? "An account with that email already exists."
          : "Unable to create your account. Please try again."
      );
      setIsSubmitting(false);
      return;
    }

    // create_organization_with_owner() now runs via the service-role
    // client server-side (src/app/api/organizations/route.ts) — it always
    // makes the CALLING (server-verified) Firebase user the owner; the
    // browser only supplies the business name, never an owner/org id. See
    // supabase/migrations/20260813073010_firebase_auth_migration.sql.
    const res = await fetch("/api/organizations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ businessName: businessName.trim() }),
    });

    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setError(body.error ?? "Unable to set up your organization. Please try again.");
      setIsSubmitting(false);
      return;
    }

    router.push("/app/dashboard");
    router.refresh();
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-xl font-semibold tracking-tight text-foreground">EduAI</h1>
          <p className="mt-1 text-sm text-muted">Create your organization</p>
        </div>

        <div className="rounded-lg border border-border bg-surface p-6 shadow-sm">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="businessName" className="mb-1.5 block text-sm font-medium text-foreground">
                Business name
              </label>
              <input
                id="businessName"
                type="text"
                required
                value={businessName}
                onChange={(e) => setBusinessName(e.target.value)}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-1 focus:ring-accent"
                placeholder="Bright Path Academy"
              />
            </div>

            <div>
              <label htmlFor="email" className="mb-1.5 block text-sm font-medium text-foreground">
                Email
              </label>
              <input
                id="email"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-1 focus:ring-accent"
                placeholder="you@business.com"
              />
            </div>

            <div>
              <label htmlFor="password" className="mb-1.5 block text-sm font-medium text-foreground">
                Password
              </label>
              <input
                id="password"
                type="password"
                required
                minLength={6}
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-1 focus:ring-accent"
                placeholder="At least 6 characters"
              />
            </div>

            {error && (
              <p role="alert" className="text-sm text-danger">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
            >
              {isSubmitting ? "Creating your organization…" : "Create organization"}
            </button>
          </form>
        </div>

        <p className="mt-6 text-center text-sm text-muted">
          Already have an account?{" "}
          <Link href="/login" className="font-medium text-accent hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
