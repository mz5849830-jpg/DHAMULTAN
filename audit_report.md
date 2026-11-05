# Maskan Estates: audit report (stage 5)

## What the project is
- One page app (`app.html`, about 1,300 lines of plain HTML/CSS/JS, no build step) hosted on Netlify.
- Netlify Functions: `site-data` (login, sessions, save/publish, backups, restore), `tool-data` (data storage for tools), `tool-zip` (ZIP tool uploads), `page` (server-side page tags, sitemap, robots, ads.txt).
- Storage: Netlify Blobs (stores `maskan`, `maskan-tools`). Admin login: username/password from the `ADMIN_USERNAME` / `ADMIN_PASSWORD` environment variables, then a salted PBKDF2 hash, 12-hour sessions, 5-attempt lockout.
- Public pages: `/`, `/newsflash`, `/newsflash/<article>`, `/doc`, `/tools/<tool>`, plus every published page (`/about`, `/contact`, `/privacy-policy`, `/terms-and-conditions`, `/cookie-policy`, `/disclaimer`, `/earnings-disclosure`). Admin: `/admin`.

## Fixed
| # | Severity | Problem | Fix |
|---|---|---|---|
| 1 | High | Search engines saw no description, and every page had the same title, "Maskan Estates Preview". The SEO tags were shown only as text in the admin. | `page.mjs` renders tags for each page on the server; the browser keeps them updated as visitors move between pages. |
| 2 | High | The AdSense script never reached the page, even after an ID was saved. | Loads once a valid `ca-pub-` ID is saved; adds the verification meta tag and `/ads.txt`. |
| 3 | High | No real `/sitemap.xml`; `robots.txt` didn't list a sitemap. | Both are generated live from the published content and the current address. |
| 4 | Medium | Share tags and schema pointed to `og-default.jpg` and `logo.png`, which don't exist. | Removed; the share image is set only when you give one. |
| 5 | Medium | Public visitors saw the "Preview / Replay cookie banner" bar. | Shown only to signed-in admins; visitors use the footer **Cookie settings** link. |
| 6 | Medium | Footer links were buttons, so search engines couldn't follow them. | Changed to real links. |
| 7 | Medium | Privacy Policy and Terms were 2-3 lines each. There was no Cookie Policy. | Full templates written for an AdSense site, a new Cookie Policy page, and a one-click **Insert legal templates** button for existing sites. |
| 8 | Medium | Backups were saved on the server, but there was no way to see or restore them. | New **Backups & history** admin screen: list, restore with confirmation, download the full site as JSON. |
| 9 | Low | Unknown addresses returned the home page with status 200. | They now return 404 with `noindex` once site data exists. |
| 10 | Low | The `/admin` page didn't tell search engines to skip it. | `noindex`, `X-Robots-Tag`, no framing, `no-store`. |
| 11 | Low | The footer said "Sample content for preview" and showed a fixed year. | Removed; the year updates automatically. |

New admin screen **Site check & AdSense**: 10 live checks (AdSense ID, legal pages, About/Contact, sample details, word counts, article count, description length).

## Still open (needs you or a later stage)
- **Content (blocks AdSense approval):** sample contact details, sample listings and slider, articles under 300 words, `[date]` in the legal templates. The Site check screen lists each one.
- **EU/UK consent:** turn on Google's "Privacy & messaging" consent message in AdSense. The site's own banner is informational only.
- **Admin builder items not built yet:** drag-and-drop visual layout editor, multiple admin users and roles.
- **Data size:** solved for photos: the Photo library stores them separately. Use "Move embedded pictures into the library" once.
- **Not tested on real Netlify from here.** Tested locally in a browser: page titles and canonical links, admin sign-in, Site check and Backups screens, no script errors. After deploying, run the checklist below.

## After-deploy checklist
1. Set `ADMIN_USERNAME` and `ADMIN_PASSWORD` in Netlify, then redeploy.
2. Open `/sitemap.xml`, `/robots.txt` and view the source of `/newsflash`: each should show your staging address and its own `<title>`.
3. Admin > Site check > **Insert legal templates**, then edit `[date]` and your details.
4. Save your AdSense ID, then open `/ads.txt`.
5. Admin > Backups & history: a backup appears after your first publish.

## Stage 5 additions
- **Photo library** (Admin > Photo library, `netlify/functions/media.mjs`): upload several photos at once (auto-resized to 2000 px), edit alt text, copy link, delete with a warning when a photo is in use, and one-click move of pictures embedded in the site content. Files are checked by their real image signature (JPG/PNG/WebP/GIF/AVIF only, 4 MB max) and served from `/media/<id>` with long caching and a sandbox header. Uploading and deleting need an admin session.
- **Activity log** (Admin > Activity log): last 300 events: sign-ins, failed sign-ins (with a warning after 3 in 24 h), sign-outs, publishes with what changed, restores, account changes, photo uploads/deletes. Passwords and tokens are never stored; IP addresses are shortened.
- Tested locally in a browser: photo upload, library grid, activity log. No script errors.
