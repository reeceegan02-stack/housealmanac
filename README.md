# House Almanac

Personalised A3 house-history prints — https://housealmanac.co.uk

- `site/` — the public website (static files, served by the Cloudflare Worker `housealmanac-web`).
- `pipeline/` — print templates and render scripts (HTML/CSS A3 template, 4 colour themes, Playwright render at 300 dpi).
- `pipeline/examples/bentgate/` — the first real print (78 Bentgate Street), kept as a worked example.
- `business/` — unit-economics model.

Deploy the site: `npx wrangler deploy` (needs a Cloudflare API token), or upload `site/` in the Cloudflare dashboard.
