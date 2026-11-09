# House Almanac — operating manual for Claude

House Almanac sells personalised A3 house-history prints (https://housealmanac.co.uk).
Owner: Reece Egan-Sheath, sole trader, Manchester. Claude runs the business; Reece only signs in, approves and pays.
Goal set by Reece: grow towards £1m/yr revenue.
Standing approvals from Reece (9 Nov 2026): "full control" of marketing, orders, website and changes; he wants nothing to do with day-to-day.
- Send all business email from hello@housealmanac.co.uk (never Reece's personal addresses).
- Customer emails (proofs, order updates) and agent outreach/follow-ups: approved, no need to ask.
- Prodigi orders for paid customer orders and approved agent free samples (batch 1: up to 5 x £51.30): approved.
- Any other new purchase or subscription: tell Reece the item and total and get a yes first.

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
| Estate agent completion gift | from £65 | as above | never price below £65 |
Stripe payment links: framed https://buy.stripe.com/4gM14p7UJfBSffW9512wU00 · unframed https://buy.stripe.com/00waEZ1wlblC5Fm3KH2wU01
Christmas: last order date 9 December.

## Systems
- Website: `site/` → Cloudflare Worker `housealmanac-web` (static assets), custom domains housealmanac.co.uk + www.
  Deploy: push to GitHub `main` — Workers Builds deploys the site automatically (root `/`, uses `wrangler.jsonc`). No manual upload needed.
- Payments: Stripe (account "House Almanac"), dashboard.stripe.com. Orders show under Transactions; custom fields carry the address, move-in year and message.
- Printing: Prodigi dashboard (dashboard.prodigi.com), card on file. Upload the print JPG (3508×4961, 300 dpi).
- Domain/DNS/email routing: Cloudflare account reeceegan02@gmail.com.
- Old worker `housealmanac-site` is retired (no domains); can be deleted.
- **Sending email**: Cloudflare Email Service (Workers Paid, $5/mo) via Worker `housealmanac-mail` (POST JSON, header `x-key` must equal the Worker secret MAIL_KEY).
  The key is NOT stored anywhere. Each session: generate a random key, set it in Cloudflare → Workers → housealmanac-mail → Settings → Variables and secrets → MAIL_KEY (Edit), then
  in Chrome open https://housealmanac-mail.reeceegan02.workers.dev/ and run (same origin):
  `await fetch('/',{method:'POST',headers:{'content-type':'application/json','x-key':KEY},body:JSON.stringify({to,subject,text,html,bcc:'hello@housealmanac.co.uk',fromName:'Reece Egan-Sheath | House Almanac'})})`
  Always BCC hello@ so there's a copy in the inbox. Fields: to, subject, text, html, cc, bcc, attachments [{content(base64),filename,type,disposition}].
  Replies arrive at hello@ → reeceegan02@gmail.com; read them in Chrome Gmail (search `to:hello@housealmanac.co.uk`). Only read House Almanac mail there.
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
- **Cron every 30 min**: Prodigi tracking → "on its way" email; retry stuck orders (3 tries then alert); 9am agent follow-ups; Monday weekly summary to hello@.
- **Admin API** (header `x-admin-key` = Worker secret ADMIN_KEY; not stored anywhere — rotate it in Worker settings if you need access):
  GET /admin/orders · GET /admin/order/:id · POST /admin/order/:id/restart · POST /admin/order/:id/approve · POST /admin/test-order
  · GET|POST /admin/prospects · GET /admin/events · POST /admin/send · POST /admin/summary · POST /admin/order/:id/set (fields)
  A restarted order reuses its saved research (data_json); set data_json to null first to force fresh research.
- Secrets (ANTHROPIC_API_KEY, PRODIGI_API_KEY, STRIPE_SECRET_KEY (restricted), STRIPE_WEBHOOK_SECRET, later ETSY_KEYSTRING/ETSY_SHARED_SECRET)
  live as **Build** secrets on housealmanac-ops (Settings → Build → Variables and secrets). Each Workers Build copies them into runtime
  secrets (`ops/scripts/sync-secrets.mjs`, run by wrangler's custom build). To rotate: change the build secret, then retry the build.
  `/health` shows true/false for each key (never the values).
- **Etsy**: once Reece registers an Etsy app (ETSY_KEYSTRING + ETSY_SHARED_SECRET secrets) and opens /etsy/connect once,
  the cron pulls paid receipts → workflow → after the AI check it prints straight away (Etsy API can't message buyers, so no proof)
  → tracking posted back to Etsy. Until connected, check Etsy Orders in Chrome.

## Manual fallback runbook (only if the automation is down)
1. Stripe → Transactions for new paid orders. 2. Research the street (sources for every fact). 3. Build the print with `pipeline/` (render300.py, 3508x4961).
4. Check it. 5. Email the proof from hello@. 6. On approval, order from Prodigi (GB, GLOBAL-CFP-A3 or GLOBAL-FAP-A3, Standard). 7. Log in `business/ledger.csv`.

## Repo layout
- `ops/` cloud operations worker · `site/` website · `pipeline/` print templates and render scripts · `marketing/` mockups, Etsy listing, ad copy · `business/` pricing model, ledger, prospects.
