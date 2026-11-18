# Google Ads (account 498-155-5331)

Account: Reece's Google login, payments profile "reece egan-sheath" (Individual, UK), GBP, UK time, Postpay.
Bank account ••50 added and verified by Reece 18 Nov.
Do NOT link the BICS (NW) Business Profile Google suggests (it's Reece's client). No Meta (Reece's accounts get banned).
Budget: Reece agreed max £300 total. Campaign uses a campaign TOTAL budget of £280, so it cannot overspend.

## Campaign "House history prints - Search UK" (id 24485609945), published 18 Nov 2026
- Objective Sales, goal Purchases (conversion action "Purchase", AW-18582430154 / label 5cGlCKi737odEMrD5ZxF).
- Google Search only (Search Partners and Display off). Location: United Kingdom, presence only.
- Bidding: Maximise clicks, max CPC £0.80. Switch to Maximise conversions only after ~15 tracked purchases.
- Dates: 18 Nov – 23 Dec 2026. Budget: campaign total £280.
- AI Max off, text customisation and final URL expansion off, automatically created assets off.
- Google's estimate at set-up: ~1,400 clicks/week available at ~£0.21, so the budget, not demand, is the limit.

Ad group 1 (final URL https://housealmanac.co.uk/), 15 keywords:
[house history print], "house history print", "history of my house", "history of your house", "old map of my street",
"personalised house print", "personalised street map", "then and now map", "old ordnance survey map print",
"new home gift", "first home gift", "housewarming gift", "housewarming present", "unique new home gift", "moving house gift"
(A Christmas ad group with "christmas gift for parents" etc. was left out on purpose: huge, low-intent volume would eat the capped budget.)

Campaign negatives (broad): free, download, printable, jobs, course, wallpaper, canvas, cheap, ancestry, census, deeds, "land registry",
planning, rightmove, zoopla, "house prices", "sold prices", valuation, mortgage, template, svg, diy.
(Never add "survey" as a negative: it would block "ordnance survey".)

Responsive search ad (display path housealmanac.co.uk/house-history/prints). Ad strength Good. Headlines:
House Almanac · The Story of Your Home · Your Street, Then and Now · Old OS Map + Today's Map · Personalised House History ·
Framed A3, Free UK Delivery · A Gift for a New Home · Gift Vouchers Sent Instantly · Researched for Your Address · From £39, Framed £89 ·
A Unique Housewarming Gift · Approve a Proof Before Print · Perfect First Home Gift · History of Your Street
Descriptions:
- Your street on a historic Ordnance Survey map beside today's, with its story and timeline.
- A personal gift for a first home or housewarming. Framed or unframed A3, free UK delivery.
- Leaving it late? Gift vouchers arrive by email in minutes, ready to print.
- We research your address and email a proof to approve. Prints from £39, framed £89.
(No dated "order by 9 Dec" headline, so nothing goes stale; after 9 Dec the homepage banner points visitors to vouchers.)

Sitelinks: Gift Vouchers → /gift · See a Sample Print → /#whats-on-it · Prices → /#prices · How It Works → /#how
Callouts: Free UK Delivery · Proof Before Printing · Framed or Unframed A3 · Gift Vouchers Available

## Monitoring and upkeep (runs without Reece)
- Google Ads script "House Almanac monitor" (id 12742311) in the account: loads ops/src/ads.js code from the worker, reports stats hourly,
  applies queued negatives/pause/enable. One-time: Reece clicks Authorize → Allow; then set Frequency to Hourly.
- Daily ops agent (07:00 UTC) reads the search terms and adds negatives through a guard that rejects anything blocking our keywords.
- status.json → google_ads (spend, clicks, conversions, campaign/ad status, script errors); weekly update email shows spend vs the cap.

## Conversion tracking (not live yet; see CLAUDE.md "Sales tracking" for the two routes)
- site/ads.js loads the Google tag with consent mode v2 (denied until the visitor accepts; url_passthrough on), and for visitors who accepted,
  adds client_reference_id=g-<gclid> to Stripe links.
- Route (a): Stripe after-payment redirect to /thanks (fires the Purchase tag). Blocked: restricted key lacks Payment Links permissions and
  the House Almanac Stripe login isn't in Chrome.
- Route (b): offline import "Stripe purchase (import)" uploaded by the monitor script. Blocked on Reece's yes to Google's EU user consent
  policy declaration when creating the action; then POST /admin/ads/offline {enabled:true}.
- Until then: Maximise clicks doesn't need conversions; sales are visible in Stripe/weekly update anyway.

## Weekly check
Handled by the monitor + daily ops agent (search terms → negatives). Log spend in business/ledger.csv from Billing → Summary.
