# GCF Sales CRM — Phase 1 (Foundation) plan

2026-10-09 · prepared for Kenji Sakuramoto (CEO) · status: **awaiting approval, no code written**

This is the first deliverable asked for in `docs/BRIEF.md`: the Phase 1 plan, the exact accounts, keys and DNS records to create (in order), the proposed repo structure, migrations and route map, and the Phase 1 task list. Nothing is built until this is approved.

---

## 0. What I found before planning

| Finding | What it means |
| --- | --- |
| The repo is `GoldenCF/CRMSales`, not `gcf-crm` as the brief says. | Fine. I will keep this repo; no rename needed. |
| There is no `main` branch. The default branch is `claude/basic-sales-crm-i3ck5t`. | The CI plan needs a protected `main`. You create it (see step 1 below); I must not push to a branch I was not given. |
| The repo holds a v0 CRM: Express + SQLite + vanilla JS (`src/`, `public/`, `test/`), with a README and `docs/ARCHITECTURE.md` written for it. | It is not the fixed stack. Phase 1 removes it (git history keeps it). The README and ARCHITECTURE.md get rewritten for the new stack. |
| `docs/BRIEF.md` is already in the repo and matches the PDF. | Good; it stays the source of truth. The PDF copy at the repo root is a duplicate and will be removed with the v0 app. |
| No MCP servers are connected in this cloud session: Supabase, Context7, shadcn and Playwright are all absent. | Supabase migrations and advisors need either the Supabase MCP or a Supabase access token in the environment (step 6). shadcn and Playwright work from their CLIs without MCP. Context7 can be replaced by reading current docs on the web. |
| Cloudflare Access can protect a `workers.dev` hostname directly at the Worker level. | The app does not need a custom domain. Only Resend (email) needs one. |
| Cloudflare R2 asks for a payment method on file before the first bucket, even though the 10 GB free tier costs $0. | R2 is Phase 4 (backups). This is a "costs money / needs a card" decision for you, listed in section 7. Not needed for Phase 1. |

---

## 1. Accounts, keys and DNS records to create, in order

Do these in order; each step feeds the next. Never paste a key into chat: keys go into the dashboards named below, and the names in **bold** are the exact secret names the CI and the app will read.

### Step 1 — GitHub (repo already exists)

1. In `GoldenCF/CRMSales` → Settings → Branches: create `main` from `claude/basic-sales-crm-i3ck5t` and make it the default branch.
2. Branch protection on `main`: require a pull request, require the `ci` status check to pass. (Added once CI exists at the end of Phase 1.)
3. Secrets and variables are added in step 5, after the values exist.

### Step 2 — Supabase (two free projects, Singapore)

1. Create an organization **Golden Cap Farm** on the Free plan. The free plan allows exactly two active projects, which is what we need.
2. Create project **gcf-crm-dev**, region **Southeast Asia (Singapore)**. Generate a strong database password and store it in your password manager.
3. Create project **gcf-crm-prod**, same region, separate strong password.
4. For each project, note from Project Settings → API / Data API:
   - Project ref (the 20-character id in the URL)
   - Project URL
   - Publishable (anon) key — safe for the browser
   - Secret (service_role) key — **never** goes in the browser or in this repo; CI and Edge Functions only
5. Authentication settings, both projects:
   - Providers → Email: enabled. Confirm email: on. Signups: **off** ("Allow new users to sign up" unchecked). This is the second lock: only accounts an admin created can request a login code.
   - Email templates → Magic Link: switch body to the `{{ .Token }}` form so users get a 6-digit code, not a link.
   - URL configuration: Site URL = the Worker URL from step 4 (staging URL for dev, production URL for prod). Add `http://localhost:5173` to redirect URLs on dev only.
6. Account → Access Tokens: create one personal access token named `gcf-crm-ci` → **SUPABASE_ACCESS_TOKEN** (used by CI to push migrations, and by this session if no Supabase MCP is connected).

### Step 3 — Resend (login codes, digests, alerts)

1. Create a Resend account (free: 3,000 emails/month, 100/day, 1 verified domain).
2. Domains → Add domain. Recommended: a sending subdomain such as **`mail.goldencapfarm.com`** (replace with the domain you own; see question 1 in section 7). A subdomain keeps CRM mail separate from the company's normal mailbox and cannot break existing email.
3. Add the DNS records Resend shows you at your DNS host. The values are generated per account, so copy them from the Resend screen. There are three required and one recommended:

   | Record | Host | Purpose |
   | --- | --- | --- |
   | TXT | `resend._domainkey.mail` | DKIM signature |
   | MX | `send.mail` → the `feedback-smtp.…amazonses.com` host Resend shows, priority 10 | bounce handling |
   | TXT | `send.mail` → `v=spf1 include:amazonses.com ~all` (exact value from Resend) | SPF |
   | TXT | `_dmarc.mail` → `v=DMARC1; p=none;` | DMARC, recommended |

   Wait for Resend to show the domain as **Verified** (usually minutes, up to 48 h).
4. API Keys → create two keys, both "Sending access" only, restricted to the verified domain:
   - `gcf-crm-supabase-auth` → pasted into Supabase SMTP settings (next step)
   - `gcf-crm-edge` → **RESEND_API_KEY** in Supabase Edge Function secrets (used from Phase 4 for digests; set now so it is in place)
5. Supabase → each project → Authentication → SMTP Settings → Enable custom SMTP:
   - Sender email `crm@mail.goldencapfarm.com`, sender name `GCF CRM`
   - Host `smtp.resend.com`, port `465`, username `resend`, password = the `gcf-crm-supabase-auth` key
   - Authentication → Rate limits: raise "emails sent" to 30 per hour (default after custom SMTP is 25–30; with 4 staff this is plenty).
   Without custom SMTP, Supabase's built-in sender allows only 2–4 auth emails per hour, which would block logins.
6. Supabase → each project → Edge Functions → Secrets: add **RESEND_API_KEY** = the `gcf-crm-edge` key.

### Step 4 — Cloudflare (hosting + front gate)

1. Create a Cloudflare account. No domain needs to be moved to Cloudflare: the app runs on `workers.dev`, and Resend DNS stays at your current DNS host.
2. Workers & Pages → choose the account's `workers.dev` subdomain, e.g. `goldencapfarm.workers.dev`. The two Workers will be:
   - `gcf-crm-staging.goldencapfarm.workers.dev` → talks to **gcf-crm-dev**
   - `gcf-crm.goldencapfarm.workers.dev` → talks to **gcf-crm-prod**
   (CI creates the Workers on first deploy; you do not create them by hand.)
3. Zero Trust → sign up on the Free plan (up to 50 users), choose team name `goldencapfarm`. Identity: leave the default **One-time PIN** provider on; no Google/Microsoft setup needed.
4. After the first CI deploy, protect each Worker: Workers & Pages → the Worker → Settings → Access → "Protect this Worker behind Access". Policy: **Allow** → Emails → the staff list (section 7, question 3). Session duration 24 h. Non-staff emails are stopped here before the app loads. This is the first lock.
5. Profile → API Tokens → Create token from template **Edit Cloudflare Workers**, scoped to this account → **CLOUDFLARE_API_TOKEN**. Also note the **CLOUDFLARE_ACCOUNT_ID** (Workers & Pages overview, right-hand panel).

### Step 5 — GitHub secrets and variables (now the values exist)

Repo → Settings → Secrets and variables → Actions.

| Name | Type | Value from |
| --- | --- | --- |
| **CLOUDFLARE_API_TOKEN** | secret | step 4.5 |
| **CLOUDFLARE_ACCOUNT_ID** | secret | step 4.5 |
| **SUPABASE_ACCESS_TOKEN** | secret | step 2.6 |
| **SUPABASE_PROD_PROJECT_REF** | secret | step 2.4, prod |
| **SUPABASE_PROD_DB_PASSWORD** | secret | step 2.3 (needed by `supabase db push` on deploy) |
| **SUPABASE_DEV_PROJECT_REF** | secret | step 2.4, dev |
| **SUPABASE_DEV_DB_PASSWORD** | secret | step 2.2 |
| **VITE_SUPABASE_URL_PROD**, **VITE_SUPABASE_ANON_KEY_PROD** | variable | step 2.4, prod (public values, baked into the production build) |
| **VITE_SUPABASE_URL_DEV**, **VITE_SUPABASE_ANON_KEY_DEV** | variable | step 2.4, dev (baked into the staging build) |

The service_role keys are never stored in GitHub. Edge Functions receive theirs from Supabase automatically.

### Step 6 — This Claude Code session

The brief's workflow relies on four MCP servers that are not connected here. Two options; option A is closer to the brief.

- **A. Connect the MCP servers** at https://claude.ai/customize/connectors (Supabase pointed at the **dev** project ref only, Context7, shadcn, Playwright), then start a new session. Connectors are read when a session starts.
- **B. Environment secret instead of the Supabase MCP.** In this cloud environment's settings (cloud environment menu in the title bar → Edit → Network secrets, or an environment variable), add **SUPABASE_ACCESS_TOKEN** (the `gcf-crm-ci` token) and **SUPABASE_DEV_PROJECT_REF**. I will run migrations, seed and advisors through the Supabase CLI against dev only. shadcn and Playwright run from their CLIs; library docs I will read from the official sites.

Either way, nothing in this session can reach production: production is changed only by the GitHub Actions deploy job.

### Not needed for Phase 1 (listed so nothing surprises you later)

| Phase | Item |
| --- | --- |
| 4 | Cloudflare R2 bucket `gcf-crm-backups` + R2 API token (**R2_ACCESS_KEY_ID**, **R2_SECRET_ACCESS_KEY**) and an `age` public key (**BACKUP_AGE_PUBLIC_KEY**). R2 requires a payment method on file; see question 2. |
| 3 | Data Protection Officer name (PDPA) for Settings. |

---

## 2. Proposed repo structure

Single package, pnpm, Node 22. No monorepo: one app, one Supabase project folder.

```
.
├── .github/
│   └── workflows/
│       ├── ci.yml                # lint, typecheck, vitest, pgTAP (local Supabase), build, Playwright
│       ├── deploy-staging.yml    # on push to main: migrations → dev, deploy gcf-crm-staging
│       ├── deploy-prod.yml       # manual approval after staging: migrations → prod, deploy gcf-crm
│       └── backup.yml            # Phase 4: nightly pg_dump → age → R2
├── docs/
│   ├── BRIEF.md                  # source of truth + decision log
│   ├── PHASE1-PLAN.md            # this file
│   ├── ARCHITECTURE.md           # rewritten for the new stack
│   └── screenshots/              # gate evidence, 1440×900 and 1280×800
├── supabase/
│   ├── config.toml               # local dev settings (auth, Mailpit, ports)
│   ├── migrations/               # 0001_… numbered SQL, see section 3
│   ├── seed.sql                  # dev/staging seed: 4 staff, products, 10 accounts, deals, orders
│   ├── functions/                # Edge Functions (Phase 4: digest, ics-feed, import-jobs)
│   │   └── _shared/
│   └── tests/                    # pgTAP: RLS and rule tests, run in CI
├── src/
│   ├── main.tsx                  # React 19 root, QueryClient, RouterProvider
│   ├── routes/                   # TanStack Router file routes (section 4)
│   ├── components/
│   │   ├── ui/                   # shadcn/ui (generated)
│   │   └── layout/               # AppShell, Sidebar, TopBar, CommandPalette (shell only in P1)
│   ├── features/
│   │   ├── auth/                 # session, login form, route guard, profile
│   │   ├── accounts/ …           # one folder per domain from Phase 2 on: api.ts (queries), schema.ts (zod), components/
│   ├── lib/
│   │   ├── supabase.ts           # browser client, publishable key only
│   │   ├── i18n.ts               # EN/中文 dictionary + hook
│   │   ├── format.ts             # SGD, Asia/Singapore dates, E.164 phones
│   │   └── database.types.ts     # generated by `supabase gen types`
│   ├── locales/en.json, zh.json
│   └── styles/globals.css        # Tailwind v4 @theme: green/gold tokens, Arial
├── e2e/                          # Playwright specs + fixtures (Mailpit OTP reader)
├── public/                       # favicon, logo
├── wrangler.jsonc                # Workers static assets, SPA fallback, two environments
├── vite.config.ts · tsconfig.json · eslint.config.js · .prettierrc
├── vitest.config.ts · playwright.config.ts
├── package.json · pnpm-lock.yaml · .nvmrc · .env.example
└── README.md
```

Removed in Phase 1: `src/*.js`, `public/app.js`, `public/index.html`, `public/styles.css`, `test/`, `data/`, `start-crm.cmd`, `package-lock.json`, the root PDF.

---

## 3. Migrations (Phase 1 creates all 13 tables, RLS and seed)

Conventions applied to every table: `id uuid primary key default gen_random_uuid()`, `created_at timestamptz default now()`, `updated_at timestamptz` (trigger), `created_by uuid default auth.uid()`, soft delete via `deleted_at timestamptz`. Money `numeric(12,2)` in SGD. Phones `text` checked against `^\+[1-9]\d{6,14}$` (E.164). Row-level security on, policies as in 0016.

| # | File | Contents |
| --- | --- | --- |
| 0001 | `extensions` | `pg_cron`, `pg_net` (used from Phase 4; enabling now avoids a later prod migration), `pgtap` (dev/test only) |
| 0002 | `enums` | `user_role (admin, sales)`, `locale (en, zh)`, `segment (fine_dining, chinese, hotpot, japanese, hotel, caterer, retail, wholesale, online)`, `tier (A, B, C)`, `account_health (active, at_risk, dormant, closed)`, `deal_stage (lead, contacted, sample, quote_sent, trial_order, won, lost)`, `lost_reason (price, quality, supply, competitor, no_response, other)`, `activity_type (call, whatsapp, visit, tasting, sample_drop, quote, delivery_issue, quality_complaint, chef_moved, note)`, `event_type (visit, tasting, sample_drop, call, follow_up, delivery)`, `contact_role (owner, head_chef, purchaser, accounts_payable, receiving)`, `task_source (manual, rule)`, `import_target (accounts_contacts, products, xero_orders)`, `account_product_status (buys, pitch)`, `price_tier (A, B, C, list)` |
| 0003 | `helpers` | `set_updated_at()` trigger fn; `is_active_staff()` and `is_admin()` (security definer, read `profiles`) used by every policy |
| 0004 | `profiles` | `user_id` (FK `auth.users`), `full_name`, `role`, `locale`, `is_active`; trigger on `auth.users` insert creates a `sales` profile with `is_active = false` until an admin activates it |
| 0005 | `settings` | `key text primary key`, `value jsonb`, `updated_by`. Seeded with pipeline exit rules and default next actions, tier call cycles (A 7, B 14, C 30 days), health thresholds (1.5×, 30 days, 3 orders, 30 %, 2 issues/30 days), GM floor 15 %, DPO name. Admin-only write. |
| 0006 | `products` | `code` (unique, e.g. CF, QQ), `name_en`, `name_zh`, `unit`, `origin`, `shelf_life_days`, `season_months int[]`, `available_this_week`, `cost_sgd` |
| 0007 | `product_prices` | `product_id`, `tier`, `price_sgd`; generated columns `markup_pct = (price − cost)/cost` and `gm_pct = (price − cost)/price` via a trigger-maintained cost snapshot (generated columns cannot read another table); unique `(product_id, tier)` |
| 0008 | `accounts` | all columns from the brief: `trading_name`, `legal_name`, `uen`, `segment`, `tier`, `health`, `owner_id`, `delivery_days int[]`, `delivery_window`, `delivery_addresses jsonb`, `receiving_notes`, `order_cutoff time`, `credit_terms_days`, `xero_contact_name`, `est_weekly_spend_sgd`, `est_share_pct`, `usual_interval_days`, `last_order_at`, `next_touch_at`, `closed_reason`. Indexes on `owner_id`, `health`, `next_touch_at`, `uen` |
| 0009 | `contacts` | `account_id`, `full_name`, `role`, `phone_e164`, `email`, `is_primary`, `marketing_consent`, `consent_at`, `previous_account_id`; partial unique index on `email` and on `phone_e164` where not deleted (import duplicate matching) |
| 0010 | `deals` | `account_id`, `stage`, `est_weekly_sgd`, `owner_id`, `next_action`, `next_action_at`, `stage_entered_at`, `lost_reason`, `lost_note`, `reengage_at`, `quote_file_path`, `chef_feedback`, `first_order_at`; check: `lost_reason` required when `stage = lost` |
| 0011 | `activities` | `type`, `account_id`, `contact_id`, `deal_id`, `occurred_at`, `summary`, `outcome` |
| 0012 | `events` | `title`, `type`, `starts_at`, `ends_at`, `all_day`, `rrule`, `account_id`, `deal_id`, `owner_id`, `attendee_ids uuid[]` |
| 0013 | `tasks` | `title`, `due_at`, `assignee_id`, `account_id`, `deal_id`, `source`, `done_at` |
| 0014 | `account_products` | `account_id`, `product_id`, `status`, `usual_qty`; unique `(account_id, product_id)` |
| 0015 | `orders` + `import_batches` | `orders`: `account_id`, `order_date`, `total_sgd`, `lines jsonb` (`[{code, qty}]`), `import_batch_id`; read-only in the app (no insert/update policy for the browser role). `import_batches`: `target`, `file_name`, `file_path`, `mapping jsonb`, `row_counts jsonb`, `committed_at`, `undone_at` |
| 0016 | `rls` | Enable RLS on all 13 tables. Active staff: `select`, `insert`, `update` on everything except `orders` (select only) and `settings` (select only). `delete`: admin only, every table (everyone else soft-deletes through `update`). `profiles`: a user may update only their own `locale` and `full_name`; admin may update any. `settings` and `import_batches.undone_at`: admin or the batch creator. `anon` role: nothing. |
| 0017 | `views` | `v_accounts_live` etc.: thin views filtering `deleted_at is null`, so every screen reads live rows by default |

`seed.sql` (dev and local only, never run on prod): 4 staff (1 admin, 3 sales; emails from question 3), 12 products with EN/中文 names and A/B/C/list prices, 10 accounts across segments and tiers, 15 contacts, 8 deals spread over the stages, 10 events, 12 weeks of orders for 6 accounts including one that is slipping (used by the Phase 4 gate).

pgTAP tests (`supabase/tests/`): anon sees zero rows in every table; a sales user can read and write accounts/contacts/deals but cannot hard-delete; an inactive profile is denied everything; admin can hard-delete and write settings; `lost` without a reason is rejected; `gm_pct` and `markup_pct` compute correctly (cost 10, price 13 → markup 30 %, GM 23.08 %).

---

## 4. Route map (full v1; Phase 1 scope marked)

| Route | Screen | Phase |
| --- | --- | --- |
| `/login` | Email → 6-digit code | **1** |
| `/` | Today: touches due/overdue, today's events, newly at-risk, stuck deals | shell **1**, content 2/4 |
| `/pipeline` | Kanban by stage, drag with exit-rule check, filter owner/tier | 2 |
| `/accounts` | Table with tier, health, last order, next touch, owner; saved views; bulk; export | 2 (export 3) |
| `/accounts/$accountId` | Profile / timeline / contacts, products, open deal | 2 |
| `/calendar` | Month, week, day, agenda; drag to reschedule; recurring; filter by person | 3 |
| `/products` | Codes, EN/中文, unit, season, available-this-week, price tiers with markup and GM | 4 (table and prices seeded in 1) |
| `/import` | Upload → target → mapping → preview → commit → undo | 3 |
| `/settings` | Users, pipeline rules, tiers and call cycles, health thresholds, DPO, 2FA | 3 (user list read-only in 1 as the admin smoke check) |
| `*` | 404 within the shell | **1** |

Everywhere, Phase 1 delivers the chrome these screens sit in: sidebar with the seven entries, top bar with EN/中文 toggle and signed-in user, green/gold theme, Arial, 1280–1920 layout, keyboard focus states. The Ctrl/Cmd+K palette opens in Phase 1 as a navigation-only palette (jump to screen); search and quick-add arrive in Phase 2.

Server side, Phase 1 has no Edge Functions. The brief's functions land later: `digest` and `ics-feed` (Phase 3/4), `import-commit` and `import-undo` (Phase 3), `xero-orders` (Phase 4), scheduled by `pg_cron` + `pg_net`.

---

## 5. Phase 1 task list

Owner key: **B** builder subagent, **T** tester subagent, **R** fresh-context reviewer, **CEO** you, **M** main session.

| # | Task | Owner | Done when |
| --- | --- | --- | --- |
| 1.0 | Steps 1–6 of section 1 (accounts, keys, `main` branch, MCP or token) | CEO | Secrets present; `main` is default |
| 1.1 | Remove the v0 Express app and root PDF; rewrite README for the new stack | B | Repo matches section 2 |
| 1.2 | Scaffold: pnpm, Vite + React 19 + TS strict, Tailwind v4, shadcn init with green/gold `@theme` tokens and Arial, TanStack Router (file routes) + Query, react-hook-form + Zod, ESLint + Prettier, Vitest, Playwright, `.nvmrc`, `.env.example` | B | `pnpm lint typecheck test build` all pass locally |
| 1.3 | Supabase: `supabase init`, `config.toml` (email OTP, Mailpit, signups off), migrations 0001–0017, `seed.sql`, generated `database.types.ts` | B | `supabase db reset` clean locally; `supabase db push` to **dev** clean; Supabase security advisor shows no RLS warnings |
| 1.4 | pgTAP suite from section 3 | T | All assertions pass locally and in CI |
| 1.5 | Auth: login page, OTP verify, session persistence, route guard (`/login` only unauthenticated route), inactive-profile lockout screen, sign-out, profile fetch | B | Vitest unit tests for guard and session; E2E login via Mailpit |
| 1.6 | App shell: sidebar, top bar, EN/中文 toggle persisted to `profiles.locale`, all shell strings in both locales, placeholder pages, 404, navigation palette on Ctrl/Cmd+K | B | No horizontal scroll at 1280×800 and 1440×900; mobile 390 px does not break |
| 1.7 | Settings → Users read-only list (admin sees all profiles; sales sees "admin only") | B | Confirms role plumbing end to end |
| 1.8 | `wrangler.jsonc` with `staging` and `production` environments, static assets, SPA fallback, security headers | B | `wrangler deploy --dry-run` passes |
| 1.9 | CI `ci.yml`: install, lint, typecheck, Vitest, local Supabase + pgTAP, build, Playwright (Chromium, two viewports, screenshots uploaded as artifacts) | B+T | Green on a PR |
| 1.10 | `deploy-staging.yml`: on push to `main` → `supabase db push` to dev → build with dev variables → `wrangler deploy --env staging`. `deploy-prod.yml`: `workflow_dispatch` with a GitHub environment `production` requiring your approval → `db push` to prod → build with prod variables → `wrangler deploy --env production` | B | Staging deployed by CI; production job exists and is gated |
| 1.11 | Cloudflare Access on both Workers with the staff allow-list (dashboard, CEO) and documented in README | CEO+M | Non-staff email is stopped at the Access page |
| 1.12 | Resend domain verified; SMTP into both Supabase projects; a real login code arrives at a staff inbox | CEO+M | Login works on the staging URL |
| 1.13 | Gate review: fresh-context reviewer audits RLS (policies, advisors, pgTAP coverage) and UX at both viewports; screenshots saved to `docs/screenshots/phase1/` | R | Findings fixed or logged |
| 1.14 | Decision log in `BRIEF.md` updated; `ARCHITECTURE.md` rewritten | M | Gate report sent to you |

### Phase 1 gate (from the brief, made testable)

- [ ] A staff email signs in on the staging URL and sees the shell with their name and role.
- [ ] A non-staff email is stopped at Cloudflare Access; a staff email that has no active profile is stopped at the app.
- [ ] Security tests pass: pgTAP RLS suite green; Supabase advisor shows no "RLS disabled" or "policy allows anon" findings.
- [ ] All CI jobs green on `main`.
- [ ] Screenshots at 1440×900 and 1280×800 reviewed, no horizontal scroll.
- [ ] Production changed only by the CI deploy job (production job never run manually from a laptop; Supabase MCP/token points at dev only).
- [ ] Decision log updated.

---

## 6. Decisions proposed for the log (where the brief is silent)

These are recorded in `BRIEF.md` → Decision log, dated 2026-10-09. Say so if you want any changed.

1. Keep repo `GoldenCF/CRMSales`; create `main` as default branch; delete the v0 Express/SQLite app in Phase 1.
2. Single package with pnpm and Node 22; no monorepo.
3. Add a 13th table, `settings` (key/value jsonb), so rules are editable without code as the brief asks.
4. `orders.lines` stored as jsonb; the app never writes orders.
5. Staff onboarding: Supabase signups off; an admin creates users (Supabase dashboard in Phase 1, Settings → Users in Phase 3); new profiles start inactive and default to the `sales` role.
6. Hosting: two Workers on `workers.dev` (`gcf-crm-staging` → dev project, `gcf-crm` → prod project), both behind Cloudflare Access with the same allow-list. No custom domain for the app; one can be added later without code changes.
7. Email: Resend sending subdomain `mail.<company domain>`; sender `crm@mail.<domain>`.
8. Deploys: push to `main` deploys staging automatically; production deploys only through the gated `deploy-prod` job after you approve it in GitHub.
9. E2E login in CI uses a local Supabase with Mailpit to read the one-time code; staging E2E is manual via Playwright at the gate.
10. All timestamps `timestamptz`, displayed in Asia/Singapore; weeks start Monday; SGD with 2 decimals.
11. Authenticator-app second factor uses Supabase MFA (TOTP, free) and ships with the Settings screen in Phase 3.
12. Free-tier pause risk: Supabase pauses a free project after 7 idle days. The 07:30 digest cron (Phase 4) exercises the database daily; until then I will note the risk at each gate. Supabase Pro at $25/month is the fallback and is your call.

---

## 7. Questions only you can answer (money or irreversible)

1. **Email domain.** Which domain should CRM mail send from, and do you have access to its DNS records? I assumed `goldencapfarm.com` as a placeholder.
2. **Cloudflare R2 needs a card on file** before the first bucket, even at $0 usage. Phase 4 only. OK to add one then, or should backups go to a free alternative without a card (encrypted file committed nightly to a private GitHub repo, same `age` encryption)?
3. **Staff list.** The four email addresses for the Access allow-list and Supabase users, and which one is the admin. (No need to post them here; add them in Cloudflare Access and the Supabase dashboard, or tell me and I will seed them.)
4. **Confirm** deleting the v0 app and creating `main`, as in decision 1.

Everything else in this plan I will decide and log as the brief instructs.
