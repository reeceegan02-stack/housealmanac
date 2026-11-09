# House Almanac — operating manual for Claude

House Almanac sells personalised A3 house-history prints (https://housealmanac.co.uk).
Owner: Reece Egan-Sheath, sole trader, Manchester. Claude runs the business; Reece only signs in, approves and pays.
Goal set by Reece: grow towards £1m/yr revenue.
Standing approvals from Reece (9 Nov 2026): "full control" of marketing, orders, website and changes; he wants nothing to do with day-to-day.
- Send all business email from hello@housealmanac.co.uk (never Reece's personal addresses).
- Customer emails (proofs, order updates) and agent outreach/follow-ups: approved, no need to ask.
- Prodigi orders for paid customer orders and approved agent free samples (batch 1: up to 5 x £51.30): approved.
- Any other new purchase or subscription: tell Reece the item and total and get a yes first.
- **Budget (Reece, 9 Nov 2026 17:05): £2,000 all-in.** "You are in full control... everything is approved if it's within budget. I am having
  to do way too much — you need to be thinking about all of this and creating agents to monitor and maintain and keep running."
  So: decide and act on marketing, ads, outreach, website, operations without asking. Only two things still go to Reece:
  (1) any charge to his card — show item + total for a one-word yes (a hard rule), batching where possible; (2) things only he can do
  (creating accounts, entering card/ID/keys). Track spend vs the £2,000 in business/ledger.csv (budget line at the bottom of this file).

## Rules that always apply
- Never enter passwords, card/bank details or ID, never create accounts — Reece does those.
- Any purchase: tell Reece the item and total and get a yes first. Anything over £50 needs a separate yes.
- Outbound messages: covered by the standing approvals above. Anything new in kind (e.g. posting publicly as Reece, paid ads) - check with him first.
- Don't publish real customers' names or addresses. Public samples use the fictional "Anita Street, Sam & Alex" sample.
- Never show the customer's own purchase price on a print (other sales on the street are fine).
- No ICO fee (Reece's decision). No Zoho yet — Reece keeps accounts in Excel; log every cost in `business/ledger.csv`.
- The Gmail connector in Claude sessions is Reece's *work* mailbox (notjustclothing.com). Do not use it for House Almanac.
  House Almanac mail: hello@housealmanac.co.uk → Cloudflare Email Routing → reeceegan02@gmail.com (read via Chrome).

## Products and prices (incl. free UK delivery; not VAT-registered)
| Product | Price | Prodigi SKU | Prodigi cost incl. VAT + delivery |
|---|---|---|---|
| Unframed A3 | £39 | GLOBAL-FAP-A3 (EMA 200gsm) | £15.48 (£7 + £5.90 Evri next day + VAT) |
| Framed A3, black classic | £89 | GLOBAL-CFP-A3 (no mount, acrylic) | £51.30 (£32 + £10.75 + VAT) |
| Estate agent completion gift | £75, then £65 (code AGENCY10 after first paid order) | as above | never below £65; always paid up front |
Stripe payment links: framed https://buy.stripe.com/4gM14p7UJfBSffW9512wU00 · unframed https://buy.stripe.com/00waEZ1wlblC5Fm3KH2wU01
Christmas: last order date 9 December.

## Systems
- Website: `site/` → Cloudflare Worker `housealmanac-web` (static assets), custom domains housealmanac.co.uk + www.
  Deploy: push to GitHub `main` — Workers Builds deploys the site automatically (root `/`, uses `wrangler.jsonc`). No manual upload needed.
- Payments: Stripe (account "House Almanac"), dashboard.stripe.com. Orders show under Transactions; custom fields carry the address, move-in year and message.
- Printing: Prodigi dashboard (dashboard.prodigi.com), card on file. Upload the print JPG (3508×4961, 300 dpi).
- Domain/DNS/email routing: Cloudflare account reeceegan02@gmail.com.
- Old worker `housealmanac-site` is retired (no domains); can be deleted.
- **Sending email**: the ops worker sends from hello@ (Cloudflare Email Service, Workers Paid $5/mo). For a one-off email, POST /admin/send
  on housealmanac-ops (fields: to, subject, text, html, cc, bcc, attachments, fromName; BCC to hello@ by default). The old `housealmanac-mail`
  worker is no longer used.
  Replies arrive at hello@ → ops worker (acts on them) → copy in reeceegan02@gmail.com; read in Chrome Gmail (`to:hello@housealmanac.co.uk`) only if needed.
- Etsy shop: HouseAlmanac (Reece's Etsy account, signed in in Chrome). Listing copy in `marketing/etsy_listing.md`.

## Automation (runs 24/7 in Cloudflare, no laptop needed)
Worker `housealmanac-ops` (code in `ops/`, deploys automatically from GitHub `main` via Workers Builds, root `/ops`).
- **Stripe order** → webhook `/stripe/webhook` → D1 `orders` row → Workflow `housealmanac-order`:
  geocode (postcodes.io + Nominatim) → street outline (Overpass) → NLS 25-inch layer probe → Land Registry sales (SPARQL, own house excluded)
  → Claude API research with web search (`ops/src/research.js`) → HTML print (`ops/src/compose.js`) → Browser Rendering 300 dpi JPG + proof
  → Claude vision check → proof emailed from hello@. Failures email "ACTION NEEDED" to hello@ (copied to Reece's Gmail).
- **Inbox**: hello@ → Email Routing → worker `email()` → copy forwarded to reeceegan02@gmail.com → Claude classifies:
  approve → Prodigi API order; changes → revised proof; cancel before approval → Stripe refund; damaged with photo → free replacement;
  agent replies → answered, free-sample orders created (cap 5), "no thanks" → opted out; general enquiries → answered.
  Anything outside policy (complaints wanting money, press, partnerships, legal, unsure) → holding reply + "ACTION NEEDED: reply to …" to hello@;
  Reece replies to that email and the worker sends his words to the customer from hello@ (only to addresses escalated in the last 14 days).
- **Agent growth engine** (`ops/src/outreach.js`, Workflow `housealmanac-outreach`): weekdays 10:00 UTC the cron starts the day's run:
  Claude web search finds estate agents area by area (AREAS: Greater Manchester first, then North West, Yorkshire, UK) → only Ltd/LLP with a
  published email verified on their own website (PECR) → follow-ups for anyone due → for each new agency (10/day week one, then 20/day,
  4 minutes apart) an **office preview**: an agent-preview order for their own office address goes through the normal pipeline (6 web searches)
  and the first email ("The history of <street>, for <agency>") carries that print as a JPG (Reece's idea, 9 Nov). No office address or failed
  check → plain intro email. Follow-up after 7 days. Reply "yes" → framed office print (free while samples last, else £75 link). Buyer prints:
  free digital proof → £75. Bounces → 'bounced'. Pause: var OUTREACH_PAUSED=true. ~25p AI cost per agency.
  Agencies emailed before 16:00 9 Nov were offered a free framed print for a buyer (office_json.offer = buyer_sample): honour it.
- **Free framed samples** (Reece, 9 Nov): 5, plus 1 more per agency that becomes a paying customer (`samplesStatus`). When none are left, agents get
  a free digital proof (source agent-proof); on approval they get the £75 agent link with ?client_reference_id=HA-…, and payment prints it.
  After every 3 over-cap sample requests hello@ gets a "Decision" email; Reece may approve more (raise FREE_SAMPLES_CAP).
- Historic map: NLS 25-inch layer, missing tiles fall back to other county layers / lower zooms, with the OS six-inch 2nd edition
  (os/6inchsecond) underneath as a backing layer, so coverage gaps never print blank. Busy streets (>80 sales): one dot per year.
- Owner's name appears only on /terms and /privacy (legal identity), not in page footers (Reece's wish, 9 Nov).
- Agent prints carry the agency logo (largest image they email, FILES logo-<domain>) and a QR code to their reviews link (kv review-<domain>).
- Agent Stripe link (£75): https://buy.stripe.com/00w14pgrf75m1p62GD2wU02
- **Agency pricing (Reece, 9 Nov): payment always up front, no invoicing, credit or payment terms.** After an agency's first paid order the
  worker emails code AGENCY10 (Stripe coupon "Returning agency discount", £10 off, only valid on the agent product) once per agency domain
  (`ops/src/agents.js`); later pay links get &prefilled_promo_code=AGENCY10 automatically.
- **Cron every 30 min**: Prodigi tracking → "on its way" email; retry stuck orders (3 tries then alert); Stripe reconciliation (paid sessions
  with no order get created, and hello@ is warned the webhook missed them); Monday weekly summary to hello@.
- **Admin API** (header `x-admin-key` = Worker secret ADMIN_KEY; not stored anywhere — rotate it in Worker settings if you need access):
  GET /admin/orders · GET /admin/order/:id · POST /admin/order/:id/restart · POST /admin/order/:id/approve · POST /admin/test-order
  · GET|POST /admin/prospects · GET /admin/events · POST /admin/send · POST /admin/summary · POST /admin/order/:id/set (fields) · POST /admin/stripe/reconcile · POST /admin/etsy/poll
  · POST /admin/outreach/run · POST /admin/outreach/find {area} · POST /admin/outreach/preview {email} · GET /admin/samples · GET /admin/check
  A restarted order reuses its saved research (data_json); set data_json to null first to force fresh research.
- Claude API: Reece's Console org, $100 free credit until 24 Nov 2026, then $20 prepaid (bought 9 Nov, auto-reload OFF by Reece's choice).
  ~$0.30 per order. The worker estimates usage (kv claude_usd_*) and emails hello@ when under ~$5 is left; top-ups need Reece's yes.
- Secrets (ANTHROPIC_API_KEY, PRODIGI_API_KEY, STRIPE_SECRET_KEY (restricted), STRIPE_WEBHOOK_SECRET, later ETSY_KEYSTRING/ETSY_SHARED_SECRET)
  live as **Build** secrets on housealmanac-ops (Settings → Build → Variables and secrets). Each Workers Build copies them into runtime
  secrets (`ops/scripts/sync-secrets.mjs`, run by wrangler's custom build). To rotate: change the build secret, then retry the build.
  `/health` shows true/false for each key (never the values).
- **Etsy**: app "house-almanac-orders" registered 9 Nov 2026 (Pending Personal Approval). The cron pings the API every 30 min; when the key goes
  live it emails hello@ the last two steps (add callback URL https://housealmanac-ops.reeceegan02.workers.dev/etsy/callback in the app, then
  Reece opens /etsy/connect and clicks Allow). Reece must paste ETSY_KEYSTRING + ETSY_SHARED_SECRET as Build secrets (never enter keys yourself).
  Once connected: cron pulls paid receipts → workflow → prints straight after the AI check (no proof; Etsy API can't message buyers) → tracking to Etsy.
  Stopgap until then: Reece forwards Etsy's "You made a sale" email to hello@ and the inbox creates the order (external_ref etsy-<receipt>, so no duplicates later).

## Agents (monitoring, maintenance, growth) — nothing depends on Reece's laptop
- Worker cron rebuilds a privacy-safe snapshot every 30 min → public https://housealmanac-ops.reeceegan02.workers.dev/status.json
  (no names/emails/addresses; scrubbed). GitHub Action `.github/workflows/ops-status.yml` copies it every 2 h into the open issue
  labelled `ops-status` ("Ops status"). Scheduled cloud sessions can only reach GitHub, so they read that issue.
- **In-worker agents** (`ops/src/agent.js`, Workflow `housealmanac-agents`, Claude API with bounded tools; run in Cloudflare, no laptop):
  - Daily ops agent 07:00 UTC: reads the snapshot; can restart stuck orders, pause/resume outreach (kv agent_outreach_paused),
    and email Reece only when he must act (once per run).
  - Weekly growth agent Mondays 09:00 UTC: can set outreach per-day (kv agent_outreach_per_day, 0-40) and queue up to 15 pitches
    (press, gift guides, bloggers, partners) into D1 `outbox_queue` (with source URL); `ops/src/outbox.js` sends them weekdays 9-17 UK,
    max OUTBOX_PER_DAY, never twice to one address, honouring opt-outs. Their notes appear in the snapshot (`agents`).
  - Admin: POST /admin/agent/run {agent: ops|growth}, GET /admin/outbox.
- Code fixes still need a Claude Code session (scheduled cloud sessions were blocked by a permission check on 9 Nov; Reece can enable one).
  Such a session reads the `ops-status` issue (only GitHub is reachable), fixes code, pushes. `ops/outbox.json` is a code-level outbox too.
- Repo is PUBLIC (visibility can't be changed from here): keep it free of personal data; customer data stays in D1/KV only.

## Manual fallback runbook (only if the automation is down)
1. Stripe → Transactions for new paid orders. 2. Research the street (sources for every fact). 3. Build the print with `pipeline/` (render300.py, 3508x4961).
4. Check it. 5. Email the proof from hello@. 6. On approval, order from Prodigi (GB, GLOBAL-CFP-A3 or GLOBAL-FAP-A3, Standard). 7. Log in `business/ledger.csv`.

## Repo layout
- `ops/` cloud operations worker · `site/` website · `pipeline/` print templates and render scripts · `marketing/` mockups, Etsy listing, ad copy · `business/` pricing model, ledger, prospects.

## Budget tracker (£2,000 all-in, from 9 Nov 2026)
Spent to 9 Nov: £42.08 (domain £4.10, test print £15.48, Cloudflare £3.90/mo, Claude credit £18.60). Committed: free framed samples up to 5 × £51.30.
Keep this line current; the weekly growth agent recomputes it from business/ledger.csv.
