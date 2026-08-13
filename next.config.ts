import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * Works around a known Next.js/@vercel/nft file-tracing gap where
   * firebase-admin's transitive dependency files (pulled in via
   * google-auth-library/gaxios/jose) get silently dropped from the
   * deployed Node.js-runtime function bundle — this only manifests on
   * Vercel at runtime ("Failed to load external module firebase-admin-...")
   * and not locally, since local dev never goes through this bundling
   * step. firebase-admin is used both in src/proxy.ts (the Node.js-runtime
   * proxy/middleware) and in dashboard Route Handlers via
   * src/lib/firebase/admin.ts, so it's force-included wholesale rather
   * than trying to enumerate the exact missing submodule.
   */
  outputFileTracingIncludes: {
    "/**": ["./node_modules/firebase-admin/**"],
  },
};

export default nextConfig;
