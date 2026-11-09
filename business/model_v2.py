"""House Almanac - 12-month model (Nov-26 to Oct-27). All GBP. Not VAT registered (<£90k)."""
import json

MONTHS = ["Nov-26","Dec-26","Jan-27","Feb-27","Mar-27","Apr-27","May-27","Jun-27","Jul-27","Aug-27","Sep-27","Oct-27"]

# ---------- B2C unit economics ----------
MIX = {"digital": 0.15, "print": 0.35, "framed": 0.50}
PRICE = {"digital": 19, "print": 39, "framed": 79}
COGS = {"digital": 0.0, "print": 19.0, "framed": 31.0}   # POD print + delivery, incl. supplier VAT (we can't reclaim)
AI_PER_ORDER = 1.50                                     # research + previews (cached per street)
ETSY_SHARE = 0.5
STRIPE = lambda v: 0.015 * v + 0.20
ETSY_FEE_RATE = (0.065 + 0.04 + 0.0048) * 1.2           # transaction + processing + reg fee, +20% VAT on fees
ETSY_FIXED = (0.20 + 0.16) * 1.0                        # processing fixed + listing renewal
OFFSITE_SHARE, OFFSITE_RATE = 0.20, 0.15 * 1.2
CAC_OWN, CAC_ETSY = 20.0, 3.0                           # paid acquisition per order by channel

aov = sum(MIX[k] * PRICE[k] for k in MIX)
cogs = sum(MIX[k] * COGS[k] for k in MIX)
fee_own = STRIPE(aov)
fee_etsy = ETSY_FEE_RATE * aov + ETSY_FIXED + OFFSITE_SHARE * OFFSITE_RATE * aov
fees = ETSY_SHARE * fee_etsy + (1 - ETSY_SHARE) * fee_own
contrib_pre = aov - cogs - fees - AI_PER_ORDER
mkt = ETSY_SHARE * CAC_ETSY + (1 - ETSY_SHARE) * CAC_OWN
contrib = contrib_pre - mkt

# ---------- B2B (estate agents) ----------
B2B_PRICE, B2B_COGS, B2B_AI = 42.0, 24.0, 1.0           # framed A4, agency-branded, sent to buyer
UNITS_PER_AGENCY = 5
b2b_fee = STRIPE(B2B_PRICE * UNITS_PER_AGENCY) / UNITS_PER_AGENCY
b2b_contrib = B2B_PRICE - B2B_COGS - B2B_AI - b2b_fee

# ---------- scenarios ----------
BASE_B2C = [10, 40, 10, 15, 22, 18, 18, 25, 18, 18, 22, 25]
BASE_AG  = [0, 0, 2, 4, 6, 8, 10, 12, 14, 15, 17, 18]     # paying agencies (Jan = free pilots)
SCEN = {
    "Downside": ([round(x * 0.5) for x in BASE_B2C], [0, 0, 0, 1, 2, 3, 3, 4, 4, 5, 5, 5], 35.0, 0.3),
    "Base":     (BASE_B2C, BASE_AG, CAC_OWN, ETSY_SHARE),
    "Upside":   ([x * 2 for x in BASE_B2C], [0, 0, 4, 8, 12, 17, 22, 27, 32, 36, 40, 45], 15.0, 0.5),
}

ONE_OFF = {  # month index -> items
    0: {"ICO data protection fee (DD)": 47, "Domain (1 yr)": 15,
        "Etsy shop setup": 12, "Test prints & frame samples": 250, "Product mockup tool": 15},
}
FIXED = {"Hosting & storage": 20, "Business email": 7, "Bookkeeping (spreadsheet/free tier)": 0,
         "Email marketing": 0, "Etsy listing renewals & misc": 10}
FIXED_M = sum(FIXED.values())
EMAIL_FROM = 4  # paid email tier from Mar-27
B2B_ACQ = {0: 400, 1: 250, 2: 250, 3: 100}  # sample packs + campaign costs Jan-Mar
LAUNCH_TEST = {0: 200}               # creative tests before scaling Christmas ads

def run(name, b2c, ag, cac_own=CAC_OWN, etsy_share=ETSY_SHARE):
    f = etsy_share * fee_etsy + (1 - etsy_share) * fee_own
    mk_per = etsy_share * CAC_ETSY + (1 - etsy_share) * cac_own
    cash, rows, min_cash = 5000.0, [], 5000.0
    tot = dict(rev=0, gp=0, mkt=0, fixed=0, oneoff=0, profit=0)
    for i, m in enumerate(MONTHS):
        units_b2b = ag[i] * UNITS_PER_AGENCY
        rev_b2c = b2c[i] * aov
        rev_b2b = units_b2b * B2B_PRICE
        var_b2c = b2c[i] * (cogs + f + AI_PER_ORDER)
        var_b2b = units_b2b * (B2B_COGS + B2B_AI + b2b_fee)
        mk = b2c[i] * mk_per + B2B_ACQ.get(i, 0) + LAUNCH_TEST.get(i, 0)
        fx = FIXED_M + (15 if i >= EMAIL_FROM else 0)
        oo = sum(ONE_OFF.get(i, {}).values())
        rev = rev_b2c + rev_b2b
        gp = rev - var_b2c - var_b2b
        profit = gp - mk - fx - oo
        cash += profit
        min_cash = min(min_cash, cash)
        rows.append(dict(month=m, b2c_orders=b2c[i], agencies=ag[i], b2b_units=units_b2b,
                         revenue=round(rev), gross_profit=round(gp), marketing=round(mk),
                         fixed=round(fx), one_off=round(oo), profit=round(profit), cash=round(cash)))
        for k, v in zip(["rev","gp","mkt","fixed","oneoff","profit"], [rev, gp, mk, fx, oo, profit]):
            tot[k] += v
    tot = {k: round(v) for k, v in tot.items()}
    tot.update(end_cash=round(cash), min_cash=round(min_cash),
               b2c_orders=sum(b2c), b2b_units=sum(a * UNITS_PER_AGENCY for a in ag), agencies_m12=ag[-1])
    return rows, tot

out = {"unit": dict(aov=round(aov, 2), cogs=round(cogs, 2), fees=round(fees, 2), ai=AI_PER_ORDER,
                    contrib_pre=round(contrib_pre, 2), mkt=round(mkt, 2), contrib=round(contrib, 2),
                    gm_pct=round((aov - cogs) / aov * 100, 1),
                    b2b_price=B2B_PRICE, b2b_contrib=round(b2b_contrib, 2),
                    b2b_margin_pct=round(b2b_contrib / B2B_PRICE * 100, 1),
                    agency_month_contrib=round(b2b_contrib * UNITS_PER_AGENCY, 2)),
       "fixed_monthly": FIXED_M, "scenarios": {}}
for n, (b, a, c, e) in SCEN.items():
    rows, tot = run(n, b, a, c, e)
    out["scenarios"][n] = {"rows": rows, "totals": tot}

# break-even: B2C orders/month to cover fixed + email tier
out["breakeven_b2c_orders_per_month"] = round((FIXED_M + 15) / contrib, 1)
out["agencies_to_cover_fixed"] = round((FIXED_M + 15) / (b2b_contrib * UNITS_PER_AGENCY), 1)
json.dump(out, open("/tmp/claude-0/-home-claude/f53446ec-d38b-555b-9f62-36350c96cafa/scratchpad/model_v2.json", "w"), indent=1)
print(json.dumps(out["unit"], indent=1))
for n, s in out["scenarios"].items():
    print(n, s["totals"])
    if n == "Base":
        for r in s["rows"]:
            print(r)
print("breakeven B2C orders/mo:", out["breakeven_b2c_orders_per_month"], " agencies to cover fixed:", out["agencies_to_cover_fixed"])
