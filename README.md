# AI Operations Platform for Education Centers

A multi-tenant SaaS platform that lets education centers automate customer operations — Telegram conversations, lead capture and qualification, course recommendations, trial-lesson booking, follow-ups and reminders, business-hours-aware responses — through an AI agent backed by verified business data, with human takeover built in. Customers message the business owner's own real Telegram account; the AI replies through that same account, invisibly, with no separate bot for customers to find.

See [docs/architecture.md](docs/architecture.md) for the full system design and milestone plan.

## Stack

- **Frontend/Backend:** Next.js 16 (App Router), TypeScript, Tailwind CSS v4
- **Database:** Supabase Cloud (hosted PostgreSQL) — accessed exclusively via the service-role client; Row Level Security remains enabled as defense in depth, not the active authorization mechanism (see architecture doc)
- **Auth:** Firebase Authentication (dashboard user identity), verified server-side; Supabase holds no auth session
- **AI:** OpenRouter (Claude-compatible model), tool-calling agent loop
- **Messaging:** Telegram — customers message the business owner's own personal Telegram account via [Telegram Business Bot Connections](docs/architecture.md#telegram-messaging-business-bot-connections-not-a-customer-facing-bot), not a separate customer-facing bot; built on the same Bot API webhook infrastructure
- **Deployment:** Vercel

This project targets **hosted Supabase Cloud only** — there is no local/Docker Supabase workflow in normal use (Docker is only needed for the optional pgTAP suite, `npm run db:test` — see Scripts).

## Getting started

```bash
npm install
cp .env.example .env.local   # fill in real values, see below
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) — you'll land on `/login` (or `/app/dashboard` if already signed in). Use `/signup` to create your first organization.

`.env.local` must point at your actual hosted Supabase Cloud project (`SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`) and a real Firebase project (see below) — there is no local/mock mode for either.

## Environment variables

All required variables are documented in [.env.example](.env.example). Copy it to `.env.local` and fill in real values — never commit `.env.local`. Summary:

| Variable | Where used | Notes |
|---|---|---|
| `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` | Server only | Bypasses RLS entirely. The **only** way the app talks to Supabase — Telegram webhook AND dashboard. Every query is scoped by `organization_id` in application code, not RLS. Never expose to the browser. |
| `FIREBASE_PROJECT_ID` / `FIREBASE_CLIENT_EMAIL` / `FIREBASE_PRIVATE_KEY` | Server only | Firebase Admin SDK — verifies ID tokens, mints the session cookie. From your Firebase project's service account. Never expose to the browser. |
| `NEXT_PUBLIC_FIREBASE_API_KEY` / `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` / `NEXT_PUBLIC_FIREBASE_PROJECT_ID` / `NEXT_PUBLIC_FIREBASE_APP_ID` | Client-safe | Firebase client SDK (browser sign in/up/out) and the Identity Toolkit REST API (used by `test:dashboard`). From your Firebase project's web app config. |
| `OPENROUTER_API_KEY` / `OPENROUTER_MODEL` | Server only | AI provider (OpenRouter, OpenAI-compatible). Never exposed to the browser. |
| `CRON_SECRET` | Server only | Authorizes `/api/cron/send-follow-ups` (see `vercel.json`). Vercel sends this automatically as an `Authorization: Bearer` header for cron-triggered requests when configured in your Vercel project; set the same value in both places. Generate with e.g. `openssl rand -hex 32`. |

Telegram bot tokens, webhook secrets, and Business Bot Connection state live in the `telegram_integrations` table, not env vars — nothing to configure there. Each organization registers its own bot from the dashboard's Telegram settings page (`/app/telegram`), then the business owner connects it to their own Telegram account from their own Telegram app — see the "Telegram messaging" section of the architecture doc.

See [docs/architecture.md](docs/architecture.md#auth-firebase-identity--application-layer-authorization) for the full Firebase + Supabase auth model, and why it doesn't require Firebase Identity Platform.

## Project structure

```
src/
  proxy.ts             # verified-Firebase-session-cookie + /app/* auth guard, every request
  app/
    api/
      telegram/webhook/[token]/   # Telegram webhook route handler — direct bot DMs AND Business Bot Connections
      telegram-integration/        # dashboard: register bot, observe business-connection status, disconnect
      cron/send-follow-ups/        # Vercel Cron target: sends due follow-ups/reminders (see vercel.json)
      courses/, customers/, leads/, appointments/, conversations/,
      business-settings/, organization-settings/   # dashboard CRUD API routes (all server-verified org-scoped)
      auth/session/                # sets/clears the httpOnly Firebase session cookie
      organizations/                # org creation during signup (verified caller only)
    login/, signup/                 # unauthenticated auth pages (Firebase client SDK)
    app/
      layout.tsx        # auth guard (defense in depth) + organization resolution + shell
      dashboard/         # Overview: real stats, recent conversations, upcoming appointments
      inbox/             # Conversations: list + thread view, staff replies, human takeover
      customers/, leads/, courses/, appointments/   # full CRUD dashboard pages
      telegram/          # two-step Telegram connect flow (register bot, then observe business-connection status)
      ai-settings/, settings/   # AI configuration (tone, kill switch), organization settings
  lib/
    firebase/        # admin.ts (server-side token verification) / client.ts (browser SDK, lazy-init)
    supabase/        # server.ts — the ONLY Supabase client, service-role, used by both webhook and dashboard
    dashboard/        # auth.ts (getDashboardAuth — verifies session, resolves org), browser-auth.ts, organizations.ts, stats.ts, api-auth.ts
    ai/              # OpenRouter client, agent loop (agent.ts) — channel-agnostic, no Telegram knowledge
    telegram/        # Bot API client (retry/backoff + per-chat throttle), conversation-lock.ts (same-chat concurrency), webhook payload types, normalize.ts (Telegram -> InboundMessage)
    business-hours.ts # working_hours evaluation against the org's own timezone
    services/        # Tenant-scoped, SERVICE-ROLE business logic — webhook/AI-agent paths, incl. follow-ups.ts
supabase/
  migrations/        # SQL migrations
  tests/             # pgTAP tenant-isolation tests (npm run db:test) — defense in depth, requires Docker
  seed.sql           # dev/demo seed data (two organizations)
scripts/
  verify-migrations-structural.mjs      # migrations+seed structural check, no Docker (npm run db:verify)
  test-service-tenant-isolation.mjs     # service-layer tenant isolation, real Supabase Cloud (npm run test:services)
  smoke-test-webhook-pipeline.mjs       # webhook data-layer smoke test, real Supabase Cloud (npm run test:webhook-pipeline)
  test-telegram-business-connection.mts # Business Bot Connections: org resolution, takeover detection, concurrency (npm run test:telegram-business)
  test-m4-receptionist-features.mts     # business hours, conversation lock, follow-ups/reminders (npm run test:m4) — see below
  test-ai-integration.mts               # REAL OpenRouter + real tool call, real Supabase Cloud (npm run test:ai) — see below
  test-appointment-concurrency.mjs      # real concurrent booking requests, real Supabase Cloud (npm run test:appointments)
  test-dashboard-auth.mjs               # real HTTP auth/org-resolution/tenant-isolation tests against a running dev server, real Firebase test users (npm run test:dashboard)
vercel.json                              # Vercel Cron config — schedules /api/cron/send-follow-ups (daily, see note below)
```

**Architectural rule:** the AI agent and API routes never query Supabase directly — everything goes through `src/lib/services/*` (webhook/AI paths) or `src/lib/dashboard/*` (dashboard paths), both server-only and both using the same service-role client, both scoping every query by `organization_id` derived from a server-verified identity. The AI model never receives an organization_id it can control, and the browser never supplies one either — see [docs/architecture.md](docs/architecture.md#core-principle) for why.

## Development status

Foundation, database schema, AI agent, real OpenRouter integration, atomic race-safe appointment booking, the full education-center dashboard (Overview, Courses, Customers, Leads, Appointments, Conversations/Inbox with human takeover, Telegram settings, AI Settings, Organization Settings), and Telegram messaging via Business Bot Connections (customers message the owner's own account, not a separate bot) are all complete. Milestone 4 adds: follow-ups/reminders with a real Vercel Cron sender, business-hours-aware AI responses, policies/FAQ context, lead qualification criteria, Telegram send retry/backoff + rate-limit handling, a same-conversation concurrency guard, and automatic `needs_attention` flagging when the AI fails or a reply can't be delivered. Dashboard identity is Firebase Authentication, verified server-side, with Supabase Cloud as the sole data store (service-role client + application-layer authorization — no Docker, no local Supabase, no Firebase Identity Platform required). See [docs/architecture.md](docs/architecture.md#milestones) for the full milestone plan and current status.

## Scripts

- `npm run dev` — start the dev server
- `npm run build` — production build
- `npm run start` — run the production build
- `npm run lint` — ESLint
- `npx supabase link --project-ref <ref>` then `npx supabase db push --linked` — apply migrations to hosted Supabase Cloud (no Docker involved; this is the normal way to apply schema changes)
- `npm run db:test` — run the pgTAP tenant-isolation suite (defense in depth only — not the active dashboard authorization path; requires Docker/local Supabase, so only run this when you specifically want to re-verify RLS itself)
- `npm run db:verify` — structural check of migrations + seed via embedded WASM Postgres, no Docker required
- `npm run test:services` — service-layer tenant isolation tests against real Supabase Cloud
- `npm run test:webhook-pipeline` — end-to-end smoke test of the webhook data pipeline against real Supabase Cloud
- `npm run test:telegram-business` — Telegram Business Bot Connections: organization resolution from `business_connection_id`, cross-tenant isolation, human-takeover detection, disconnect, concurrency — against real Supabase Cloud
- `npm run test:m4` — business hours logic, same-conversation concurrency lock, and the real follow-ups service against real Supabase Cloud
- `npm run test:ai` — **real OpenRouter integration test, spends real API credit.** See below before running.
- `npm run test:appointments` — real concurrency test proving appointment booking can't be overbooked under simultaneous requests
- `npm run test:dashboard` — real HTTP test of dashboard auth/org-resolution/tenant-isolation against a running dev server (`npm run dev` first) and real Firebase test users; requires `FIREBASE_PROJECT_ID`/`FIREBASE_CLIENT_EMAIL`/`FIREBASE_PRIVATE_KEY`/`NEXT_PUBLIC_FIREBASE_API_KEY` and creates/deletes real (disposable) Firebase accounts and Supabase rows

## `npm run test:ai` — real AI integration test

Unlike every other test script in this project, `test:ai` imports and runs the actual production `src/lib/ai/agent.ts` (unmodified) and makes one real request to OpenRouter. It proves the full loop actually works: the real model receives the real tool schemas, chooses to call `search_courses` on its own (no hardcoded steering), the tool executes through the real tool registry and service layer against the same hosted Supabase Cloud project production uses, and the model's final answer is checked against that real data.

**Before running it:**
- `OPENROUTER_API_KEY` must be set (in `.env.local` or the environment) — the test refuses to run without one rather than mocking the model.
- `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` in `.env.local` must point at a Supabase Cloud project with migrations + seed applied — the same variables and the same project the app itself uses. No local/Docker Supabase and no separate override variables are needed or supported.

**What it does NOT do:** mock OpenRouter, fake a tool call, or bypass the agent. If the real model doesn't call the expected tool, the test fails with a diagnostic — it does not pass on "no tool call."

**Cost:** this makes exactly one real model request per run. Don't run it in a loop, in CI on every commit, or repeatedly while iterating — it spends real API credit each time. Run it deliberately, when you specifically want to verify the live AI integration still works (e.g. after changing the agent loop, tool schemas, or system prompt).

## `npm run test:appointments` — appointment booking concurrency test

Proves appointment booking is race-safe: it creates a disposable, capacity-limited course group (capacity 1) and 5 distinct customers, then fires 5 booking requests at the same time via `Promise.all` (real concurrent network calls to real Postgres, not sequential awaits) and asserts exactly 1 succeeds and the rest fail cleanly as "group full" — verified both from the response and by directly re-querying the database afterward. Also checks tenant isolation, the pre-existing same-customer-double-booking behavior, and a missing-group error, then cleans up everything it created. Free to run repeatedly (no external API calls) — just requires `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` pointed at a project with migrations + seed applied.

## `npm run test:dashboard` — dashboard auth test

Drives a real running Next.js dev server (`npm run dev` in another terminal first) over HTTP against real, disposable Firebase test users and Supabase organizations — no mocking. Creates test users via the Firebase Admin SDK, signs them in via Firebase's real Identity Toolkit REST API (the same mechanism the browser client SDK uses) to get a real ID token, and POSTs it to `/api/auth/session` exactly as the real sign-in flow does, to get a real session cookie. Covers: unauthenticated redirect, per-user organization resolution, cross-tenant isolation over real HTTP, a forged `organizationId` query param having no effect, a tampered session cookie being rejected, sign-out, and the no-organization empty state. Requires `FIREBASE_PROJECT_ID`/`FIREBASE_CLIENT_EMAIL`/`FIREBASE_PRIVATE_KEY` (Admin SDK) and `NEXT_PUBLIC_FIREBASE_API_KEY` (Web API Key, for the REST sign-in call) — fails clearly (does not mock) if any are missing.

See [docs/architecture.md](docs/architecture.md#atomic-appointment-booking-milestone-275) for how the underlying `book_appointment_atomic()` Postgres function prevents the race.

## `npm run test:telegram-business` — Telegram Business Bot Connections test

Imports and runs the real, unmodified `src/lib/services/telegram-integrations.ts`/`customers.ts`/`conversations.ts`/`messages.ts` (same `tsx --conditions=react-server` technique as `test:ai`) against two disposable test organizations, each with their own bot. Covers: recording a `business_connection` webhook update and resolving `organization_id` from `business_connection_id` (including that Org A's connection never resolves to Org B, and an unknown/disabled connection resolves to nothing), inbound customer message storage with idempotent duplicate handling over a business connection, human-takeover mode-flipping (the logic the webhook route uses when it detects the owner replied manually), disconnect clearing live connection state immediately, an owner-initiated disconnect no longer resolving, and 5 concurrent customers processing independently into 5 distinct conversations with no cross-talk or shared locking. Free to run repeatedly — just requires `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` pointed at a project with migrations applied. Creates and cleans up its own fixtures.

## `npm run test:m4` — receptionist features test (Milestone 4)

Three areas, in one script: `checkBusinessHours()` (pure logic — no days configured means always open, an explicit `{ open: null }` means closed, an invalid timezone string fails open rather than throwing or wrongly gating); `withConversationLock()` (pure logic — same-chat calls proven to run strictly one at a time with no interleaving, while different chats run fully independently); and the real `follow-ups.ts` service against disposable fixtures on real Supabase Cloud (scheduling, `listDueFollowUps()` correctly including/excluding rows by `due_at`, `markFollowUpSent`/`markFollowUpFailed`, and tenant isolation on `cancelFollowUp`). Free to run repeatedly — just requires `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` pointed at a project with migrations applied.

## Follow-ups, reminders & the Vercel Cron sender

`src/app/api/cron/send-follow-ups/route.ts` sends every due row in the `follow_ups` table (the AI schedules one via its `create_follow_up` tool). Scheduled by `vercel.json`'s `crons` entry — currently **once daily at 09:00 UTC**, because Vercel's Hobby/free tier only allows daily-or-coarser cron schedules (an every-10-minutes schedule, which is tighter/more correct for reminder timing, requires upgrading to Vercel Pro — change `vercel.json`'s `schedule` back to e.g. `*/10 * * * *` if/when you upgrade). Vercel calls this route with an `Authorization: Bearer <CRON_SECRET>` header it sets automatically once `CRON_SECRET` is configured in your Vercel project's environment variables (set the same value in `.env.local` for parity/local testing). The route refuses to run if `CRON_SECRET` isn't configured at all, and rejects any request whose header doesn't match. Outside of Vercel's own deployment, nothing else calls this route on a schedule — if you deploy elsewhere, you'll need your own scheduler hitting the same URL with the same header.
