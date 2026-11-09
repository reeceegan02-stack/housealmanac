# House Almanac — operating manual for Claude

House Almanac sells personalised A3 house-history prints (https://housealmanac.co.uk).
Owner: Reece Egan-Sheath, sole trader, Manchester. Claude runs the business; Reece only signs in, approves and pays.
Goal set by Reece: grow towards £1m/yr revenue. Standing permission: purchases up to £50 (still confirm item + total with him before paying).

## Rules that always apply
- Never enter passwords, card/bank details or ID, never create accounts — Reece does those.
- Any purchase: tell Reece the item and total and get a yes first. Anything over £50 needs a separate yes.
- Outbound messages (customer emails, agent outreach, social posts) need Reece's approval unless he has given a standing approval for that type in chat.
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
  Deploy: Cloudflare dashboard → Workers & Pages → housealmanac-web → New deployment → upload files.
  Files must be uploaded from `/mnt/user-data/uploads/...` (stage them from Reece's Dropbox folder
  `C:\Users\reece\Dropbox\Refined business consulting\House Almanc\website\` with device_stage_files first).
- Payments: Stripe (account "House Almanac"), dashboard.stripe.com. Orders show under Transactions; custom fields carry the address, move-in year and message.
- Printing: Prodigi dashboard (dashboard.prodigi.com), card on file. Upload the print JPG (3508×4961, 300 dpi).
- Domain/DNS/email routing: Cloudflare account reeceegan02@gmail.com.
- Old worker `housealmanac-site` is retired (no domains); can be deleted.

## Order runbook
1. **Check for orders**: Stripe → Transactions. For each new paid order, note the order date, customer email, product, address, move-in year and message.
2. **Research the street** (aim: same day):
   - Locate the address (OpenStreetMap search; take lat/lon). Get the street's OSM way geometry for the highlight.
   - Historic map: NLS 25-inch OS tiles (`25_inch/<county>` layers, or `25_inch_holes_england`), max zoom 18; capture a mosaic around the street. Credit NLS (CC-BY).
   - Today's map: OpenStreetMap tiles (credit © OpenStreetMap contributors).
   - History: council/heritage pages, Historic England, British History Online, local history society pages, Wikipedia. Every fact on the print must have a source; keep the list in the order folder.
   - Sales: HM Land Registry price paid data for the street (exclude the customer's own house).
3. **Build the print**: copy `pipeline/examples/bentgate/` to `orders/<order-id>/`, edit the template text (title, subtitle, story, timeline, sales strip, message), run the build, then render at 300 dpi with `render300.py` (3508×4961 JPG). Pick the theme the customer asked for (heritage default; `pipeline/themes.py`).
4. **Check**: view the full render and zoomed crops; check spelling of names and the message character for character; check every fact against its source.
5. **Proof**: email the customer a low-res JPG proof (needs Reece's approval or standing approval) and ask them to reply "approved" or list changes. Promise: proof within 2 working days of the order.
6. **Print**: once approved, create the Prodigi order (country UK → SKU → upload image → customer's delivery address from Stripe → Standard shipping), reference = HA-<Stripe payment id>. Confirm the cost with Reece if he hasn't given standing approval for order fulfilment.
7. **Log**: add revenue and Prodigi cost to `business/ledger.csv`. Delete print files 90 days after delivery (privacy policy).

## Repo layout
- `site/` website · `pipeline/` print templates and render scripts · `marketing/` mockups, Etsy listing, ad copy · `business/` pricing model, ledger, prospects.
