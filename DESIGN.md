# Mission Control — ground-up redesign, final design

Status: approved design, ready to build. Supersedes REDESIGN-BRIEF.md as the build spec.
Date: 2026-08-23. Repo: `~/Dashboard/mission-control` (origin: jakemauldin/rising-creek-dashboard).
Branch: `redesign/ground-up`, commits per unit, 8-commit history preserved.

This document is the fusion of three panel proposals. Where they disagreed, section 11 records
which one lost and why. Facts below were verified against the running system on 2026-08-23,
not taken from the proposals.

## 0. Corrections to the panel inputs

Four things every proposal got wrong or missed. Build from these, not from the proposals.

1. `photo-gallery.py` already exposes write routes (`/toss`, `/keep`, `/record`, `/tag`,
   `/untag`, `/undo`, `/collect`, `/uncollect`, `/mark-posted`, `/derive`, `/pick-order`).
   Nothing new is written on the Python side. Mission Control proxies these server-to-server.
2. `rc-brand-config.json` exists at `~/services/tread-connection/rc-brand-config.json`. It is
   the light website palette (`#635500` olive on white). It is not a dark-mode palette and
   `#635500` scores 2.57:1 on the dashboard card background, which fails contrast. A derived
   dark ramp is required (section 8).
3. Tailwind v4 is a real, wired dependency (`@tailwindcss/vite` in `vite.config.js`,
   `@import "tailwindcss"` in `src/index.css`). "Strip the stray Tailwind" was wrong. The
   inconsistency is real, the fix is one token source, not deleting a working build plugin.
4. `photo-gallery.py` is NOT launched by `start.sh`. The live :3251 process was started ad hoc
   in a session on 2026-08-16 and will not survive a reboot. Any design that embeds or proxies
   it must fix that first. No proposal caught this.

## 1. Information architecture

One React SPA, `react-router`, served as a static build by the same Node process that serves
the API. The flat `view === "x"` switch in `App.jsx` is deleted, and with it the 600ms
`setInterval` agent simulation that was welded to it.

| Route | Content |
|---|---|
| `/` | Brief (home) |
| `/jobs` | JobTread job list |
| `/jobs/:id` | Job detail: JT overview, RFI counts, pay-app state, "Share with client" |
| `/money` | redirect to `/money/pay-apps` |
| `/money/pay-apps` | pay-app list by job |
| `/money/pay-apps/:jobId/:appNum` | existing 784-line G702/G703 builder, internals untouched |
| `/money/bills` | OpenBills / AP |
| `/rfis` | RFI index across jobs |
| `/rfis/:jobId` | RFI live log for one job |
| `/media` | Media workspace |
| `/media/generate` | generation dispatch queue |
| `/media/cad` | CAD-grounded generation, feature-flagged off |
| `/systems` | Systems outcomes |
| `/projects` | Projects (Jake's per-project to-do, stays standalone) |
| `/land` | LandFinder (overflow nav) |
| `/login` | passphrase door |

Primary nav is five items, a left rail on desktop and a bottom tab bar on phone:
**Brief, Money, Media, RFIs, Jobs**. Systems is not a nav item; the header status dot IS the
Systems entry point and turns red when Systems is red, which is one tap and also the only
time Jake needs it. Projects and Land live in a header overflow menu. Everything else is a
drill-down, never a nav item.

The client view is not a route in this app. It is a separate deployed surface with its own
process, its own domain, and its own auth (section 5).

## 2. Brief (home)

One screen, no scrolling on a phone, at most 7 rows in the queue. Sections top to bottom.

**Header strip.** Date, one status dot from the latest `health-<date>.log` STATUS line
(links to `/systems`), tailnet indicator.

**Action queue.** The product. Each row is icon, one-line title, age, and one primary button
that deep-links to the exact item (`/rfis/119#item-A7`, `/money/pay-apps/119/3`). No secondary
actions on a row.

Ranking is **tier first, then oldest first inside a tier**. Never a blended score. A two-day-old
backup failure must always outrank a twenty-minute-old media item, and a single numeric score
cannot guarantee that.

| Tier | Source | Condition |
|---|---|---|
| 1 Systems red | `/api/systems/outcomes` | disk >=95%, any expected artifact stale or 0 bytes, OOM events in 24h, container down |
| 2 Blocking RFIs | every job's `rfi.json`, `status: blocking` | unresolved, any age (no staleness threshold) |
| 3 Money needing a decision | billing store + `/api/ap/pending-bills` | pay app in draft/awaiting-finalize, bill due <=3 days |
| 4 Before-submittal RFIs | `rfi.json` | non-blocking, time-sensitive |
| 5 Media awaiting grade | catalogue entries with NO bucket decision (`_catalogue.json` minus approved/postable/trash/records/personal — 1,774 at design time) | one batched row, never one row per photo |
| 6 Project drift | `projects.json` | todo flagged urgent, or `lastTouched` > 5 days on an active project |

Top 6 render. The rest collapse into "+N more" which links to `/?all=1`, the same component
unfiltered. No new page.

**Snooze, not decay.** Each row has a swipe/right-click snooze (today, 3 days, until a date)
written to `server/data/brief-state.json` keyed `source:id`. Nothing auto-sinks from being
ignored. A snoozed tier-1 or tier-2 item reappears with a "snoozed 3x" marker rather than
sinking further. Rationale in section 11, item 1.

**Overnight digest.** Two to three lines, sourced from The Claw's `brief-<date>.md`. That file
is frequently not written yet at morning check-in (verified: today's did not exist at 06:59),
so the loader falls back to the most recent prior day's file and labels it with its date. If
neither exists, the section is omitted entirely. The queue never depends on this file.

**Quick links row.** Five workspace icons with numeric badges (open blocking RFIs, pending
pay apps, bills due, ungraded photos).

**Endpoint.** `GET /api/brief` does the whole merge server-side and returns one payload.
In-process memo, 60s TTL, plus a 5-minute cache on the AP proxy hop since that is the only
network call. If AP is unreachable the tier renders with a "bills unavailable" chip rather
than failing the request. No cron, no precomputed file (a cron requires Jake's explicit
authorization per AGENTS.md; an in-process cache does not).

**Live.** The existing `/ws` broadcast is extended with topic tags. The Brief subscribes to
`brief:queue` and `systems:status` and re-renders in place. No SSE, no second live channel.

## 3. Media workspace

31k files and 58 GB on `/mnt/rc_media`. Nothing here walks the tree. All reads are the small
`_*.json` state files and the existing `_thumbs/*_340.jpg` (11,456 present).

**Phase 1: embed, do not rebuild.** `photo-gallery.py` on :3251 is already a dashboard-grade
grade/pick/pile UI with 5 piles, tag chips, and full undo via `_prev.json`. `/media` renders it
in an iframe (tailnet to tailnet, no funnel, no X-Frame-Options set so it embeds cleanly) plus
a native summary strip above it: counts of unsorted / doubtful / approved (360) / postable
(4,308) / trash, read from the `_*.json` files with an mtime-keyed memo.

Prerequisite, phase 1: write `~/services/scripts/start-photo-gallery.sh` and wire it into
`start.sh`. The live :3251 process is an orphaned ad hoc process that dies at the next reboot.
The Media workspace cannot depend on it until that is fixed.

**Phase 3: native contact-sheet grid.** Replaces the iframe only once the embed proves
insufficient. Keyboard map: `j/k` and arrows move selection, `1-5` bucket into a pile, `x`
multi-select, `t` tag editor, `/` filter by tag, `g` open the generation panel on the selection.
Writes go through `POST /api/media/proxy/*`, a thin server-side proxy to the gallery's existing
POST routes. One writer (`photo-gallery.py`), two readers. Mission Control never touches
`_approved.json`, `_postable.json`, `_tags.json`, `_records.json`, `_personal.json`, or
`_trash.json` directly. Ever.

**Generation dispatch (Fable-prompted, per the addendum).** The UI never authors a prompt and
never calls Higgsfield. Selecting refs and hitting `g` opens a form collecting intent only:
output type (social ad / showcase reel / daily graphic / still), reference images (auto-filled
from selection), aspect ratio, job context. Submit writes
`server/data/media-gen-queue/<id>.json` as `{intent, refs, jobContext, status:"awaiting-prompt"}`
and shows a copy-to-clipboard structured brief for Jake's own session. Fable composes the prompt
and dispatches through the existing pipelines (`media-studio/`, `build-showcase.sh`, `higgs`
CLI via `docker exec` with the `$HOME/.npm-global` prefix). Mission Control only polls the queue
file for status (awaiting-prompt / queued / running / done / failed). There is no synchronous
generation path in the API. Any shell-out uses `execFile` async with the cache pattern in
`server/lib/docker.js`. Never `execSync`.

**CAD-grounded generation.** `/media/cad`, behind `config.cadRenders = false`, labeled
experimental in the UI. Lists jobs with `tools/cad` geometry available (proven on Doreen St
only), lets Jake pick a sheet and viewpoint, and packages that into the same intent handoff
above. It is a variant of the generation flow, not a new pipeline. Phase 4, unlocked only when
CAD extraction is proven on a second job.

## 4. RFI workspace

Job 119 (Thomas Hearth) is the only job with the treatment today: 36 items, 9 blocking, 16
before-submittal, 3 cleanup, 8 closed, revised 8/22. Design for N, ship for 1.

`/rfis` lists every job with an `rfi.json` as a card (blocking / before-submittal / minor
counts, last revised) plus a row per other active JT job reading "no RFI log yet", so the index
does not look broken with one entry.

`/rfis/:jobId` reads `rfi.json` directly, never the rendered markdown. Groups A/S/C/V render as
filterable columns with the existing `sv()` status colors (blocking red, before_submittal amber,
minor slate, resolved green). Item detail shows concern / our-read / ask plus the images from
`rfi-snips/`. Client-facing `RFI-LOG.md` is the shape shown; `RFI-LOG-INTERNAL.md` is never
loaded by this app and never reachable from the portal.

**Writes, phase 2, deliberately narrow.** `PATCH /api/rfis/:jobId/items/:itemId` accepts exactly
two fields, `status` and `note`, and rewrites `rfi.json` with the same tmp+rename atomic pattern
`server/lib/projects.js` already uses. Keyboard `1-4` sets status on the focused item. A
draft-assist button templates a response from the item's concern/ask for Jake to edit and commit
explicitly; it never auto-writes. No shadow store, no second copy of RFI truth.

Regenerating `RFI-LOG.md` from `rfi.json` after a status change is out of scope for the
dashboard. Whatever script renders that markdown today keeps owning it.

**Live.** `chokidar` watches each active job's `rfi.json`. A change from any source (Jake's
editor, the voice-dump `rfi-proposals.jsonl` merge) pushes `rfi:<jobId>` over `/ws` and the open
workspace updates without a reload.

## 5. Client view

**Exposure: magic-link tokens over nginx + Let's Encrypt on this VPS. Not OAuth.**

The OAuth 2.1 dynamic-client-registration pattern on `openclaw.risingcreek.ai` exists so
claude.ai can self-register as an MCP client. A commercial client opening job photos on a phone
is one human clicking one link. JobTread's own customer portal solved this exact problem with a
magic link, and the web droplet already runs a tracked-link service on the same idea, so this is
a pattern Jake and his clients already use. No client accounts, no passwords.

`client.risingcreek.ai` A-records to 129.212.176.114 (this VPS, the same nginx that terminates
`openclaw.risingcreek.ai`). Its vhost proxies to `127.0.0.1:3081`. It must bind `0.0.0.0:443`
and proxy to a loopback target, never to the tailnet IP, because a vhost binding
`100.92.25.23` is what took all of nginx down for 14 hours on 2026-07-06.

**Process isolation.** The portal is a separate small Node process (`server/portal/index.js`,
port 3081), not a router inside the internal app. That process has no JobTread grant key, no
docker socket access, no billing directory, and no route table in common with `/api/*`. A
misconfigured internal route cannot become publicly reachable because the internal process is
not in the public path at all.

**Data separation is structural, not filtered.** The portal serves exactly one data endpoint,
`GET /portal/api/snapshot`, and it takes **no id argument**. The job id is derived server-side
from the verified token on every request. There is no code path in the portal that accepts a
caller-supplied job id, so there is no IDOR to make.

The snapshot is a precomputed projection at `server/data/client-snapshots/<jobId>/snapshot.json`
plus a sibling `photos/` directory of physically copied, resized images. It is generated by
`scripts/build-client-snapshot.mjs <jobId>`, invoked by the internal app when Jake clicks
"Share with client" or "Refresh". The portal process only reads. It never spawns work, never
calls JobTread, and never reads `/mnt/rc_media`.

Projection contents: job name, address, plain-English milestones and dates, progress state,
`postable`/`approved` photos matched to that job via `_job-match.json`, and — per Jake 2026-08-23 —
the CLIENT-FACING RFI view for that one job (the `RFI-LOG.md` shape, never internal), with **no
job chooser**: the admin `/rfis` keeps the picker, the portal is scoped to the token's job by
construction. Pay-app status: RESOLVED — photos+schedule only, no money chip. Excluded by construction, not by filter:
cost lines, vendor names, margin, SOV detail, `RFI-LOG-INTERNAL.md`, any other job, any systems
data. Those fields are never written into the file, so there is nothing to over-expose.

**Token.** `base64url(jti.jobId.exp.HMAC-SHA256(jti|jobId|exp, key))`, key from BWS
(`mission-control/portal-hmac`). First hit on `/j/:token` verifies and sets a short-lived signed
HttpOnly cookie scoped to that job so the token is not repeated in every URL. Default expiry 30
days. Revocation is a `jti` in `server/data/portal-revoked.json`, checked per request, with a
"Revoke link" button on `/jobs/:id`.

**Design bar.** Light theme using the real website palette (`#635500` on white, Poppins and
Open Sans from `rc-brand-config.json`), so it looks like Rising Creek and not like an internal
tool. Single job, big curated photo grid, milestone progress, one status chip, an "as of <date>"
stamp. No navigation to anything else. It is a dead-end page by design, which is also its
security property.

## 6. Systems page

Outcomes, not liveness. The page answers "did the thing that was supposed to happen actually
land", not "is the container up".

The page is driven by a declarative expectations file, `server/data/system-expectations.json`,
where each entry is `{name, artifactPath, maxAgeHours, minBytes, owner}`. Adding a new monitored
job is a JSON line, not code. This replaces the broken `/api/crons`, which reads
`/home/node/.openclaw/cron/jobs.json`, a path that no longer exists (only `.migrated` and `.bak*`
remain). Cron outcomes are derived from artifacts, not from the scheduler's own list, which is
the whole point of outcomes-over-liveness.

| Card | Check | Source |
|---|---|---|
| Backups (4) | last "complete" line, age <= 26h, size > 0 | `/var/log/openclaw-backup.log`, `logs/services-backup.log`, `logs/media-mirror.log`, `logs/tc-backup.log` |
| tc-backup | flagged RED today, 0 bytes at 00:00 | same |
| Disk | `/` and `/mnt/rc_media`, both reported explicitly | health-check snapshot |
| Disk snapshot lag | health log is a 01:00 snapshot and can lag live `df` by a day of changes (93% vs 55% on 8/23 after the cleanup). Show live `df` as primary with the health snapshot's timestamp beside it | live `df` + health log |
| Containers | up + last restart, via the async `execFile` + 20s cache helper | `server/lib/docker.js` |
| Cron outcomes | per-entry artifact freshness from the expectations file | file mtimes and sizes |
| Kernel | OOM events in 24h (3 today, chrome) | health log |
| Agent spend | daily token/cost total when the intel brief exists, omitted when it does not | `brief-<date>.md` |

Nothing on this page is fabricated when a source is missing. Missing means the card says
missing, in the same grey-dot / "No data" pattern the live views already use.

## 7. Serving and auth

**One internal process.** `npm run build` produces `dist/`, and `node server/api.js` serves
`dist/` as static plus `/api/*` plus `/ws` on :3080. The `:5173` Vite dev server is removed from
production entirely, and `start.sh`'s dashboard block collapses to one process on one port,
which also removes the orphaned-listener workaround. Vite stays for local development only.

**Internal auth.** Single passphrase from BWS (`mission-control/passphrase`,
`mission-control/session-secret`), checked at `POST /api/login`, issuing a signed HttpOnly
session cookie. `requireAuth` middleware wraps every `/api/*` route and the `/ws` upgrade. The
only exceptions are `/api/login` and a minimal `/api/health/probe` that returns a status word and
no file contents. A full IdP for one known user is overkill; the gap being closed is that
anything on Jake's LAN or any other tailnet peer can currently read job costs, read the workspace
files, and dispatch commands to The Claw on :3080 with no credential at all.

`cors()` loses its open configuration; same-origin only now that one process serves both halves.

**`/api/claw/dispatch` gets fixed in the same pass as auth.** Its sanitizer is a denylist of
characters, which blocks shell metacharacters but not `openclaw config set ...`. It becomes an
explicit allowlist of permitted subcommands. Auth controls who calls it; the allowlist controls
what it can do. Both are needed, and this rides along free with the middleware work.

**Client auth** is the stateless HMAC token in section 5, in a different process, sharing no
code with internal auth. Two auth systems on purpose, so a bug in one cannot cross into the
other.

**Also fixed while in these files:** unguarded `parseInt(req.params.num)` in four billing routes
(NaN currently falls straight through to the lib layer), and an iteration cap on the
`while (nextPage)` cost-items loop in `server/lib/jobtread.js`.

## 8. Tech choices, with why

- **Keep Vite + React 19.** Working, fast, and eight genuinely live views sit on it. Rewriting
  the framework buys nothing the brief asked for.
- **Add `react-router`.** The flat `view` string is why URLs, deep links, and the browser back
  button do not work. Deep-linkable workspace URLs are a hard requirement for Brief rows and for
  Telegram messages that link into a job. This is the one framework addition that pays for
  itself immediately.
- **Keep the `C` / `sv()` / `badge()` token system, and keep Tailwind v4.** Both are already
  installed and working. One source of truth for tokens: `src/lib/brand.css` defines CSS
  variables generated from `rc-brand-config.json` in a Tailwind v4 `@theme` block, and
  `colors.js` becomes a thin JS mirror reading the same variables. New code uses Tailwind
  utilities. Existing live views keep their inline styles and are migrated only when touched for
  another reason. No big-bang restyle.
- **Brand ramp.** `#635500` is the anchor and scores 7.42:1 on white, so the client portal uses
  it directly. On the dark dashboard it scores 2.57:1 and fails, so the dark surfaces use a
  derived olive-gold ramp: `#8A7A12` (4.42:1, borders and large text only), `#A8952B` (6.35:1,
  default accent), `#C2AC3D` (8.4:1, links and emphasis), `#D6C255` (10.6:1, hover and focus
  ring). The current `#E8722A` orange is not a Rising Creek color and is retired. Charts follow
  the dataviz skill conventions in both themes.
- **No component library.** Confirmed working at this scale with two primitives (`Section`,
  `Row`). Adding MUI/Chakra/shadcn is the kitchen sink the brief rejects.
- **No state library, and no react-query in phase 1 or 2.** The existing `useApi` polling hook
  has abort-on-refetch and an honest `live`/`fallback` contract that views already respect.
  Revisit react-query only if the phase-3 native media grid's optimistic mutations get painful.
- **`chokidar`** for file watching (`rfi.json`, brief inputs). Cheap, avoids polling loops on a
  4-core box.
- **`/ws` extended with topic tags** (`brief:queue`, `rfi:<jobId>`, `systems:status`) rather than
  adding SSE. The hub already exists with reconnect, backoff, an idle guard, and a hash-diff
  before broadcast.
- **No new database.** Every workspace reads files its owning pipeline already writes. The only
  new server-owned state is `brief-state.json` (snooze), `media-gen-queue/`, `portal-revoked.json`,
  and the client snapshots, all of which are the dashboard's own UI state or its own projections,
  with no other owner. That is not a second store of anyone else's truth.

## 9. Migration order for the 16 existing views

**Delete outright (phase 1).** `CashFlow`, `Compliance`, `Inbox`, `Weather` (four dead files,
never routed, all seed-data). `SitePlan`, `Crew`, `Roadmap` (decorative shells with fake data
sitting next to real panels, which risks Jake reading mock as signal; Roadmap's real content
already lives properly in `TODO.md` and `IN-FLIGHT.md`). Orphaned `DecisionQueue.jsx` and
`AlertRibbon.jsx`. The flat view-state router and the agent simulation. `lib/seed-data.js` once
nothing imports it. Keep `Icons.jsx` if it is only icon definitions.

**Keep the file, unwire the mock.** `CommandBar.jsx` keeps its shell with the seed-data imports
removed, and gets wired to real actions as the `Cmd+K` palette in phase 3. Deleting it now and
rebuilding it later is churn.

**Keep, remount, wrap in routing and auth, zero logic changes.** `Jobs` to `/jobs`. `Billing` to
`/money/pay-apps` (784 lines of G702/G703, the highest-value carryover; touch routing and auth
only, never internals). `OpenBills` to `/money/bills`. `Projects` stays standalone at
`/projects` and is NOT folded into `/jobs/:id`, because `projects.json` holds AI-OS work streams
that do not map to JobTread jobs. `LandFinder` to `/land` in the overflow menu, keeping its
existing MOCK badge behavior.

**Fold, drop as nav items.** `Costs` and `Intelligence` become the Brief's overnight digest.
`Expertise` becomes a reference flyout off Systems. Their endpoints stay; only the tabs go away.

**Rebuild.** `Systems` to the outcomes model in section 6.

**Keep running unmodified, do not rebuild.** `photo-gallery.py` :3251 and `photo-drop` :3250.
Nothing about them breaks on day one.

**Build new.** Brief, Media workspace, RFI workspace, client portal, auth, brand tokens.

## 10. Phased build plan

### Phase 1, one session, ship gate

Items 1 through 6 are the gate. If the session runs long, 7 through 9 move to the next one, and
that is the intended cut line rather than a failure.

1. Branch `redesign/ground-up`. Single-process build and serve; `start.sh` dashboard block
   rewritten to one process on :3080; `:5173` gone from production.
2. Session auth on every `/api/*` route and the `/ws` upgrade; `/login` page; passphrase and
   session secret from BWS; `cors()` closed.
3. `/api/claw/dispatch` subcommand allowlist. Billing `parseInt` NaN guards. JobTread pagination
   cap.
4. `react-router` shell with the section 1 routes; existing live views remounted unchanged;
   the seven dead and decorative views and two orphaned components deleted.
5. Brief v1: `GET /api/brief` with the tier-first ranking, sourced from health outcomes, the
   billing store, `/api/ap/pending-bills`, `projects.json`, and job 119's `rfi.json`. Snooze
   store included. Digest with the prior-day fallback.
6. `start-photo-gallery.sh` written and wired into `start.sh`, so :3251 survives a reboot.
7. Systems rebuilt to the outcomes table, `system-expectations.json` created, `/api/crons`
   retired.
8. `brand.css` generated from `rc-brand-config.json` with the dark ramp; header, nav, and Brief
   restyled to it; orange retired from new surfaces.
9. `/media` with the gallery iframe and the counts strip; `/rfis` and `/rfis/:jobId` read-only.

Update `INFRASTRUCTURE.md` (port and process change), `IN-FLIGHT.md`, and this file in the same
session. Commit per unit.

### Phase 2

RFI `PATCH` status and note with keyboard status changes and draft-assist. `chokidar` watchers
and `/ws` topic tags. Media generation dispatch: intent form, `media-gen-queue/`, status polling.
Job detail `/jobs/:id` merging JT overview, RFI counts, and pay-app state. Brief live updates
over `brief:queue`.

### Phase 3

Client portal: `client.risingcreek.ai` DNS and vhost, LE cert, the separate :3081 process,
`build-client-snapshot.mjs`, the "Share with client" and "Revoke link" buttons, the light-theme
dead-end page. Native media contact-sheet grid with the keyboard map, writing through the proxy
to the gallery's existing POST routes. `Cmd+K` command palette on real actions.

### Phase 4

CAD-grounded generation module, flag off, unlocked only when `tools/cad` is proven on a second
job. Cash view in `/money` (until then it links out to bills-tracker on :3230). Agent spend on
Systems, if a real spend log exists by then.

## 11. Contradictions resolved

1. **Brief ranking. B loses.** B's `surfaced_penalty` sinks items that have been shown without
   action. The items Jake ignores are blocking RFIs and pay apps, the expensive ones, so a decay
   function optimizes for a tidy screen at the cost of the queue's only job. A's tier-first
   ranking wins, and B's dedupe intent is preserved as an explicit snooze that Jake chooses.
   C's "blocking and open >48h" threshold also loses, because it hides a blocking item for its
   first two days, which is when acting is cheapest.
2. **Media grading UI. A loses.** A proposed building a doubtful-queue grid in phase 2. The
   gallery already does this well, so B and C's iframe embed ships in phase 1 for near-zero cost
   and the native grid moves to phase 3 where it belongs.
3. **Media writes. A loses on fact, B loses on its fallback.** A proposed adding a
   `POST /api/decide` endpoint to `photo-gallery.py`; B proposed possibly reimplementing atomic
   writes in `server/lib/media.js`. The gallery already exposes the write routes, so Mission
   Control proxies them and neither new writer is built.
4. **RFI writes. A and C lose.** A defers indefinitely, C defers to phase 3, and both leave the
   one actively maintained working document as a read-only mirror. B's write path wins but is
   bounded by C's discipline (status plus one note field only) and moved to phase 2 rather than
   phase 1 for buildability.
5. **Client data separation. A and B lose.** Both filter a live API. C's precomputed projection
   with an id-less endpoint wins, and process isolation is added on top so the public path never
   runs code that holds the JobTread key or the docker socket.
6. **Client portal host.** A and C say "the public droplet". The nginx and Let's Encrypt setup
   for `openclaw.risingcreek.ai` runs on THIS VPS at 129.212.176.114; the web droplet at
   64.23.227.125 is a separate box serving the WordPress site. B's `client.risingcreek.ai` on
   this VPS is correct. The vhost must proxy to a loopback target, not the tailnet IP, per the
   2026-07-06 nginx boot-race outage.
7. **OAuth for the client view. All three rejected it, correctly.** Recorded here so it is not
   relitigated: dynamic client registration exists for claude.ai as an MCP client, not for a human
   opening a link.
8. **Styling. All three lose.** All three said to strip "stray Tailwind". Tailwind v4 is properly
   installed and imported. The resolution is one token source consumed by both systems, Tailwind
   for new code, no restyle of working views.
9. **`rc-brand-config.json`. C loses on fact.** It exists. It is also a light-web palette that
   fails contrast on dark surfaces, which no proposal noticed, hence the derived ramp in section 8.
10. **Projects placement. B loses.** `projects.json` holds AI-OS work streams, not JobTread jobs,
    so folding Projects into `/jobs/:id` would break Jake's daily to-do tool. C's standalone
    `/projects` wins.
11. **Brief precompute. C loses.** A cron-written brief file needs Jake's explicit authorization
    per AGENTS.md and adds a failure mode. A 60s in-process memo over KB-scale files costs nothing
    on a 4-core box.
12. **State library. B loses.** `@tanstack/react-query` is a real dependency for a mutation
    ergonomics problem that does not exist until the phase-3 native grid. Deferred, not adopted.
13. **`CommandBar`. C loses.** Delete-then-rebuild is churn. Keep the shell, unwire the mock,
    rewire in phase 3.
14. **`claw/dispatch` timing. A loses.** A scheduled the allowlist for phase 2. It is the worst
    finding in the audit and costs nothing while the auth middleware is already being written, so
    it ships in phase 1.

## 12. Open decisions — RESOLVED by Jake, 2026-08-23 morning

1. **Portal money: photos + schedule only.** `build-client-snapshot.mjs` is structurally barred
   from reading the billing store. No pay-app chip.
2. **No 6am Telegram push.** The Brief is a place Jake opens. No new cron.
3. **Clean cut.** `start.sh` switches to the one authenticated process in phase 1; `:5173` and
   the open `:3080` die the same night.
