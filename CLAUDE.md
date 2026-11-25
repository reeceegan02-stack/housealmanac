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

**Focus (Reece, 23 Nov 2026): "we shouldn't be emailing law firms and stuff when we are trying to get estate agents to buy".** Cold outreach
goes to estate agents only (no press, gift-guide, blogger, conveyancer or other partner pitches). Consumer channels KEEP GOING: "google and
etsy should all keep going" (Google Ads re-enabled 23 Nov after a 1-hour pause; Etsy Ads ON since 25 Nov, US$5/day on all 6 listings). Don't email Reece
FYIs; the weekly update is his one regular email.

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
| Unframed A3 | £39 | GLOBAL-HPR-A3 (Hahnemühle Photo Rag 308gsm cotton, from 20 Nov; was FAP EMA 200gsm) | £21.66 (£12 + £6.05 Evri next day + VAT; Prodigi quote 20 Nov) |
| Framed A3, black classic | £89 | GLOBAL-CFP-A3 (no mount, acrylic) | £51.66 (£32 + £11.05 DPD + VAT; Prodigi quote 20 Nov) |
| Estate agent completion gift | £75, then £65 (code AGENCY10 after first paid order) | as above | never below £65; always paid up front |
Stripe payment links: framed https://buy.stripe.com/4gM14p7UJfBSffW9512wU00 · unframed https://buy.stripe.com/00waEZ1wlblC5Fm3KH2wU01
Christmas: last order date 9 December (site banner switches to vouchers after that, and hides after 25 Dec).
Gift vouchers (9 Nov): framed £89 https://buy.stripe.com/28EcN74IxdtKebS2GD2wU03 · unframed £39 https://buy.stripe.com/6oUdRb0shfBSffW1Cz2wU04
(pages /gift and /redeem). Frame colour: black by default; white or natural on request (inbox stores ship_json.frame_colour, Prodigi gets it).
Unframed A3 ships ROLLED in a cardboard tube via Evri (no flat option at A3). Reece (20 Nov): "it didn't come out too bad", move to thicker
paper and offer unframed to agents. From 20 Nov ALL unframed (site, vouchers, Etsy, agents) prints on GLOBAL-HPR-A3; copy says "heavyweight
308gsm cotton art paper (Hahnemühle Photo Rag), sent rolled in a sturdy tube". Prodigi support was asked about flat shipping (supplier_mail events).
**Agent unframed option LIVE 20 Nov** (Reece said yes to £39; AGENT_UNFRAMED=true in ops/src/pricing.js): profit £17.34 on Photo Rag
(framed £75 → £23.34). Approve reply carries both links; /pay/<order>/unframed creates a fresh £39 Stripe Checkout (metadata product=unframed);
payForProof uses metadata.product (amount <= £40 only as fallback). agents.html shows both prices.
**Free office samples from 20 Nov 17:00 UTC** (pricing.js SAMPLE_SWITCH_AT; previews created earlier keep the free framed offer): unframed and
free, or framed for £30 via /pay/<preview>/framed (Stripe Checkout, metadata kind=sample_upgrade → source agent-sample, counts as a sample,
no AGENCY10, not a "paying agency"). "yes, framed" replies get the £30 link; plain "yes"/"unframed" prints unframed free.
Sample cap: Reece 20 Nov 16:33 "increase in samples approved" → FREE_SAMPLES_CAP 9 (2 framed used + 7 unframed ≈ £152, the money that
was earmarked for 3 more framed), plus 1 per paying agency as before.
Stripe restricted key "House Almanac ops" (rk_live…R4Pw) has Checkout Sessions: Write + Payment Links: Write since 20 Nov (Reece signed in to the
House Almanac Stripe login in Chrome and asked me to do it). Payment links still use Stripe's own confirmation page; switching to /thanks
redirects (POST /admin/stripe/link-redirects) would also fire the "Purchase" tag, so make that action secondary first (double counting).
Fixed 20 Nov: office-preview orders (external_ref 'preview-<email>') are treated as unpaid when an agency pays for them.
All 6 Etsy listing descriptions updated 20 Nov: unframed = 308gsm Hahnemühle Photo Rag, rolled; framed = 200gsm EMA (copy in marketing/etsy_listing.md).

## Systems
- Website: `site/` → Cloudflare Worker `housealmanac-web` (static assets), custom domains housealmanac.co.uk + www.
  Deploy: push to GitHub `main` — Workers Builds deploys the site automatically (root `/`, uses `wrangler.jsonc`). No manual upload needed.
- Payments: Stripe (account "House Almanac"), dashboard.stripe.com. Orders show under Transactions; custom fields carry the address, move-in year and message.
- Printing: Prodigi dashboard (dashboard.prodigi.com), card on file. Upload the print JPG (3508×4961, 300 dpi).
- Domain/DNS/email routing: Cloudflare account reeceegan02@gmail.com.
- Old worker `housealmanac-site` is retired (no domains); can be deleted.
- **Sending email**: the ops worker sends from hello@ (Cloudflare Email Service, Workers Paid $5/mo). For a one-off email, POST /admin/send
  on housealmanac-ops (fields: to, subject, text, html, cc, bcc, attachments, fromName; BCC to hello@ by default).
  Attachments must reach the Email Service as bytes (Uint8Array): base64 strings were sent as text, so attachments up to 10 Nov 10:30 UTC
  didn't open. sendMail converts strings; prints are also shown in the email body (inlineImage) with a view-online link. The old `housealmanac-mail`
  worker is no longer used.
  Replies arrive at hello@ → ops worker (acts on them). Since 18 Nov (Reece's wish) only mail meant for Reece is forwarded to his Gmail:
  our own emails addressed To hello@ (weekly update, ACTION NEEDED, Decision, agent emails to him) and any email the handler fails on.
  Everything external is archived in KV FILES as mail-<date>-<rand>.eml for 180 days; BCC copies of outgoing mail are logged only.
  HTML emails get a designed signature (mail.js signatureHtml, logo site/email-mark.png) from the "Best wishes,\nReece…" sign-off.
- **No AI mentions** (Reece, 18 Nov): not on the website, emails or pitches. Exceptions: the Etsy listing keeps a one-line disclosure
  (Etsy requires it), the privacy policy lists "research and drafting software" as a processor category, and if anyone sincerely asks,
  the inbox answers honestly (kb.js) — never deny it.
- Etsy shop: HouseAlmanac (Reece's Etsy account, signed in in Chrome). Listing copy in `marketing/etsy_listing.md`. 6 active listings since 18 Nov:
  the original plus copies angled at first home, housewarming, Christmas gift for parents, then-and-now map art, and leaving home
  (same product, variations and photos; different titles, tags and first line). New listings cost $0.20 each (needs Reece's yes).
  Reece's Meta ad accounts keep getting banned, so no Meta ads.
- Google Ads: account 498-155-5331 created 18 Nov (Reece asked me to set it up in Chrome) under his Google login, payments profile
  "reece egan-sheath" (Individual, UK), GBP, Postpay, bank account ••50 added by Reece 18 Nov (verification pending: only he can verify).
  Campaign "House history prints - Search UK" (id 24485609945) published 18 Nov: Search only, UK presence, Maximise clicks max CPC £0.80,
  campaign TOTAL budget £280 hard cap, 18 Nov–23 Dec, AI Max/auto assets off, 15 keywords, 22 negatives, 1 RSA, 4 sitelinks, 4 callouts.
  Bank ••50 verified 18 Nov; ad APPROVED and campaign SERVING (learning) 18 Nov 14:49. Never link the BICS (NW) Business Profile Google offers.
  **Monitoring (no API keys), LIVE 18 Nov**: Google Ads script "House Almanac monitor" (Tools → Bulk actions → Scripts, id 12742311, authorised,
  Frequency: Hourly) is a 2-line loader that evals GET /ads/script.js (code in ops/src/ads.js): posts stats + search terms to POST /ads/report,
  applies commands from GET /ads/commands (negatives, pause/enable, offline conversions). Daily ops agent reviews search terms and queues negatives
  (add_ads_negatives, guarded so it can never block our keywords); status.json → google_ads (aggregates, no search terms); weekly update shows
  spend vs the £280 cap. Admin: GET /admin/ads, POST /admin/ads/command {negatives|pause|enable}, POST /admin/ads/offline {enabled}.
  **Sales tracking LIVE 18 Nov 15:10 (import route)**: Reece said yes to Google's EU user consent policy declaration. Conversion action
  "Stripe purchase (import)" (Import from clicks, Purchase, primary, every, 90 days, value from each sale, default £39). site/ads.js adds
  client_reference_id=g-<gclid> to Stripe links only for visitors who accepted cookies (tested); ingestStripeSession records it in D1
  ad_conversions; /ads/commands lists pending ones (kv ads_offline_enabled=true); the hourly script uploads them and reports back.
  The older website-tag action "Purchase" (fires on /thanks) is also primary but never fires, because Stripe can't redirect there (restricted key
  lacks Payment Links permissions; Chrome's Stripe login is Reece's Refined Business Consulting account, never use it). If redirects are
  ever added, make "Purchase" secondary to avoid double counting.

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
  4 minutes apart) an **office preview**: an agent-preview order for their own office address goes through the normal pipeline (4 web searches)
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
- **Gift vouchers** (`ops/src/voucher.js`, `voucher-html.js`, Workflow `housealmanac-voucher`): a paid session from either voucher link
  (matched by payment_link id, or a custom field mentioning "voucher") → D1 `vouchers` row (code GIFT-XXXX-XXXX, 12 months) → A5 PDF via
  Browser Rendering → emailed to the buyer (cron re-sends the code as plain text if not emailed within 20 min). Recipient redeems at
  housealmanac.co.uk/redeem → POST /voucher/redeem (CORS, 8 failed codes/hour/IP) → order source 'voucher' (nothing to pay) → normal proof
  flow. Cancel before approval → voucher reactivated. Inbox: buyers can get their code resent; unused vouchers within 14 days are refunded
  automatically (Stripe refund), anything else escalates. Admin: GET /admin/vouchers, POST /admin/voucher/test {email, product, recipient}.
- **Cron every 30 min**: Prodigi tracking → "on its way" email; retry stuck orders (3 tries then alert); Stripe reconciliation (paid sessions
  with no order get created, and hello@ is warned the webhook missed them); Monday 09:00 UTC weekly update to Reece (after the growth agent, includes its plan; POST /admin/summary {dry:true} previews it).
- **Admin API** (header `x-admin-key` = Worker secret ADMIN_KEY; not stored anywhere — rotate it in Worker settings if you need access):
  GET /admin/orders · GET /admin/order/:id · POST /admin/order/:id/restart · POST /admin/order/:id/approve · POST /admin/test-order
  · GET|POST /admin/prospects · GET /admin/events · POST /admin/send · POST /admin/summary · POST /admin/order/:id/set (fields) · POST /admin/stripe/reconcile · POST /admin/etsy/poll
  · POST /admin/outreach/run · POST /admin/outreach/find {area} · POST /admin/outreach/preview {email} · GET /admin/samples · GET /admin/check
  A restarted order reuses its saved research (data_json); set data_json to null first to force fresh research.
- Claude API: Reece's Console org. Free $100 credit (29 Oct, to 24 Nov), $20 prepaid (bought 9 Nov), and another FREE $100 API credit granted
  21 Nov (expires 24 Dec; $0 invoice, not a purchase). Balance $151.79 on 23 Nov before the 24 Nov expiry. Auto-reload OFF by Reece's choice.
  ORG MONTHLY SPEND LIMIT raised from $75 to $200 on 23 Nov (Reece said yes; $68.21 used then, resets the 1st). If it's ever hit, every API
  call fails (orders, inbox, outreach) until the 1st. Changing it charges nothing (credit is prepaid) but is an account setting: Reece's yes.
  ~$0.30 per order. The worker estimates usage (kv claude_usd_*) and emails hello@ when under ~$5 is left; top-ups need Reece's yes.
  Burn on 18 Nov: ~$6 per weekday, mostly agent office previews. Once only $6 of prepaid is left, outreach and pitches pause automatically
  (controls.js creditReserveHit) so customer orders can still be researched. After any top-up, raise PREPAID_USD in claude.js.
- Secrets (ANTHROPIC_API_KEY, PRODIGI_API_KEY, STRIPE_SECRET_KEY (restricted), STRIPE_WEBHOOK_SECRET, later ETSY_KEYSTRING/ETSY_SHARED_SECRET)
  live as **Build** secrets on housealmanac-ops (Settings → Build → Variables and secrets). Each Workers Build copies them into runtime
  secrets (`ops/scripts/sync-secrets.mjs`, run by wrangler's custom build). To rotate: change the build secret, then retry the build.
  `/health` shows true/false for each key (never the values).
- **Etsy**: CONNECTED 10 Nov 2026 (app "house-almanac-orders" approved, callback added, access allowed; /admin/check shows etsy.connected). Forwarding sale emails is no longer needed. The cron pings the API every 30 min; when the key goes
  live it emails hello@ the last two steps (add callback URL https://housealmanac-ops.reeceegan02.workers.dev/etsy/callback in the app, then
  Reece opens /etsy/connect and clicks Allow). Reece must paste ETSY_KEYSTRING + ETSY_SHARED_SECRET as Build secrets (never enter keys yourself).
  Once connected: cron pulls paid receipts → workflow → printed straight after the automatic check (the live listing offers no proof) → tracking to Etsy.
  Stopgap until then: Reece forwards Etsy's "You made a sale" email to hello@ and the inbox creates the order (external_ref etsy-<receipt>, so no duplicates later).

## Agents (monitoring, maintenance, growth) — nothing depends on Reece's laptop
- Worker cron rebuilds a privacy-safe snapshot every 30 min → public https://housealmanac-ops.reeceegan02.workers.dev/status.json
  (no names/emails/addresses; scrubbed). GitHub Action `.github/workflows/ops-status.yml` copies it every 2 h into the open issue
  labelled `ops-status` ("Ops status"). Scheduled cloud sessions can only reach GitHub, so they read that issue.
- **In-worker agents** (`ops/src/agent.js`, Workflow `housealmanac-agents`, Claude API with bounded tools; run in Cloudflare, no laptop):
  - Daily ops agent 07:00 UTC: reads the snapshot; can restart stuck orders, pause/resume outreach (kv agent_outreach_paused),
    and email Reece only when he must act (once per run).
  - Weekly growth agent Mondays 07:00 UTC: estate agents only. Sets outreach per-day (kv agent_outreach_per_day, 0-40) and writes a
    short funnel note that goes into the weekly update. No web search, no pitches, no emails to Reece (since 23 Nov).
    Press/gift-guide/blogger/partner pitches are OFF (outbox.js PITCHES_ON=false; anything still queued is cancelled): 32 went out 13-23 Nov.
    Pitch text under 200 chars or "undefined" is rejected (one went out blank to a conveyancer on 23 Nov). Notes appear in the snapshot (`agents`).
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
Spent to 19 Nov: £148.46 (domain £4.10, test print £15.48, Cloudflare £3.90/mo, Claude credit £18.60, free agency samples 1-2 £102.60, Etsy fees £2.98, 5 extra Etsy listings £0.80), plus Google Ads £36.87 to 23 Nov (687 impressions, 47 clicks, 0 sales; billed later to Reece's bank: log the invoice in the ledger when it arrives). Claude credit top-up ($100, approved 18 Nov) NOT needed yet: a free $100 API credit arrived 21 Nov (to 24 Dec); re-check before 24 Dec. Claude org monthly spend limit raised to $200 on 23 Nov (no charge). Committed: 7 more free unframed samples × £21.66 (Reece approved the increase 20 Nov); Etsy Ads ON 25 Nov (Reece said yes 9 Nov and again 23 Nov): US$5/day (~£3.95; the shop bills in USD) on all 6 listings, max ~US$75 (~£59) to 9 Dec; a scheduled reminder switches it off 9 Dec; Google Ads up to £280 (campaign total cap, Reece agreed max £300 on 18 Nov; spend is billed to his bank, log it from Billing → Summary).
Keep this line current; the weekly growth agent recomputes it from business/ledger.csv.
