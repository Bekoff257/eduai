# Architecture

## What this is

Not a chatbot. An AI-powered business operations system for education centers: it talks to customers on Telegram, answers questions from verified structured business data, captures and qualifies leads, books trial lessons, sends follow-ups, and hands off to a human staff member when needed. Business owners get a dashboard over all of it.

## Core principle

The AI model is one component inside the application, not the application itself.

```
Customer → Telegram (DMs the business owner's OWN account) → Telegram Bot API webhook
         (via a Business Bot Connection, or a direct bot DM)
  → our backend → AI agent → tools → services (tenant-scoped) → Supabase
                                                     ↓
                                          Business Dashboard
```

The backend controls authentication, authorization, database access, tool execution, validation, rate limits, logging, and human takeover. The model never gets direct database, SQL, HTTP, or shell access — only backend-defined tools with strict input schemas.

**Enforced boundary:** `getSupabaseServiceClient()` (`src/lib/supabase/server.ts`) is the only way anything in this app queries Supabase — `src/lib/services/*` (webhook/AI-agent paths) and `src/lib/dashboard/*` (dashboard paths) are the only callers, and both are server-only (`import "server-only"`), so the service-role key can never reach the browser. Every caller scopes its own queries by `organization_id`, derived from a server-verified identity (Telegram `webhook_token` or `business_connection_id`, or a Firebase ID token — see Auth section), never from client input.

## Multi-tenancy

Every business is an `organization`. Every organization-owned table carries `organization_id`. Isolation is enforced at the application layer: every function in `src/lib/services/*` and `src/lib/dashboard/*` takes/derives an `organizationId` from a server-verified identity and includes it in every query — see "Auth: Firebase identity + application-layer authorization" below for why this, rather than Supabase RLS, is the real enforcement point for the dashboard. RLS remains enabled as defense in depth (see "Row Level Security implementation").

Never rely on frontend filtering alone.

## Auth: Firebase identity + application-layer authorization

**Firebase Authentication** is the identity provider for dashboard users. **Supabase Cloud** (hosted, not local/Docker) is data storage only — it holds no auth session for the dashboard at all. There is no Supabase Auth, no `auth.users` table in use, and no RLS-based authorization path for dashboard requests. Concretely:

```
Browser
  → signs in/up via the Firebase client SDK (src/lib/firebase/client.ts,
    firebase/auth) — email+password, directly against Firebase, no
    Supabase involvement at this step
  → POSTs the resulting Firebase ID token to POST /api/auth/session
Next.js server (src/app/api/auth/session/route.ts)
  → verifies the ID token via firebase-admin (src/lib/firebase/admin.ts,
    verifyFirebaseIdToken() — real cryptographic verification against
    Google's public keys, not just decoding)
  → sets it as an httpOnly, sameSite=lax session cookie
    (SESSION_COOKIE_NAME, src/lib/dashboard/session-cookie.ts)
Every subsequent /app/* request
  → src/proxy.ts re-verifies the cookie server-side and redirects to
    /login if missing/invalid (route-guard layer)
  → src/lib/dashboard/auth.ts's getDashboardAuth() independently
    re-verifies the SAME cookie again (defense in depth — Next.js's own
    docs warn proxy/middleware coverage can be silently lost) and resolves
    the caller's organization membership via resolveOrganization(uid)
    (src/lib/dashboard/organizations.ts), which queries Supabase with the
    SERVICE-ROLE client filtered by the server-verified firebase_uid —
    never by anything the browser supplies
```

**Why not Firebase + Supabase RLS together (the original Milestone 1 design):** making Supabase's `auth.uid()`/RLS machinery recognize a Firebase identity requires either upgrading the Firebase project to **Identity Platform** (to mint Supabase-compatible custom-claim tokens) or deploying **blocking Cloud Functions**, purely as integration plumbing — no product requirement needed it. Milestone 1 initially built this, then explicitly reversed it in favor of Supabase-native `auth.uid()` (no Firebase). Firebase was later reinstated as the identity provider (this document's current state) using a *different* mechanism than the original bridge: Firebase Admin verifies the token server-side, and the service-role Supabase client — already used for the entire Telegram webhook pipeline (see below) — is used for the dashboard too, with authorization enforced in application code instead of RLS. This avoids Identity Platform/Cloud Functions entirely while keeping Firebase as the identity provider, by reusing a pattern (verified-external-identity → service-role client → app-layer `organization_id` scoping) already proven out for the webhook.

**The service-role client is now the only Supabase access path, for both the webhook and the dashboard.** `getSupabaseServiceClient()` (`src/lib/supabase/server.ts`) bypasses RLS entirely and is used by: the Telegram webhook (a Telegram user has no Supabase identity of any kind), and every dashboard code path (`src/lib/dashboard/*`), now that there is no Supabase Auth session for RLS to key off. **It must never be used in browser/client code** — only from server-only modules (`import "server-only"` at the top of `src/lib/supabase/server.ts` enforces this at build time). Every caller is responsible for scoping its own queries by `organization_id`; nothing does that automatically anymore.

**Never trust a client-supplied `organizationId`.** There is no such parameter anywhere in the dashboard's routes, pages, or API bodies — `organizationId` always originates from `resolveOrganization(firebaseUid)`, where `firebaseUid` came from a `verifyFirebaseIdToken()` call against the session cookie, never from anything the browser sends directly.

**Deployment note — `jose` override for `firebase-admin` on Vercel:** `package.json`'s `overrides` field pins the transitive dependency `firebase-admin → jwks-rsa → jose` to `jose@5.10.0` instead of jwks-rsa's own declared `^6.1.3`. Without this, every route returns 500 in production (though it works fine in local `next dev`) with `Error [ERR_REQUIRE_ESM]: require() of ES Module .../jose/dist/webapi/index.js ... not supported` — `jose` 6.x dropped CommonJS support entirely (ESM-only `exports`), but `jwks-rsa@4.1.0` (the latest release, pulled in by `firebase-admin@14.x`) still does a plain CommonJS `require("jose")` at module load time. This is a known, unresolved upstream issue (`auth0/node-jwks-rsa#493`) — `firebase-admin`'s standard ID-token verification path (`getAuth().verifyIdToken()`, used throughout this app) never actually calls into `jwks-rsa`'s JWKS-fetching code at runtime, but `firebase-admin`'s `auth` module imports `jwks-rsa` unconditionally at the top of the file, so the crash happens at import time regardless of which code path is actually used. `jose@5.10.0` is the last CJS-compatible major and exposes the same `importJWK`/`exportSPKI` APIs `jwks-rsa` actually calls, so the downgrade is functionally safe despite jwks-rsa's package.json declaring a `^6.1.3` requirement it doesn't strictly need. **Do not remove this override without confirming the underlying jwks-rsa/jose/firebase-admin versions have actually fixed the CJS/ESM incompatibility upstream first** — removing it will silently work in local dev and only fail once deployed.

## Dashboard authentication & app shell

The authenticated business dashboard lives under `/app/*`.

**Route structure:** `/login`, `/signup`, `/app/dashboard` (real), `/app/{inbox,customers,leads,courses,calendar,settings}` (placeholder "coming soon" pages). `/` and `/app` both redirect to `/app/dashboard` (proxy handles the auth gate either way).

**Organization resolution:** `organization_members` has no unique constraint on `firebase_uid` alone — a user can belong to more than one organization at the schema level, but there is no organization-switcher UI yet. `getDashboardAuth()`/`resolveOrganization()` return one of three states, each rendered explicitly rather than guessed: `none` (empty state, link to `/signup` — **never silently auto-created**), `single` (normal dashboard), `multiple` (explicit "not supported yet" message; picking one arbitrarily was rejected as an unreviewed product decision, not an engineering shortcut).

**Signup:** `/signup` calls `signUpWithPassword()` (`src/lib/dashboard/browser-auth.ts` — Firebase client SDK `createUserWithEmailAndPassword`, then syncs the session cookie) followed by `POST /api/organizations`, which verifies the session cookie server-side and calls `create_organization_with_owner()` (Postgres RPC, `security definer`, now takes `owner_firebase_uid` — see migration below — always makes the *verified caller* the owner; no owner/org id parameter exists for a client to override).

**Dashboard data access:** `src/lib/dashboard/organizations.ts` and `src/lib/dashboard/stats.ts` both call `getSupabaseServiceClient()` internally and take a server-verified `firebaseUid`/`organizationId` as their authorization input — for these modules, that id **is** the real authorization boundary (RLS is not consulted), so every caller must guarantee it came from a verified `resolveOrganization(firebaseUid)` call, never from user input.

**Sign-out:** must happen in the browser (Firebase's client SDK owns the local session), so sign-out is a client-side action (`signOut()` in `browser-auth.ts`, wired into `SignOutButton`/`user-menu.tsx`) that calls Firebase `signOut()` then `DELETE /api/auth/session` to clear the server cookie — unlike sign-in, this cannot be a server action.

## Row Level Security implementation (defense in depth, not the active dashboard gate)

**As of the Firebase Auth migration (`supabase/migrations/20260813073010_firebase_auth_migration.sql`), RLS's `auth.uid()`-based policies can never fire for a real request** — there is no Supabase Auth session anywhere in the app anymore, so no request ever executes as the `authenticated` Postgres role. The policies, `enable row level security`, and `force row level security` statements below are left in place deliberately, as a second line of defense (if a future code path were ever mistakenly given a real Supabase session, RLS would still correctly isolate tenants) and because `supabase/tests/tenant_isolation_test.sql` still exercises them directly by simulating `auth.uid()` — see Testing. They are not what actually protects dashboard requests today; application-layer authorization (previous section) is.

Every organization-owned table (all 15) has `enable row level security` **and** `force row level security` (the latter matters because the migrations run as the table owner, who RLS otherwise exempts by default). Two helper functions in `supabase/migrations/20260810111625_rls_policies.sql` centralize the authorization logic so it isn't copy-pasted per table:

- `is_org_member(org_id)` — true if the caller is an active member of `org_id`.
- `is_org_admin(org_id)` — true if the caller is an active `owner`/`admin` of `org_id`.

Both are `security definer`, which is required, not optional: `organization_members` has RLS enabled on itself, and its own `select` policy calls `is_org_member()`. Without `security definer`, that function's internal query against `organization_members` would itself be subject to `organization_members`'s RLS policy — which calls `is_org_member()` again — and Postgres raises `"infinite recursion detected in policy for relation organization_members"`. This was caught during implementation (see Testing below) and is the standard, documented fix for self-referential membership-table policies.

A `assert_same_organization()` trigger (not RLS) additionally guards against a subtler bypass: RLS confirms the *lead* (say) belongs to the caller's org, but nothing about RLS stops a same-org insert from pointing `customer_id`/`course_id` at a *different* organization's row — an application bug could otherwise link Org A's lead to Org B's customer and leak data through that join. The trigger raises an exception if a row's `customer_id`/`course_id` doesn't belong to the same `organization_id` as the row itself.

`organizations` has no client-facing insert policy — creating an organization and its owning membership row must happen atomically, so it goes through `create_organization_with_owner()`, a `security definer` function that always makes the *caller* (never a client-supplied UID) the new owner.

**Table-level GRANTs, separate from RLS:** RLS controls which *rows* a role sees; Postgres checks table-level `GRANT`s *first*, before RLS is ever consulted. `supabase/migrations/20260813045734_grant_table_privileges.sql` grants `authenticated`/`anon` exactly the CRUD operations their RLS policies support (discovered missing when the pgTAP suite failed with "permission denied" before reaching any policy). `supabase/migrations/20260813053312_grant_service_role_table_privileges.sql` grants the same to `service_role` (discovered missing when Milestone 2's webhook code, which uses the service-role client exclusively, hit the identical error against a real local Supabase instance) — `service_role` already bypasses RLS unconditionally by design, so this grant doesn't change what it can access, it just lets it reach the tables at all locally. Supabase Cloud auto-grants this for new tables by default; this project's `supabase/config.toml` has `auto_expose_new_tables` unset (defaults to off, matching Supabase's own upcoming platform-wide default), so these grants are explicit rather than relied upon implicitly.

## Database schema (Milestone 1, updated by the Firebase Auth migration)

Tables: `organizations`, `organization_members`, `business_settings`, `telegram_integrations`, `courses`, `course_groups`, `customers`, `leads`, `conversations`, `messages`, `appointments`, `follow_ups`, `ai_actions`, `human_takeovers`, `audit_logs`.

`organization_members.firebase_uid` (text, not null, unique per `organization_id`) is the real identity column the app uses — populated from a verified Firebase ID token, no foreign key (Supabase holds no table of Firebase users to reference). `audit_logs.actor_firebase_uid` (text, nullable) is the equivalent for audit records. `organization_members.user_id` and `audit_logs.actor_user_id` still exist (originally FKs to Supabase Auth's `auth.users(id)`) but are now dead columns with their FK constraints dropped — kept only as fixture-only scaffolding so `supabase/tests/tenant_isolation_test.sql` can keep exercising RLS's `auth.uid()`-based policies as defense in depth. **Real application code never reads or writes `user_id`/`actor_user_id` — only `firebase_uid`/`actor_firebase_uid`.**

Design principle: structured data over prose. Business facts (prices, schedules, capacity) live in typed columns the AI can reason over precisely — never as free-text blobs the model has to parse or, worse, invent from a system prompt.

## Telegram messaging: Business Bot Connections, not a customer-facing bot

**Product requirement:** customers message the business owner's own personal Telegram account — never a separate bot. Two architectures were evaluated for this:

1. **MTProto user-account automation ("userbot")** — programmatically logging in as the owner's real Telegram account (via a library like GramJS) and intercepting/replying to their DMs directly. **Rejected.** Telegram's API Terms of Service restrict automated behavior on user accounts (that's what the separate Bot API exists for), and current practitioner reports describe Telegram's abuse detection flagging automated-reply patterns on personal accounts even at low volume — the failure mode is the account being rate-limited or banned, which for this product means the business owner's real personal Telegram identity, not a disposable resource. The natural client library for this approach (GramJS) was also archived by its maintainer as of this design, leaving only unproven community forks. Both risks were judged too severe for production infrastructure.
2. **Telegram Business Bot Connections** — Telegram's own officially sanctioned mechanism for exactly this scenario (`core.telegram.org/api/business`, `core.telegram.org/api/bots/connected-business-bots`). The business owner enables **Telegram Business → Chatbots** on their own personal account and connects our existing bot to it. Once connected, DMs to the owner's real account arrive at our bot as `business_message` updates over the **same Bot API webhook infrastructure already in place** — no separate protocol, no persistent worker process, no session-credential encryption. Replies sent with `business_connection_id` appear to the customer exactly as if the owner typed them themselves — no bot label, no "via" attribution. **Connecting a bot this way does not require Telegram Premium or a paid Telegram Business subscription** — it's an explicitly free exception in Telegram's own docs, which matters for this product's small-business customer base. **Adopted.**

This means the bot/webhook/`telegram_integrations` infrastructure from Milestone 2 is **extended, not replaced** — the same bot still exists and still receives updates over the same webhook URL; Business Bot Connections adds a second way a chat resolves to an organization (via a connected business account) alongside the original way (a direct DM to the bot itself, still supported).

### Two-step setup

```
Step 1 (our dashboard, /app/telegram):
  Org admin pastes a bot token from @BotFather → we verify it (getMe),
  store it, register the webhook. The bot itself is never messaged by
  customers directly — this step is backend plumbing.

Step 2 (the owner's own Telegram app, NOT our dashboard):
  Settings → Telegram Business → Chatbots → add the bot from step 1 →
  grant it "reply" + "read messages" rights.
  This is entirely out-of-band from us — we only OBSERVE its result, via
  a business_connection webhook update Telegram sends our bot once the
  owner does this. The dashboard polls for this and reflects live status;
  there is no "connect" action we can trigger from our side for step 2.
```

### Message flow

```
Telegram → POST /api/telegram/webhook/[token]
  1. resolve organization from [token] (telegram_integrations.webhook_token)
  2. verify X-Telegram-Bot-Api-Secret-Token header against that integration's webhook_secret
  business_connection update (owner connected/reconfigured/disconnected the bot):
    → upsert business_connection_id/is_enabled/rights/owner identity onto
      the integration row (src/lib/services/telegram-integrations.ts#upsertBusinessConnection),
      keyed by bot_token (the only identifier available at this point)
    → ack, done — not a customer message
  business_message update (DM to the owner's connected account):
    → RE-resolve organizationId from business_connection_id (not just the
      webhook_token from step 1) — rejects a stale/disabled connection
      even if the webhook URL itself is still valid
    → if from.id === the connection's own owner user id and it wasn't
      sent by our bot (no sender_business_bot field): the OWNER replied
      MANUALLY in their own Telegram app. Telegram gives no explicit
      "human took over" event for this, so it's inferred from these two
      facts — flip conversations.mode to "human" (same mechanism the
      dashboard's "Take over" button uses) and stop, so the AI doesn't
      respond alongside the owner's own reply
    → otherwise: a genuine customer message, continue below
  message update (direct DM to the bot itself — still supported):
    → organizationId is the webhook_token's own integration row
  3. find/create customer (upsert keyed on organization_id + telegram_chat_id — same
     concept/column for both a direct bot DM and a business-connection DM)
  4. find/create the customer's open conversation
  5. store incoming message — idempotent on (organization_id, telegram_update_id);
     a retried Telegram delivery is a no-op here and processing stops
  6. conversation.mode: HUMAN → stop, never invoke the agent; AI → continue.
     Independently, business_settings.ai_enabled (dashboard AI Settings kill switch) is checked too.
  7. load recent message history for this conversation
  8. run the AI agent (src/lib/ai/agent.ts) with controlled tools — UNCHANGED, see Channel abstraction below
  9. store the AI's response
  10. send the response via the Telegram Bot API — with business_connection_id
      when replying to a business-connection chat, so it appears as the
      owner's own message to the customer
```

Implemented in `src/app/api/telegram/webhook/[token]/route.ts`, using the service-role client throughout (`src/lib/supabase/server.ts`) — a Telegram user (customer or business owner) has no Supabase identity of any kind, so RLS's `auth.uid()` path doesn't apply here; tenant isolation for this whole pipeline is enforced by the service layer's own `organization_id` filters (`src/lib/services/*.ts`), verified independently of RLS by `scripts/test-service-tenant-isolation.mjs` (`npm run test:services`) and `scripts/test-telegram-business-connection.mts` (`npm run test:telegram-business`). This is now the same pattern the dashboard uses too — see "Auth: Firebase identity + application-layer authorization" above. The route always returns `200` once the org/secret are verified, even if downstream processing throws — Telegram retries non-2xx responses, and retrying a genuine processing bug doesn't fix it, it just repeats it.

**Constraint to design around:** the `reply` right Telegram grants only permits replying to a business chat with an incoming message in the **last 24 hours** — same shape as the classic Bot API customer-service messaging window.

**Concurrency:** unaffected by this change — the webhook remains a stateless, request-scoped Next.js Route Handler (no persistent connections, no shared locks). Different customers' messages are independent requests processed independently; conversation-specific ordering is preserved only by each message's own DB write order within its own conversation, same as before.

**telegram_integrations schema additions** (`supabase/migrations/20260813092027_telegram_business_connections.sql` and two follow-ups): `business_connection_id` (unique per connection, the lookup key for a `business_message`), `business_connection_enabled` (mirrors the connection's live `is_enabled` state), `business_connection_rights` (raw granted rights, stored for reference), `business_owner_name` and `business_owner_user_id` (the connected account's own identity — the latter is what makes manual-reply detection possible). All additive; the original `bot_token`/`webhook_token`/`webhook_secret`/`bot_username` columns are unchanged and still in active use.

Not implemented (per spec): non-text messages (photos, stickers, edited messages — acknowledged and skipped via `normalizeTelegramUpdate` returning `null`), multilingual behavior beyond "respond in the customer's language" as a system-prompt instruction, and follow-up reminders.

## Channel abstraction

The agent and tools never see anything Telegram-specific — confirmed true even after the Business Bot Connections migration: `src/lib/ai/agent.ts` (`runAgent`) required **zero changes**. It only ever receives `{ organizationId, conversationId, customerId }` + conversation history + text; whether that text arrived via a direct bot DM or a business-connection DM is entirely resolved and normalized away before `runAgent` is ever called. `src/lib/telegram/normalize.ts` is the only code that translates a Telegram `Update` into the channel-agnostic `InboundMessage` shape (`src/lib/ai/types.ts`), and now handles both `update.message` and `update.business_message` as the same shape of input:

```ts
InboundMessage { channel, organizationId, externalUserId, messageId, text, timestamp, metadata }
AgentResponse  { text, actions, leadUpdated, appointmentCreated }
```

Adding a second channel later means writing a sibling `normalize.ts` that also produces an `InboundMessage` and calling `runAgent()` the same way — `src/lib/ai/agent.ts` and `src/lib/ai/tools/*` require no changes.

## AI agent (Milestone 2)

`src/lib/ai/agent.ts` runs a tool-calling loop against OpenRouter (`src/lib/ai/client.ts`, model configured via `OPENROUTER_MODEL`): system prompt (`src/lib/ai/system-prompt.ts`, built from `business_settings` — structured data, not a prose blob) + recent conversation history + the current message, offered the full tool set, up to `MAX_TOOL_ROUNDS` (5) rounds of tool calls before falling back to a safe response. Never fabricates a response on failure (client construction error, OpenRouter request failure, or exhausting the tool-call budget) — returns a fixed fallback string instead, per the failure-handling principle below.

**Tool architecture** (`src/lib/ai/tools/*`, one file each): `search_customer`, `get_customer`, `create_customer`, `search_courses`, `get_course`, `search_course_groups`, `check_available_appointments`, `create_lead`, `update_lead`, `create_appointment`, `create_follow_up` (Milestone 4), `get_conversation_history`. Every tool:

- Has a Zod input schema (`src/lib/ai/tools/types.ts`'s `ToolDefinition`) — validated via `schema.safeParse()` in the agent loop before the handler ever runs; malformed model output becomes a tool-result error fed back to the model, never a thrown exception.
- **Never accepts organization_id, conversation_id, or customer_id as a schema field.** These come from `ToolContext`, a second parameter every handler receives, populated by the webhook route from server-resolved state (the integration lookup, the resolved customer/conversation) — not from the model's tool-call arguments. This is enforced by construction, not convention: no tool's Zod schema has a tenant-identifying field to begin with, so there is nothing for the model to override even if it tried.
- Tools that touch a specific lead/customer (`create_lead`, `update_lead`, `create_appointment`) resolve that lead/customer from `ToolContext`, never from a raw id the model supplies — `update_lead`, for example, resolves "the active lead for this conversation's customer" itself rather than accepting a `leadId` parameter, so the model cannot update a different customer's lead even within the same organization.
- Calls into `src/lib/services/*` (never queries Supabase directly), returns `{ ok, data }` or `{ ok: false, error }`, and every call is logged to `ai_actions` via `logAiAction()` (`src/lib/services/ai-actions.ts`) — success or failure, for the future AI Activity dashboard.

`create_appointment` is capacity-aware and race-safe as of Milestone 2.75 — see "Atomic appointment booking" below.

Tools still deferred (not implemented yet, per the original master-prompt tool list): `cancel_appointment`, `escalate_to_human` (superseded in spirit by the automatic `needs_attention` flagging described in Failure handling below, but no tool lets the model request escalation directly yet). `get_course_info`/`get_available_groups` from the original list are superseded by `get_course`/`search_courses`/`check_available_appointments` per the more specific Milestone 2 tool list.

## Latency instrumentation & webhook-path optimization

`src/lib/timing.ts` provides `timed()`/`startTimer()` — thin `console.log`-based wrappers (`[timing] <label>: <ms>ms`), visible in Vercel Runtime Logs like any other log line. No APM/metrics service is integrated in this project; this is deliberately lightweight so it's safe to leave in permanently rather than a temporary instrument-then-rip-out exercise, since production response latency is an ongoing concern. Every stage of the webhook path (`src/app/api/telegram/webhook/[token]/route.ts`) and the agent loop (`src/lib/ai/agent.ts`) is wrapped: the webhook total, each Supabase call, each OpenRouter request per tool-call round, and each individual tool execution.

**Baseline measurement** (real hosted Supabase + real OpenRouter, `anthropic/claude-sonnet-4.5`): a new customer's first-ever "Hi" (the proactive-intro path, which correctly calls `search_courses` before replying — see the AI agent section above) took **~12.8s end-to-end**: ~37% (11 sequential Supabase round-trips at 350-1100ms each), ~52% two sequential OpenRouter rounds, ~7% the one tool call plus its blocking audit-log write. A **returning** customer's plain "Hi" was already fast (~2.1s, one OpenRouter round, no tool calls) — the slow path was specific to the correctness-required first-reply flow, not the agent in general.

**What was and wasn't changed.** No architecture, model, or AI provider change; no tools removed; no queue introduced; tool-calling and grounding-in-real-data behavior is identical. Four purely mechanical fixes to `processInboundTelegramMessage()` and `runAgent()`:

1. **Eliminated a duplicate `getBusinessSettings` call.** The webhook route already fetches business settings (to check `ai_enabled`) before calling `runAgent()`, which then fetched the identical row again internally to build the system prompt. `runAgent()`'s params gained an optional `businessSettings` field; the webhook route now passes its already-fetched result through, and `runAgent()` only fetches its own copy when the caller doesn't supply one (a no-op change for any other caller).
2. **Parallelized three mutually-independent reads.** `getBusinessSettings`, `listRecentMessages`, and `hasReceivedPriorReply` don't depend on each other's results, but ran sequentially. They're now issued together via `Promise.all`; the `ai_enabled` gate (which only `getBusinessSettings` feeds) is checked after all three resolve rather than before the other two are even started — trading two occasionally-wasted queries (only when AI is disabled for that org) for a strictly faster common case.
3. **Made both `touchConversationLastMessageAt` calls non-blocking.** This write only affects dashboard sort order and is never read again later in the same request, so the customer's reply no longer waits on it. Fired without `await`, still error-logged via `.catch()` (the underlying function throws on failure, so an unhandled rejection would otherwise crash the process).
4. **Made the per-tool-call `logAiAction` audit write non-blocking**, inside `agent.ts`'s tool-calling loop. It writes to a separate `ai_actions` audit table, not to the `messages` transcript sent back to OpenRouter, so the loop's continuation never depended on it completing — consistent with `logAiAction`'s own documented intent that logging failures must never break the agent's response (`src/lib/services/ai-actions.ts`).

**After measurement** (same methodology, same org, real Supabase + real OpenRouter): first-reply "Hi" dropped to **~8.3s** (from ~12.8s) — the Supabase round-trip time collapsed from ~4.7s sequential to effectively parallel, and the redundant `getBusinessSettings`/blocking audit-log time was removed from the critical path. A returning customer's "Hi" measured **~5.1s** for a single OpenRouter round with zero tool calls — this remaining time is OpenRouter/model latency itself, outside this codebase, and was explicitly out of scope (no model or provider change was authorized without first benchmarking that the model itself is the bottleneck, which multi-round cases still are — see baseline above). Tenant isolation, tool-calling correctness, and grounding in real Supabase data are unchanged; verified via `tsc --noEmit`, `eslint`, `next build`, the `test:m4` and `test:telegram-business` suites (both passing, 20/20 each, against hosted Supabase), and a live re-run of the first-reply/returning-customer scenarios against real production data.

## Atomic appointment booking (Milestone 2.75)

**The race:** `course_groups.capacity` is a whole-group seat count (the group represents a recurring cohort like "Mon/Wed/Fri 18:00", not a single slot). Milestone 2's `createAppointment()` checked capacity with a `SELECT` (count existing `scheduled` appointments, compare to `capacity`), then did a separate `INSERT` — flagged explicitly at the time as not race-safe: two concurrent bookings for the *same* group could each pass the `SELECT` (neither transaction can see the other's not-yet-committed insert) and both succeed, overbooking by one seat.

**The fix:** `book_appointment_atomic()` (`supabase/migrations/20260813062432_atomic_appointment_booking.sql`), a `security definer` Postgres function that performs the capacity check and the insert inside one transaction, holding a row lock on the target `course_groups` row for the duration (`select ... for update`). Postgres guarantees a second transaction's `for update` on the same row blocks until the first commits or rolls back — so the second transaction's capacity count is only ever computed *after* the first transaction's insert (if any) is already visible. This makes "successful bookings ≤ capacity" a real, database-enforced invariant for concurrent bookings into the *same* group, not a best-effort application-level check. Bookings into *different* groups never block each other — only the specific group being booked into is locked.

`src/lib/services/appointments.ts#createAppointment()` now calls this function via `supabase.rpc("book_appointment_atomic", ...)` instead of the old select-then-insert, then does one follow-up `SELECT` by the returned id to fetch the full row for its return value. The external contract (`CreateAppointmentResult`, `{ ok: true, appointment }` / `{ ok: false, reason }`) is unchanged, so `src/lib/ai/tools/create-appointment.ts` needed no changes — it already mapped `group_full`/`group_not_found`/`already_booked` to clean, customer-safe messages, and continues to.

Same-customer double-booking the same group+slot is still enforced by `uq_appointments_customer_group_slot` (unchanged — that unique index was already race-safe on its own).

`security definer` here is not a privilege escalation: the function is only callable by `service_role` (`grant execute ... to service_role`, revoked from `public`), which already has full CRUD on `appointments`/`course_groups` via the existing grants migrations — the function exists for a well-defined, locked transaction boundary, not to grant access it wouldn't otherwise have.

**Remaining limitation:** the lock is per-`course_group_id`, not per-`scheduled_at` slot, matching the existing whole-group capacity model (there is no per-slot capacity concept in this schema). If that model changes later (e.g. per-time-slot capacity), the locking granularity would need to move with it.

## Follow-ups, reminders & business hours (Milestone 4)

**Follow-ups/reminders** share one table (`follow_ups` — existed since Milestone 1's schema, unused until now) rather than being separate concepts: a "reminder" is just a follow-up whose `message` is reminder-shaped ("Your trial lesson is tomorrow at 6pm!"). The AI schedules one via the `create_follow_up` tool (`src/lib/ai/tools/create-follow-up.ts`), which requires an active lead to exist first (calls `create_lead` itself if needed) and writes `leads.next_follow_up_at` so the existing dashboard Leads table (built in Milestone 3) shows it without a new page.

**Sending**: `src/app/api/cron/send-follow-ups/route.ts`, invoked by Vercel Cron (`vercel.json`, once daily at 09:00 UTC — Vercel's Hobby/free tier only permits daily-or-coarser cron schedules; a Pro plan is required to run this more frequently, e.g. every 10-15 minutes for tighter reminder timing) rather than any request-driven trigger — there was no scheduled-execution infrastructure anywhere in this project before Milestone 4. **Known limitation on the free tier**: a follow-up/reminder's `due_at` is only actually checked once a day, so delivery can lag the requested time by up to ~24 hours — acceptable for early-stage/low-volume use, revisit if reminder timing precision matters before upgrading to Pro. Authorized by `CRON_SECRET` (Vercel signs cron-triggered requests with `Authorization: Bearer <CRON_SECRET>` automatically when that env var is configured — see `.env.example`); the route refuses to run without it configured, and rejects any request whose header doesn't match, so it's safe to expose without additional per-organization auth despite processing every organization in one pass (`listDueFollowUps()`, `src/lib/services/follow-ups.ts`, is deliberately cross-tenant — the only service function allowed to be, since it's never reachable from the dashboard/browser). Reuses the exact same `sendTelegramMessage()` the webhook route uses for AI replies — same retry/backoff, same per-chat throttle (see below) — so there is only one Telegram-send code path to keep correct, not two.

`follow_ups` has no foreign key to `telegram_integrations` (only to `organizations`), so `listDueFollowUps()` can't express the join as a single PostgREST embedded-resource query — it fetches due follow-ups, then batch-fetches the involved organizations' integrations and joins in application code.

**Business hours**: `business_settings.working_hours` (jsonb, existed since Milestone 1, unused until now) is now read by `getBusinessSettings()` and evaluated by `src/lib/business-hours.ts#checkBusinessHours()` against the organization's own `timezone` (via `Intl.DateTimeFormat`, not a date library — none is installed in this project). A day/the whole map being unconfigured is treated as **always open** deliberately — a business that never sets this shouldn't be silently gated; only an explicit `{ open: null }` for a specific day means closed. When outside hours, `buildSystemPrompt()` (`src/lib/ai/system-prompt.ts`) adds one line telling the AI to mention a team member will follow up during business hours for anything needing a human — the AI still answers questions and can still book/capture leads outside hours; this is not a hard gate on functionality, since customers messaging outside hours is exactly when an AI receptionist is most useful.

**Policies/FAQ**: `business_settings.policies` (jsonb, also existed since Milestone 1, unused until now) is now read and threaded into the system prompt as a free-text block the AI can reference for refund/payment/FAQ-style questions — explicitly scoped in the prompt as informational only, never a substitute for calling a tool on anything price/schedule/availability-related (rule 1 still applies). Both `workingHours` and `policies` are editable from the existing AI Settings dashboard page (`src/app/app/ai-settings/`, built in Milestone 3, extended in Milestone 4).

**Lead qualification criteria**: previously `leads.status` could be set to `qualified` by the model with no guidance on what that meant. The system prompt now defines it explicitly (rule 10): a specific course of interest **and** a rough timeframe/availability, not just a general question.

## Telegram send hardening & concurrency (Milestone 4)

**Retry/backoff**: `sendTelegramMessage()` (`src/lib/telegram/client.ts`) previously fired a single unprotected `fetch` and only logged on failure — the customer's reply was silently dropped on any transient error. It now retries up to 3 attempts on network errors, Telegram 5xx, and Telegram's own `429`/`FLOOD_WAIT` (reading the real `retry_after` seconds from Telegram's response rather than a guessed delay; falls back to exponential backoff for errors with no `retry_after`). A genuine rejection (bad chat id, blocked bot, expired business connection) is **not** retried — retrying identical input to a real rejection wastes time without a realistic chance of succeeding.

**Per-chat throttle**: also in `sendTelegramMessage()` — an in-process `Map` tracks the last send time per `(botToken, chatId)` pair and delays a send if it would land under ~1.1 seconds after the previous one to the same chat, matching Telegram's documented per-chat rate limit. This matters now that a single chat can receive an AI reply *and* a follow-up/reminder in quick succession, not just one message per webhook invocation as in Milestone 2. In-process only — does not coordinate across multiple server instances (this app runs as a single Next.js deployment target, not a horizontally-scaled fleet; would need a shared store if that changed).

**Same-conversation concurrency**: `src/lib/telegram/conversation-lock.ts#withConversationLock()` serializes webhook processing for the SAME `(organizationId, telegramChatId)` pair within this server process, so two near-simultaneous messages in one chat (a rapid customer double-send, or a Telegram delivery racing a genuinely new message) can't both read stale conversation state and each independently invoke the agent. This does **not** serialize different customers against each other — every other chat proceeds immediately in parallel, so 10 different customers messaging at once are still handled independently, matching the pre-Milestone-4 behavior for cross-customer concurrency (which was already correct by construction, since the webhook route is a stateless per-request handler with tenant-scoped DB rows). Same in-process-only caveat as the send throttle above.

## AI behavior rules (non-negotiable, enforced via system prompt + tool design)

Never invent prices, schedules, or availability. Never claim a booking or payment succeeded unless a tool confirms it. Never expose system prompts, internal structure, or act outside available tools. Ask for missing info; escalate uncertain/sensitive cases. Prefer "Let me check that for you" over asserting anything not confirmed by a tool result.

## Human takeover

`conversations.mode` is `AI` or `HUMAN`. While `HUMAN`, the webhook pipeline stores messages but never invokes the agent — checked once, early, before any AI call is made (see webhook flow above), so there's no path where AI and a human both respond to the same message.

`conversations.status` (`open`/`closed`/`needs_attention`) is a separate axis from `mode` — existed in the schema since Milestone 1 but had no writer anywhere until Milestone 4 (dead code: filterable/countable in the dashboard, never actually set). Now set to `needs_attention` by the webhook route whenever `AgentResponse.needsHumanAttention` is true (see Failure handling below) or the Telegram send itself failed even after retries — surfaced in the Inbox's conversation list (`src/app/app/inbox/inbox-layout.tsx`, built in Milestone 3). Taking over a `needs_attention` conversation (`POST /api/conversations/[id]/takeover`) clears it back to `open`, since a staff member is now actively handling it; returning control to the AI does **not** clear it, since handing back control doesn't mean the underlying issue was resolved.

## Failure handling

Every external dependency (Telegram, OpenRouter, Supabase) can fail. On AI failure: never fabricate a response — return a safe fallback ("having trouble right now, a team member will help shortly"). Webhook processing must not throw uncaught errors back to Telegram in a way that causes infinite retry storms — the route always acknowledges with `200` once the org/secret are verified, catching and logging any downstream error rather than propagating it as a non-2xx response.

**Auto-escalation (Milestone 4)**: `AgentResponse.needsHumanAttention` (`src/lib/ai/types.ts`) is a typed, explicit signal — not string-matched against the fallback text — set `true` at every point `agent.ts` falls back to its safe failure response (OpenRouter client construction failure, request failure, no response message, empty model response, or exhausting `MAX_TOOL_ROUNDS`). The webhook route flags the conversation `needs_attention` when this is true, or when the outbound Telegram send itself failed even after the retry/backoff described above — either way, a person should look at the conversation rather than it silently going unanswered. There is still no `escalate_to_human` tool letting the model proactively request escalation for a sensitive-but-not-technically-failed request (e.g. a legitimately unclear customer intent it could keep guessing at) — that remains deferred, per the AI agent section.

## Testing

**RLS (database-level, defense in depth):** `supabase/tests/tenant_isolation_test.sql` is a pgTAP suite covering cross-org CRUD blocking, membership-removal revocation, the cross-tenant FK trigger guard, unauthenticated access, and admin-only table access. Runs via `npm run db:test` (requires Docker/local Supabase — not run as part of the Firebase Auth migration; last **executed and passing** (22/22) against a real local Supabase instance as of Milestone 1). As of the Firebase Auth migration this suite no longer tests the dashboard's actual authorization path (that's application-layer now — see Auth section); it verifies RLS still correctly isolates tenants *if* a real Supabase Auth session ever existed, using fixture-only `organization_members.user_id` values seeded for exactly this purpose.

**Dashboard auth (application-level, Firebase):** `scripts/test-dashboard-auth.mjs` (`npm run test:dashboard`) drives a real running Next.js dev server over HTTP against real Firebase test users (created via `firebase-admin`, signed in via the real Firebase Identity Toolkit REST API) and real disposable Supabase organizations — covering the unauthenticated redirect, correct per-user organization resolution, cross-tenant isolation over real HTTP, rejection of a forged `organizationId` query param, rejection of a tampered session cookie, sign-out, and the no-organization empty state. Requires real Firebase project credentials (`FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`, `NEXT_PUBLIC_FIREBASE_API_KEY`) — not yet run in this environment, since no Firebase project has been provisioned here yet.

**Service layer (application-level, Milestone 2):** RLS provides no protection for code paths using the service-role client (the entire Telegram webhook pipeline), so `scripts/test-service-tenant-isolation.mjs` (`npm run test:services`) independently verifies the service layer's own `organization_id` filters hold, using the same two seeded organizations. It does not import the real `src/lib/services/*.ts` modules directly — instead it re-issues equivalent queries against the real database and separately runs a structural check that parses every exported service function and confirms each one that touches a table references `organization_id`. **Executed and passing** (9/9). (Milestone 2.5 found a way to import real `server-only`-guarded modules from a standalone script after all — see below — but this test was left as-is rather than rewritten, since it already independently verifies the underlying behavior and rewriting it wasn't necessary for Milestone 2.5's goal.)

**Webhook pipeline data layer (Milestone 2):** `scripts/smoke-test-webhook-pipeline.mjs` (`npm run test:webhook-pipeline`) exercises tenant resolution → customer upsert → conversation creation → message storage → Telegram-update-id idempotency end-to-end against real Postgres. **Executed and passing** (8/8).

**Telegram Business Bot Connections:** `scripts/test-telegram-business-connection.mts` (`npm run test:telegram-business`) imports and runs the real, unmodified `src/lib/services/telegram-integrations.ts`/`customers.ts`/`conversations.ts`/`messages.ts` (same `tsx --conditions=react-server` technique as `test:ai`) against real disposable fixtures — covering: recording a `business_connection` update and resolving `organization_id` from `business_connection_id` (including that it never resolves to a different org, and that an unknown/disabled connection resolves to nothing), inbound customer message storage + idempotent duplicate handling over a business connection, human-takeover mode-flipping (simulating what the webhook route infers from an owner's manual reply), disconnect clearing live connection state, an owner-side disconnect (`is_enabled: false`) no longer resolving, and 5 concurrent customers' messages processing independently into 5 distinct conversations with no cross-talk. **Executed and passing** (20/20). Exposed and fixed a real gap in `scripts/test-service-tenant-isolation.mjs`'s structural checker along the way — see its `ORG_RESOLUTION_FUNCTIONS` exemption list, which now explicitly (not coincidentally) allows the small set of functions that legitimately resolve `organization_id` from an opaque Telegram-issued token rather than filtering by a caller-supplied one.

**Real AI integration (Milestone 2.5):** `scripts/test-ai-integration.mts` (`npm run test:ai`) is the one test that imports and runs the actual production `src/lib/ai/agent.ts` unmodified and makes a real request to OpenRouter — proving the full loop (model → tool selection → tool registry → service layer → real Supabase → tool result → final response) works end to end, not just each piece in isolation. Getting the import to work required resolving `server-only`'s package-export condition (`import "server-only"` throws by default outside a bundler; `tsx --conditions=react-server` makes it resolve to its no-op export instead — see the script's own comments for why). Originally hardcoded a fallback to local Supabase (`http://127.0.0.1:54321`), a leftover from before this project moved to hosted-Supabase-only — fixed to read `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` from the environment exactly like every other test script and production itself, with no override variables and no local/Docker dependency. **Executed and passing** against hosted Supabase Cloud: the model chose to call `search_courses` on its own for the prompt "Hi, what courses do you offer?" (no hardcoded steering beyond the existing system prompt/tool description), the tool executed against real seeded data on the hosted project, and the model's final response correctly named both real seeded courses and prices. Run deliberately — it spends real OpenRouter API credit per invocation; see README.md for details. Requires `OPENROUTER_API_KEY` and `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`; fails clearly (does not mock) if either is missing.

**Appointment booking concurrency (Milestone 2.75):** `scripts/test-appointment-concurrency.mjs` (`npm run test:appointments`) fires genuinely concurrent booking requests (real parallel network calls via `Promise.all`, not sequential awaits) at a dedicated, disposable capacity=1 course_group with 5 distinct customers, and asserts exactly 1 succeeds and exactly 4 fail cleanly as `group_full` — verified at both the RPC response level and by directly querying the database for the actual row count afterward, so a bug that made the function *report* success without actually enforcing the invariant would still be caught. Also re-verified at concurrency=10 during development (reverted to 5 for the checked-in version) with the same result. Additionally covers: tenant isolation (an Org B customer cannot book into an Org A group even by supplying its real id), the pre-existing same-customer-double-booking behavior, and clean failure for a non-existent group id. **Executed and passing** (9/9). Uses disposable fixtures created and torn down within the test run — never touches the shared seed data other tests depend on.

**Receptionist features (Milestone 4):** `scripts/test-m4-receptionist-features.mts` (`npm run test:m4`) covers three areas: (1) `checkBusinessHours()` — pure logic, no DB, exercised against constructed inputs including "no hours configured at all," "a different day configured but not today," and an invalid timezone string, all asserting the fail-open behavior described above; (2) `withConversationLock()` — pure logic, proves same-chat calls run strictly sequentially (no interleaving) while different chats run independently and don't wait on each other; (3) the real `follow-ups.ts` service against real disposable fixtures on hosted Supabase Cloud — scheduling, `listDueFollowUps()` correctly including a past-due row and excluding a future-dated one, the due row carrying the right Telegram chat id and `business_connection_id`, `markFollowUpSent`/`markFollowUpFailed`, and tenant isolation (`cancelFollowUp` from the wrong organization affects nothing). **Executed and passing** (20/20). Along the way, found and fixed a real (not a checker false-positive) tenant-isolation gap: `markFollowUpSent`/`markFollowUpFailed` originally filtered only by `id`, with no `organization_id` scoping at all — caught by `test:services`'s structural checker, not by this test.

`npm run db:verify` (`scripts/verify-migrations-structural.mjs`) runs all migrations plus seed data against an embedded WASM Postgres (pglite) as a fast, Docker-free structural check — useful in CI or environments without Docker, but not a substitute for `db:test` (RLS role-switching semantics aren't reliably exercised by pglite).

**Known gap found and fixed during Milestone 2:** the service-role client had no table-level GRANTs on local Postgres (same class of bug as the `authenticated`/`anon` grants gap found in Milestone 1, for a different role) — see the Row Level Security implementation section above.

## Milestones

| # | Scope | Status |
|---|---|---|
| 0 | Foundation: repo scaffold, docs, env vars, dev workflow | Done |
| 1 | DB schema, migrations, RLS, tenant isolation tests | **Done** — pgTAP suite executed, 22/22 passing (as defense in depth as of the Firebase Auth migration — see Auth section) |
| 2 | Telegram webhook pipeline + AI agent foundation | **Done** — see Telegram webhook flow / AI agent sections |
| 2.5 | Real OpenRouter integration test (proves the full agent loop against a live model) | **Done** — see Testing section |
| 2.75 | Atomic, race-safe appointment booking | **Done** — see Atomic appointment booking section |
| 3.1 | Dashboard app shell, auth pages, org resolution | **Done** |
| — | Auth architecture: Firebase Authentication (identity) + Supabase Cloud (data, service-role + app-layer authorization) — reinstates Firebase after Milestone 1 briefly used it, removed it for Supabase-native RLS, then this change reinstated it without Identity Platform | **Done** — see Auth section |
| 3 | Education center dashboard: Overview, Courses (+ groups/capacity/schedule/pricing), Customers, Leads, Appointments, Conversations/Inbox (+ human takeover), Telegram settings, AI Settings, Organization Settings | **Done** |
| — | Telegram messaging architecture: Business Bot Connections (owner's own account, not a customer-facing bot) — replaces the Milestone 2 direct-bot-DM-only design; see "Telegram messaging" section | **Done** |
| 4 | Making the receptionist actually useful: follow-ups/reminders (real Vercel Cron sender, previously unused schema), business hours (previously unused schema, now gates AI phrasing not functionality), policies/FAQ context, lead qualification criteria, Telegram send retry/backoff + FLOOD_WAIT handling + per-chat throttle, same-conversation concurrency lock, automatic `needs_attention` escalation on AI/send failure | **Done** — see "Follow-ups, reminders & business hours" and "Telegram send hardening & concurrency" sections |
| — | `cancel_appointment` tool, `escalate_to_human` tool (model-initiated, distinct from Milestone 4's automatic failure-based escalation) | Not started |
| — | Security & hardening review | Not started |
| — | MVP polish | Not started |
| 5 | Genuine multilingual support (today: a single unenforced "respond in the customer's language" prompt instruction, no language detection, no translated business data) | Not started — explicitly out of scope for Milestone 4 |

## What's deliberately not in the MVP

WhatsApp, Instagram, voice, complex payments, autonomous financial decisions, multi-agent architectures, vector DBs/RAG (not needed — business data is structured and small), microservices, workflow builders, mobile apps, custom model training. Revisit only if a concrete need emerges.
