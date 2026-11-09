# Estate agent outreach

**Now automated (from 9 Nov 2026):** the ops worker finds, verifies and emails agencies every weekday (10/day in week one, then 20/day),
follows up after 7 days and handles replies. Templates live in `ops/src/outreach.js` (firstEmail, followUpEmail); the live prospect list
is the D1 `prospects` table (GET /admin/prospects). Batch 1 below was sent by hand and is kept for reference.

## First batch (sent by hand)

Rules: only email limited companies/LLPs at their business address (PECR corporate subscribers), identify the sender,
include an opt-out, and log every send and opt-out in business/agent_prospects.csv (status column).
Never email sole-trader or partnership agencies without consent — phone or post instead.

## Batch 1 recipients (Ltd company + published office email)
| Agency | Area | Email |
|---|---|---|
| Stevenson Whyte Ltd (07639802) | Manchester city centre | info@stevensonwhyte.co.uk |
| Keenans Estate Agents Ltd (07169716) | Bury (8 branches) | bury@keenans-estateagents.co.uk |
| Jaks & Co UK Limited (13338766) | Didsbury | info@jaksandco.co.uk |
| Wild & Griffith Limited (09099438) | Lees, Oldham | info@wildandgriffiths.co.uk |
| Jameson and Partners Ltd | Altrincham | jennifer@jamesonandpartners.co.uk |

## Email

Subject: A completion gift for {Agency} buyers

Hi {Agency} team,

I run House Almanac, a Manchester business that makes framed A3 prints of a home's history: the street on an 1890s Ordnance Survey map, the same spot today, a short history and timeline, and a message from you.

For agents, each print carries your logo and a QR code to your review page, and arrives framed at your branch ready for key handover. It's £75 a print, or £65 each if you order 10 or more a quarter, invoiced monthly with no contract.

There's an example and the details here: https://housealmanac.co.uk/agents

If it's useful, I'll make one free for a buyer completing with you this month, so you can see it in person before deciding anything.

Best wishes,
Reece Egan-Sheath
House Almanac · hello@housealmanac.co.uk · housealmanac.co.uk

If this isn't for you, reply "no thanks" and I won't email again.

## Follow-up (7 days later, only if no reply)

Subject: Re: A completion gift for {Agency} buyers

Hi {Agency} team, just bringing this back to the top of your inbox. The free sample offer stands for any buyer completing before Christmas. Reply with their new address and I'll send you a proof within 2 working days.

Reece

## Cost of the free-sample offer
Batch 1 SENT 2026-11-09 from hello@housealmanac.co.uk. Each free framed sample costs £51.30 (Prodigi frame + delivery + VAT). Cap: 5 samples (£256.50) for batch 1.
