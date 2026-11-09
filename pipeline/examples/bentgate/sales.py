# Bentgate Street sales from HM Land Registry Price Paid Data (via doogal.co.uk), OL16 4JR + OL16 4JS (4NU: none).
# No. 78 deliberately excluded. Transfers under £20k excluded as likely non-market.
M = dict(Jan=1,Feb=2,Mar=3,Apr=4,May=5,Jun=6,Jul=7,Aug=8,Sep=9,Oct=10,Nov=11,Dec=12)
raw = """80 Aug 2026 185000|80 Jun 2019 120000|80 May 2013 90000|80 Mar 2005 82500|84 Jul 2025 230000|84 Apr 2011 105000|84 Jul 2002 59950|84 Dec 1996 28500|86 Jun 2023 115000|86 Apr 1999 33500|90 Jun 2021 140000|90 Aug 2014 93000|90 Mar 2001 33500|94 Nov 2019 112000|82 Jan 2018 119950|82 Mar 2014 67200|82 Aug 2002 25500|41 May 2016 88000|41 Apr 2007 128000|41 Dec 2000 44000|41 May 2000 45000|41 Feb 1999 42000|98 Apr 2015 117000|98 Mar 2006 97950|51 Mar 2012 129000|51 Aug 1996 36000|34 Jul 2026 180000|34 Oct 2016 96950|34 Feb 1997 39000|27 Apr 2026 187000|6 Jan 2026 210000|6 May 2022 187500|6 Feb 2019 105000|6 Jul 2012 107000|20 Nov 2025 102000|20 Jul 2012 79950|8 May 2025 165000|8 Feb 2022 151000|8 Jul 2005 88000|8 Nov 2004 80000|8 Mar 1996 37000|26 Dec 2024 128000|62 Mar 2023 112000|62 Jan 2000 17500|32 Apr 2022 160000|32 Jun 2017 110000|32 May 2006 99000|32 May 1996 8000|10 Nov 2018 115000|10 Oct 2004 96950|24 Oct 2018 108000|24 Jul 2012 93500|24 Dec 2008 80000"""
rows=[]
for r in raw.split('|'):
    no,mo,yr,p = r.split(); rows.append((int(no), int(yr)+(M[mo]-0.5)/12, int(p)))
assert not any(n==78 for n,_,_ in rows)
kept=[r for r in rows if r[2]>=20000]; dropped=[r for r in rows if r[2]<20000]
import statistics as st
early=[p for _,t,p in kept if t<2001]; late=[p for _,t,p in kept if t>=2022]
print(len(rows),'rows; kept',len(kept),'dropped',dropped)
print('early median',st.median(early),len(early),'late median',st.median(late),len(late), 'max',max(p for *_,p in kept))
# SVG strip: viewBox 0 0 640 110; x 30..630 for 1996..2027; y 92 (0) .. 12 (240k)
X=lambda t:30+(t-1996)/31*600; Y=lambda p:92-p/240000*80
dots=''.join(f'<circle cx="{X(t):.1f}" cy="{Y(p):.1f}" r="4.4"/>' for _,t,p in sorted(kept,key=lambda r:r[1]))
ticks=''.join(f'<text x="{X(y):.1f}" y="108" text-anchor="middle">{y}</text>' for y in (1996,2006,2016,2026))
open('strip.svg.txt','w').write(f'''<svg viewBox="0 0 640 110" style="width:128mm; height:22mm;" aria-label="Recorded sale prices on Bentgate Street, 1996 to 2026">
    <line x1="30" y1="92" x2="630" y2="92" class="axis" stroke-width="1.6"/>
    <g font-family="Inter, sans-serif" font-size="13" class="softf">{ticks}</g>
    <g class="dots">{dots}</g>
    <g font-family="Inter, sans-serif" font-size="13" class="inkf" font-weight="600">
      <text x="34" y="40">Typical sale 1996–2000: £{st.median(early):,.0f}</text>
      <text x="630" y="80" text-anchor="end">2022–2026: £{st.median(late):,.0f}</text>
    </g>
  </svg>''')
print(len(kept))
