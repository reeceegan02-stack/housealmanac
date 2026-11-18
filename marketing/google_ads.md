# Google Ads plan (account 498-155-5331, created 18 Nov 2026)

Account: Reece's Google login, payments profile "reece egan-sheath" (Individual, UK), GBP, UK time.
Do NOT link the BICS (NW) Business Profile Google suggests (it's Reece's client). No Meta (Reece's accounts get banned).
Budget approved in principle: about £10/day to 9 Dec (gift prints), then about £100 for vouchers to 23 Dec. Max £300 total.

## Campaign 1: Search, "House history prints" (UK, English), Maximise conversions once tracking works (Maximise clicks, max CPC £0.80, until then)
Ad group A: house history / map
- [house history print] "house history print" "history of my house" "history of your house print" "old map of my street"
- "personalised house print" "personalised street map" "then and now map" "old ordnance survey map print"
Ad group B: new home gifts
- "new home gift" "first home gift" "housewarming gift" "housewarming present" "unique new home gift" "moving house gift"
Ad group C: Christmas
- "christmas gift for parents" "personalised christmas gift for home" "unique christmas gift for couple"
Negatives: free, download, printable, jobs, course, wallpaper, canvas, cheap, ancestry, census, deeds, land registry search, planning permission

Responsive search ads (headlines ≤30 chars):
- The Story of Your Home · Your Street, Then and Now · Old OS Map + Today's Map · Personalised House History · Framed A3, Free UK Delivery
- A Gift for a New Home · Order by 9 Dec for Christmas · Gift Vouchers Sent Instantly · Researched for Your Address · From £39, Framed £89
Descriptions (≤90 chars):
- Your street on a historic Ordnance Survey map beside today's, with its history and timeline.
- A personal gift for a first home or housewarming. Framed or unframed A3, free UK delivery.
- Leaving it late? Gift vouchers arrive by email in minutes, ready to print.
Final URLs: / (A, B), /gift (C, and all ads after 9 Dec).

## Conversion tracking (to do once billing is on)
Stripe Payment Links → "After payment: redirect" to https://housealmanac.co.uk/thanks?sid={CHECKOUT_SESSION_ID}
(new page /thanks with the Google tag + purchase conversion; value from the link: £89 / £39 / voucher).
