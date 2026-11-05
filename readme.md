# Complete website backup (ZIP)

**Admin > Backups & history > Download complete website backup (ZIP)** (owner only) downloads one ZIP with:
- `admin-backend-source/` - the full site with the admin panel and backend (Netlify Functions) plus all data in `backup-data/` (pages, articles, photos, videos, tool boxes, settings). On a new Netlify site the data is restored automatically on the first visit (`netlify/lib/seed.mjs`); live data is never overwritten.
- Top level of the ZIP - the same site as plain files (index.html at the top, drag-and-drop ready) for any host (Vercel, Cloudflare Pages, GitHub Pages, cPanel/Hostinger). Includes `_redirects`, `vercel.json` and `.htaccess`. Read-only (no admin saving).
- No usernames, passwords, team accounts, sessions or activity log are included. On the new site set `ADMIN_USERNAME` and `ADMIN_PASSWORD` in Netlify environment variables to create the first login.

# Admin sign-in: username and password

Open `/admin` and sign in with the owner username and password. Google sign-in and `GOOGLE_CLIENT_ID` are no longer used.
The starting login is stored only as a salted hash. Change it any time in **Admin > Account**; the changed login is then kept.
Team members (editors) can be added in **Admin > Team**.

# Logo

`logo.png` (in the site root) is the default logo, header image, browser/Google icon and schema logo. Replace it in **Admin > Site customizer > Logo image** (upload a square PNG, 512 x 512 is best), or overwrite `logo.png` in the deploy folder.

# Pages: ZIP and link types

In **Admin > Pages** each page has a type:
- **Text page**: written in the editor (as before).
- **ZIP website or code**: upload a ZIP. A ZIP with `index.html` runs as a website inside the page (sandboxed). Source code in any language (Java, Python, PHP, C++, C#, Go, Rust, SQL, ...) is stored and shown as plain text, never executed; a ZIP with no HTML gets an automatic file list page. Programs (`.exe .dll .jar .apk ...`) are rejected. Limits are the same as tool ZIPs (30 MB, 400 files).
- **Link to another website**: enter an https:// address. The menu/footer link and `/<slug>` send visitors there; link pages are left out of the sitemap.

---

# Maskan Estates site: HTML tool boxes with ZIP upload

Static site (`index.html`) + Netlify Functions + Netlify Blobs. Nothing new needs to be installed or configured:
ZIP projects use the **same Netlify Blobs** your site already uses for site data. No extra service, no new environment variables.

## What changed (files)

| File | Change |
|---|---|
| `index.html` | Admin > HTML tool boxes: new **Upload ZIP File** button, ZIP panel (name, file count, size, entry file, Replace / Open in new tab / Remove), progress and error messages. Boxes with a ZIP render from stored files; all other box behaviour unchanged. |
| `netlify/functions/tool-zip.mjs` | **New.** Validates and stores ZIP files in Blobs (store `maskan-tools`), serves them at `/_tool/<box>.<version>/<path>`, cleans up replaced versions. |
| `tests/` (separate download, not part of the deploy) | Local Netlify stand-in, ZIP fixtures, browser end-to-end test, storage unit test. Keep it out of the deployed folder. |
| everything else | Untouched (`site-data.mjs`, `tool-data.mjs`, `netlify.toml`, `_redirects`, `package.json`). |

## Deploy

Deploy exactly as you do now (git push, or drag the folder / ZIP into Netlify). Netlify installs `@netlify/blobs` from `package.json` and builds the new function automatically.
No build command is needed. Then open `/admin`, sign in, go to **HTML tool boxes**.

## How to use (admin)

- **Upload a ZIP:** pick the box (Box 1, 2, 3...), click **Upload ZIP File**, choose your `.zip` (or drop it on the dashed box). The progress bar runs, then the tool appears in **Live preview** and publishes automatically (bottom bar says "All changes published").
- **Entry page:** `index.html` is used automatically (also inside a sub-folder). If the ZIP has several HTML files, an **Entry HTML file** dropdown appears; pick another and it switches instantly.
- **Replace:** click **Replace ZIP** (or Upload ZIP File again). The old tool stays live until the new one is fully uploaded and verified. Old files are deleted automatically after publishing.
- **Remove ZIP:** returns the box to the HTML code editor.
- **Reset this box to its sample:** resets only the selected box (its ZIP is dropped; other boxes are not touched).
- **Heading / disclaimer:** edit the fields as before, or tick *Edit box headings directly on the home page*. An empty disclaimer hides it.
- **Add / Delete box:** as before. Each box has its own files; deleting a box removes its stored files after publishing.
- **Gallery / file upload and paste:** unchanged (uploading an HTML file or photo replaces a ZIP in that box).

## What a ZIP may contain

HTML, CSS, JS/MJS, JSON, images (png jpg gif webp avif svg ico bmp), fonts (woff woff2 ttf otf eot), audio (mp3 wav ogg m4a aac), video (mp4 webm ogv mov), xml/txt/csv/md/pdf/webmanifest. Folders and relative paths are preserved.
Use **relative** paths (`css/style.css`, not `/css/style.css`); the admin warns about missing files and root-absolute links.

**Limits:** ZIP 30 MB; 60 MB extracted; 400 files; 5 MB per file (Netlify Function request limit); expansion ratio 100x.

**Rejected with a clear message:** corrupted or password-protected ZIPs, `../` or absolute paths, symbolic links, programs (`.exe .sh .jar ...`), server-side code (`.php .py .rb ...`), ZIP bombs, no HTML file.
**Skipped silently (with a notice):** `__MACOSX`, `.DS_Store`, hidden files, `node_modules`, unsupported file types.
**Needs a build:** TypeScript/JSX/Sass/React-Vue-Svelte projects must be built first (`npm run build`), then ZIP the built folder (`dist` / `build`). The admin explains this when no built HTML is found. PHP/Python/Node server code cannot run in a browser and needs a separate backend.

## Security model

- ZIP is checked in the browser **and again in the function** (paths, extensions, sizes, counts). Uploading/replacing/cleanup requires the admin token (same login as the rest of the admin).
- Files are stored under a random, immutable version id (`/_tool/<box>.<version>/...`); a version can never be overwritten, so one box can't touch another box's files.
- The tool runs in an `<iframe sandbox>` **without `allow-same-origin`**, so it gets an opaque origin: no access to the admin page, cookies, localStorage or the admin token. Every served file also carries a CSP `sandbox` header, so opening a file URL directly is sandboxed too. The CSP allows the site's own files, `data:`/`blob:`, and HTTPS for fonts/images/API calls plus the common CDNs (cdnjs, jsDelivr, unpkg, Tailwind, jQuery). Edit `CSP` in `tool-zip.mjs` to tighten or loosen.
- Because of the sandbox, ZIP tools cannot use `localStorage`/cookies (same as your existing pasted-HTML tools) and are not given the site's `claude.use('db')` bridge; they run as standalone pages.

## Storage and cleanup

Blobs store `maskan-tools`: `zf/` files, `zm/` manifests, `zu/` upload markers. After each successful publish the admin asks the function to delete versions that are no longer used by any box. Unpublished uploads are kept for 2 hours first, so nothing in use is ever removed.

## Tests (local)

```
cd tests && npm i && npx playwright install chromium
python3 make-fixtures.py
node local-server.mjs &        # Netlify stand-in with in-memory Blobs, login test/test
node e2e.mjs                   # 69 browser checks   |   node gc-test.mjs   # 15 storage checks
```
The local server is a stand-in: it runs the real function code with an in-memory Blobs mock. It does **not** replace a test on your real Netlify deploy (see checklist below).

## Netlify production checklist (please run once after deploy)

1. Admin > HTML tool boxes > Upload ZIP File with a small ZIP. Expect "ZIP uploaded and extracted" and the tool in the preview.
2. Wait for "All changes published", open the homepage in a private window, open the tool; refresh.
3. Trigger a redeploy; reload the tool page (files live in Blobs, not in the deploy).
4. If the upload says the *tool-zip function is not deployed* or the page can't be loaded back: check Netlify > Functions lists `tool-zip`, and that `_redirects` still ends with the catch-all (function routes `/api/tool-zip` and `/_tool/*` are matched first, exactly like your existing `/api/*` functions).

## Security & saving update (stage 1)
- Admin login is checked only on the server. The password hash is no longer in the public page.
- Stored credential is salted + PBKDF2-hashed; your old login keeps working and is upgraded automatically on first sign-in.
- Login gives a random session that expires after 12 hours. Sign out ends it on the server.
- 5 wrong passwords from one address locks login for 15 minutes (enforced on the server).
- Changing username/password requires the current one and signs out all other devices.
- Every save is version-checked: if a newer version exists, you get a warning instead of silently overwriting.
- The previous version is backed up before each save (last 20 kept; API actions `backups` / `restore`).
- "Saved" is only shown after the server confirms. Failed saves retry up to 5 times; unsaved changes stay on the device.
- Upload/tool endpoints use the same session check.

## Stage 2 audit fixes (this package)

- **Admin login no longer hardcoded.** Before first deploy, set `ADMIN_USERNAME` and `ADMIN_PASSWORD` in Netlify > Site settings > Environment variables, then redeploy. Sites that already changed their login keep working unchanged. Change the login in Admin > Account after first sign-in.
- **No fake domain.** Canonical URLs, Open Graph, schema and sitemap now use whatever address the site is opened on (staging URL now, your domain later).
- **No placeholder AdSense ID.** Ads load only after you enter a real `ca-pub-` ID in Admin > Website SEO & AdSense.
- SEO tags are now escaped (quotes in titles/descriptions can no longer break the page head).
- Security headers added in `netlify.toml`; admin is not indexed or frameable; `robots.txt` added.

## Stage 3: SEO & AdSense readiness fixes

- **Real page tags for search engines.** Before, titles/descriptions/canonical/schema were only shown as text in the admin and never added to the page, and the page title was "Maskan Estates Preview". New `netlify/functions/page.mjs` serves every public page with its own title, description, canonical, Open Graph and schema (NewsArticle + breadcrumb on articles), built from your saved site data. The browser also updates these tags as visitors move between pages.
- **`index.html` was renamed to `app.html`** so pages go through the function above. Don't add a new `index.html`.
- **Live `/sitemap.xml`, `/robots.txt` and `/ads.txt`** generated from your published data and the address the site is opened on (staging now, your domain later).
- **AdSense now actually loads** once a real `ca-pub-` ID is saved in Admin > Website SEO & AdSense (before, the script never reached the page). The `google-adsense-account` verification tag and `ads.txt` line are added automatically. Visitors in the EU/UK need a Google-certified consent banner: turn on Google's own "Privacy & messaging" consent message in your AdSense account.
- Removed links to `og-default.jpg` and `logo.png`, which didn't exist. Add a share image URL in the admin if you want one.
- The "Preview / Replay cookie banner" bar is shown only to signed-in admins. Visitors can reopen cookie choices from a new **Cookie settings** link in the footer.
- Footer links are real links now, so search engines can follow them. Removed the "Sample content for preview" footer text; the year updates automatically.
- `/admin` is sent with `noindex` and can't be framed.

**Still needed from you before applying for AdSense:** replace the sample contact details (`info@maskan.example`, `+92 300 0000000`, office address), the sample listings and the short Privacy Policy with real text, and add 300+ words of original writing per article.

## Stage 5
New admin screens: **Photo library** and **Activity log**. New function `netlify/functions/media.mjs` (Blobs store `maskan-media`). Nothing to configure; deploy as usual. See AUDIT_REPORT.md.

## Admin update: imported-panel bar, bigger preview, save popup fix
- **Menu:** the four items marked red in your screenshot (Admin/user label, Alerts, Photo library, Activity log) are removed from the admin menu. Their code is still in the file, only unreachable; nothing else was touched.
- **Green bar (right side, "Imported admin panels"):** upload an `.html` or `.zip` there (or use the existing *Upload ZIP File* / *Upload from gallery or files* buttons: they register a panel too). The admin page is detected (names like admin/dashboard, sidebar/nav/table markup, index.html, depth). If several pages look equally likely, the card shows a dropdown to choose. Each card has a live thumbnail, rename, **Open panel** (new tab, the real files via `/_tool/<id>.<version>/<entry>`), and Remove. Panels are saved with the site data (`panels`) and survive refresh.
- **Live preview** in HTML tool boxes is now large (about 380 x 720 and taller) and still updates as you type.
- **Save popup:** no more "Someone saved a newer version" dialog. Cause: `site-data` read the stored version with eventual consistency, so the next save could see an out-of-date version and report a false conflict. Fixed with strong consistency, a conflict check that only fires when the stored copy is really newer, and a silent self-check on the client. A real conflict now shows in the bottom save bar with an "Overwrite with my changes" button.
- Files changed: `app.html`, `netlify/functions/site-data.mjs`, `netlify/functions/tool-data.mjs`.

## Update: no green bar, Save all, faster pages, ZIP admin panels

### 1. "Imported admin panels" bar removed
The green panel on the right of the admin screen is gone (HTML, CSS and code). Uploading a ZIP or HTML file no longer adds anything to it. Panels that were stored before are cleaned up automatically the next time you save.

### 2. Save all button
A bar at the bottom of every admin screen now always shows the save state with a **Save all** button. Press it and everything (headings, disclaimers, boxes, ZIP choices, pages, colours...) is published right away; it tells you when it is done.
- **Auto-save** tick box (same bar): ticked = changes also publish by themselves a moment after you stop typing (as before). Untick it if you want to publish only when you press **Save all**. The choice is remembered in your browser.
- If a newer version was saved from another device, the bar shows **Overwrite with my changes** as before.
- A ZIP that is still uploading must finish before **Save all** works (it tells you).

### 3. Faster opening of pages and boxes
- `page.mjs` now embeds the site data inside the page, so visitors no longer wait for a second request to `/api/site-data` before anything shows (sites above 1.8 MB of data fall back to the old way). It also reads the data only once per page view and keeps the page template in memory.
- Admin start-up fetches the data and checks your sign-in at the same time. The heavy thumbnail frames of the old green bar are gone, so switching Box 1/2/3 and sections is lighter.
- The Google Fonts stylesheet no longer blocks the first paint.
- ZIP tools: the function keeps each tool's file list in memory (one storage read per file instead of two) and static files are cached by Netlify's CDN for a year (each upload has its own version address, so nothing goes stale).

### 4. ZIP files with an admin panel
When you upload a ZIP the admin now **analyses it**:
- **Separate admin page** (for example `admin.html`, `admin/index.html`, `admin-panel.html`, anything under an `admin/`, `administrator/`, `backend/` or `backoffice/` folder): it is **never served on the public address**. Visitors get the public page only (normally `index.html`). The admin page opens at **`your-site/tools/<tool-name>/admin`** (the "address / admin" you asked for). Open it while signed in; if you are not signed in, that address shows the website sign-in form first. The server hands the admin files out only against a short-lived (30 minutes) ticket that only a signed-in admin can create, so guessing the file address does not work (403).
- **Admin tab inside one page** (a button/tab called "Admin"): it is hidden for visitors and shown at `/tools/<tool-name>/admin`, exactly like the pasted-HTML tools already behave.
- The ZIP panel shows what was found ("Admin panel found: ...", with the address) or "No admin panel found". If the ZIP has only admin-named pages, nothing is hidden (otherwise the tool would be empty).
- Pages inside a ZIP tool get a memory-only `localStorage`/`sessionStorage` (the sandbox blocks the real ones, which used to crash some tools) and `window.toolStore.load()` / `.save(data)`: data saved through `toolStore` is stored by the site and can be written only from the `/admin` address while you are signed in; visitors can read it.
- Old ZIP uploads keep working. To get the admin split for an existing tool, upload its ZIP again (Replace ZIP).

Files changed: `app.html`, `netlify/functions/page.mjs`, `netlify/functions/tool-zip.mjs`. Nothing new to configure.

## Update: save bar only in admin, Documents page Edit + Word-style editor

### 1. "All changes are saved and published · Save all" bar
It is now drawn **only inside the admin panel** (`/admin`). When an admin is signed in and browses the public pages (Home, Newsflash, Documents ...) the bar is no longer shown. Saving itself is unchanged: auto-save keeps running in the background and **Save all** works as before in the admin panel.

### 2. Documents page: Edit
- Every document has a new **Edit** button (public Documents page, the Preview window, and Admin > Documents). It opens `/doc-editor.html?doc=<id>` in a **new window**.
- **Editor (new file `doc-editor.html`)**: Word-style ribbon (Home / Insert / Page Layout / View). Fonts, size, bold/italic/underline/strike, sub/superscript, text and highlight colour, clear formatting, bullets, numbering, indents, alignment (incl. RTL for Urdu), line spacing, heading styles, tables (add/delete rows and columns), pictures, links, horizontal line, page breaks.
- **Shortcuts**: Ctrl+B / I / U, Ctrl+Z / Y (and Ctrl+Shift+Z), Ctrl+S, Ctrl+P, Ctrl+K (link), Ctrl+L / E / R / J (alignment), Ctrl+Enter (page break), Ctrl+Shift+> / < (font size), Tab / Shift+Tab (lists and table cells).
- **Page Layout**: orientation, page size (A3, A4, A5, A6, B4, B5, Letter, Legal, Tabloid, Executive, Statement, Folio, Custom), margins (presets or custom top/bottom/left/right in in/cm/mm). The page on screen is a live preview at true size, with dashed lines where each printed page ends.
- **Saving**: edits save automatically about 1.5 s after you stop typing, and with the **Save** button or Ctrl+S. The status pill in the title bar always says what happened: *Saving…*, *All changes saved to the document · time*, *Saved on this device only*, or the exact error (with automatic retry). A copy is also kept on the device, so nothing is lost if the connection drops.
- **Who can change the website copy**: only a signed-in admin (Edit pressed from the site while signed in). Visitors can open Edit too, but their changes are saved only in their own browser; they never change the website's document. 
- **Original file**: the uploaded file is kept. **File > Restore the original document** goes back to it. Preview and Download show the edited version once one exists (Download gives an edited `.doc` that opens in Word); Download original stays available.
- **What gets converted**: text/TXT and sample documents (exact), DOCX (via mammoth.js), PDF with selectable text (via pdf.js; layout is approximate), pictures. Old binary `.doc` files cannot be opened in a browser: save them as `.docx` in Word and upload again. The converters load from cdnjs/jsDelivr, so the editor needs internet the first time a DOCX/PDF is opened.
- **Print**: opens the browser's own print dialog. Only the document is printed (no menus, ribbon or buttons), using the page size, orientation, margins, formatting and page breaks chosen in the editor (`@page` rules are rewritten right before printing). In the print dialog keep "Margins: Default" and, if you do not want the date/URL line, untick "Headers and footers".

Files changed: `app.html`, `doc-editor.html` (new), `netlify.toml`, `netlify/functions/page.mjs`.

## Update: new windows, hero video, box admin panels, optimiser, speed settings

Files changed: `app.html`, `netlify/functions/media.mjs`, `page.mjs`, `site-data.mjs`. Nothing new to configure; deploy as usual.

1. **New window:** Newsflash cards (home, Newsflash list, related articles), menu/More/footer page links and the cookie-banner policy link now open in a new tab. They are real links, so Ctrl/middle-click also work.
2. **Hero video:** Admin > Hero slider > *Upload banner video* (MP4/WebM, up to 60 MB, also by drop). Stored in the media library in 3 MB parts and streamed with Range support. The first frame becomes the poster. A video slide stays until the video ends (max 30 s). Phones, Data Saver and reduced-motion show the poster only (changeable in speed settings). Optional "Compress before uploading" box.
3. **Box admin panels:** new admin section lists every HTML box automatically (new boxes too) and shows its admin panel (ZIP `admin.html` / `admin/` folder, or a page with an Admin tab) inside the main admin, with the same sign-in, plus "Open in a new tab". HTML tool boxes also has an "Open this box's admin panel" button.
4. **Optimise & speed:** one-click optimise for photos (resize + WebP), videos (browser re-encode, Chrome/Edge, no sound), pictures embedded in page content, and deleting unused files (only files older than 10 minutes, only when published). Replaced links are updated and published automatically; originals stay until you delete them.
5. **Speed settings:** lazy loading, hero preload, image size/quality/format, video width/bitrate/preload, page cache seconds (Netlify CDN), embed data, preconnect, system fonts, delay AdSense (leave OFF while applying for AdSense). Saved with the site (`perf`).

Not tested on real Netlify (tested locally in Chromium with a Blobs stand-in). Video compression time equals the clip length.

## Update: hero links, 1200 x 600 pictures, article galleries, Video library

**Hero slider (Admin > Hero slider)**
- Every slide has **When a visitor clicks this picture**: open a page that shows the picture (default, at `/featured/<address>`), open any page / article / video / tool of the site, open a web address (link), or do nothing. The link is built into the picture itself (and works with swipe: a swipe never opens the link).
- The picture page shows the picture, headline, subline and the optional text typed under the slide. It opens in a new tab, like Newsflash articles.
- Uploads are cut to exactly **1200 x 600 px** (2:1) in the browser, stored in the Photo library (not inside the site content) and the slider is now shown at 2:1 on desktop and phone. **Crop focus** (Centre / Top / Bottom) decides which part of a tall photo is kept. A note appears if a photo was trimmed or is smaller than 1200 x 600. **Replace picture** on each slide swaps the photo and keeps the link.

**Newsflash articles**
- Article pictures are 1200 x 600 as well and you can upload **one or more**. The first is the cover (top of the article and the card); the rest appear in a gallery under the text and enlarge on click. Use Make cover, the arrows and x to arrange them. Pictures are stored in the Photo library, so many photos do not fill the 4.5 MB content limit.

**Video library (Admin > Video library, public page `/videos`)**
- Upload the official video to YouTube only, paste the link (youtu.be/..., youtube.com/watch?v=..., /shorts/...). The site shows a card with the YouTube thumbnail; clicking it opens `/videos/<address>` with the video playing inside the website (youtube-nocookie player). Nothing heavy is stored on the site.
- Title, address, date, description, Published, reorder. A **Videos** menu link is added once to existing sites (remove it from Site customizer if you do not want it); visitors do not see the link until a video is published.
- SEO: `/videos` and each video page get their own title, description, canonical link, sitemap entry and VideoObject schema (when a date is entered).

Files changed: `app.html`, `netlify/functions/page.mjs` (routes, head tags, sitemap), `netlify/functions/site-data.mjs` (publish log labels only). Deploy as usual.

## Update: Image gallery, HTML box "Update from HTML file", videos from every platform

Files changed: `app.html`, `netlify/functions/page.mjs`, `netlify/functions/site-data.mjs`. New file: `netlify/lib/video.mjs`. Nothing to configure; deploy as usual.

### 1. Image gallery (public page `/gallery` + Admin > Image gallery)
- **Admin > Image gallery:** *Upload photos* (several at once, or paste / drop them). Each photo has Title, Caption, Category / album, Alt text, a Published tick box, move left / right and Delete. *Publish all* / *Hide all* act on every photo.
- Photos are resized to the longest side set in Speed settings (default 1600 px), keep their own shape (no cropping) and are saved in the Photo library, so they do not use the 4.5 MB site-content limit. GIFs are uploaded unchanged so they keep moving.
- **Public `/gallery`:** responsive grid, optional category filter buttons (shown when at least one photo has a category), click to enlarge with Previous / Next (buttons, arrow keys, phone swipe), Esc to close. The home page shows a strip of the first 4 published photos.
- A **Gallery** menu link is added once to existing sites (remove it in Site customizer if you do not want it). Visitors do not see the link until a photo is published.
- SEO: `/gallery` has its own title, description, canonical link, sitemap entry and ImageGallery schema.
- Deleting a photo from the gallery keeps the file in the Photo library until you delete it there (or use Optimise & speed > delete unused files).

### 2. HTML tool boxes: Update from HTML file
Admin > HTML tool boxes has a new **Update this box from an existing HTML file** row:
- **Update from HTML file:** pick the newer `.html` file. A review panel shows old vs new size, how many lines are new / changed / removed, and warns if the file does not look like HTML. Nothing changes until you press **Apply update**; Cancel discards it.
- **Copy from another box:** choose another box and press Review to reuse its HTML in this one (same review step).
- **Undo last update** puts the previous code back (available until you leave the box list or add / delete / reset a box).
- Heading, disclaimer and web address of the box are never touched. Limit 500 KB per file (use *Upload ZIP File* for bigger tools).
- If the box runs an uploaded ZIP, the panel says that applying replaces the ZIP (that cannot be undone).

### 3. Video library: YouTube, Facebook, Instagram, TikTok, Vimeo, X, Dailymotion, Twitch, .mp4
- Paste the video link (or the platform's embed code) in Admin > Video library. The admin shows which platform it found, with a **Show player preview** button.
- Facebook: single public videos, reels, `facebook.com/watch/?v=`, `fb.watch`. Instagram: public posts / reels (`/p/`, `/reel/`, `/tv/`). TikTok: full links with `/video/<number>` (short `vm.tiktok.com` links cannot be embedded; the admin says so). Vimeo, X posts, Dailymotion, Twitch videos / clips, and direct https `.mp4 .webm .ogv .mov .m4v` files also work.
- **Cover picture (optional):** YouTube and Dailymotion get one automatically. For the other platforms upload your own, otherwise the card shows a plain coloured tile with the platform name.
- **Player shape:** Automatic (portrait for Instagram, TikTok, X and reels) or force Landscape / Portrait.
- The watch page names the platform ("Official video on Facebook") and links to the original. Existing YouTube videos keep working unchanged.
- Only public posts can embed. Facebook / Instagram / TikTok / X set their own cookies when their player loads, so keep the cookie banner and Privacy Policy as they are.
- Not tested against the live platforms (no internet in the test environment): the embed addresses follow each platform's documented embed format. Please open one video from each platform you plan to use after deploy.

## Security fix: only `public/` is published
- `netlify.toml` now has `publish = "public"`. Only `app.html`, `doc-editor.html`, `logo.png` and `_redirects` are served. Server code (`netlify/`), `package.json`, `docs/` are no longer reachable by URL.
- The hardcoded owner-login reset (`RESET_REC`) was removed from `netlify/lib/auth.mjs`. The stored login in Netlify Blobs is unchanged. Set `ADMIN_USERNAME` / `ADMIN_PASSWORD` in Netlify only if the site has no stored login yet.
- Deploy the whole folder (keep the `public/` structure). Do not put files back in the root.

## Security fix 3: passwords are hashed on the server
- The browser now sends the username and password over HTTPS (`pass`, `newPass`, `currentPass`). The server builds the credential itself, so no replayable hash is sent or accepted from the browser (the old `cred` / `newCred` / `current` fields are rejected).
- Stored logins are unchanged (same PBKDF2 record), so everyone keeps their current password. No migration.
- Minimum password length is now 10 for everyone and is enforced on the server too (the owner form previously allowed 8).
- Team usernames are matched case-insensitively at sign-in.

## Security fix 4: team editors cannot plant script that runs for the owner
- **Server rules for editors** (`site-data.mjs`, not applied to the owner): links and file addresses must be normal web or data addresses. `javascript:`, `vbscript:`, `data:text/html` and SVG data are rejected, document files must be plain base64 data (not HTML/SVG/XML), picture addresses must be `/media/...`, `https://...` or a data image. A save that breaks a rule is refused with a message.
- **Browser fixes** (`app.html`): the article "Source" link, the admin slide thumbnail, and the Documents preview (image and PDF) no longer trust the stored address. A PDF preview is always opened as `application/pdf`, so a stored file can never become a web page. Downloads only accept `data:`/`blob:` files.
- The article source link in search-engine data (`isBasedOn`) is only written for real web addresses.
- The Activity log is now owner-only.
- Still true by design: an editor can edit page text, tool boxes and links, so give the editor role only to people you trust. Tool boxes run in a sandbox and cannot read the admin session, but a tool box could show a fake "sign in" form, so only sign in on `/admin`.

## Content & AdSense readiness (step 5)
- Search results no longer show "Last updated: [date]" as the snippet of the Privacy / Terms / Cookie pages (`page.mjs`).
- Admin > Site check has 3 new checks: leftover sample wording in pages (sample text, `maskan.example`, `0000000`, "this preview uses..."), articles without a date, and near-duplicate article titles.
- Content that only the site owner can supply (real contact details, real About text, real photos, original 300+ word articles) is NOT invented by the code. The Site check lists what is still missing.

## Hardening (step 6)
- Public pages are now sent with `X-Frame-Options: SAMEORIGIN` and a small Content-Security-Policy (`frame-ancestors 'self'; base-uri 'self'; object-src 'none'`), so other websites cannot put your pages in a frame, and a stray `<base>` tag cannot redirect links. These are set in `page.mjs` because `netlify.toml` headers do not reliably apply to function responses. `/admin` keeps `DENY`.
- Not changed on purpose:
  - `/api/tool-data` can be READ by anyone: this is how a ZIP tool shows its saved data to visitors. Never store passwords, personal data or private notes through `toolStore`.
  - The CSP for ZIP tools (`tool-zip.mjs`) still allows `unsafe-eval` and `https:` connections, because many ready-made tools (Tailwind CDN, charts) need them. The tools run in a sandbox with no access to your admin session, so the risk is limited to what the tool itself shows or sends.
- Layout reminder: only `public/` is published. Do not move files back to the folder root.
