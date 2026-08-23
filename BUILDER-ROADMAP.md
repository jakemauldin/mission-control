# BUILDER-ROADMAP.md

Social Post Builder — confirmed defects, platform capability truth, and the build order.
Verified 2026-08-23 against `src/views/PostBuilder.jsx` (619 lines), `server/lib/{posts,suggest,unfurl,gen}.js`, `server/api.js` routes 415-462, `DESIGN.md` §3.

## 1. Confirmed bugs

Ranked by what actually damages a post Jake sends.

| # | Where | Defect | One-line fix |
|---|---|---|---|
| 1 | `src/views/PostBuilder.jsx:605` | The whole per-platform photo editor is gated on shared `refs.length > 0`, but the preview renders `effRefs = refsByPlatform[tab] ?? refs` (line 447). Deselect every shared photo after forking Instagram and the fork stays in the preview and in the `queue()` payload while its editor and "reset to shared" button vanish — unreachable, un-resettable, still published. | Gate on `refs.length > 0 \|\| effRefs.length > 0`. |
| 2 | `src/views/PostBuilder.jsx:366-378` | `PhotoStrip` keeps one shared `st.current` drag record with no `pointerId`. A second touch overwrites `file`/`sx`/`sy`, so finger A's next `pointermove` places finger B's photo at finger A's position, and either finger's `up` (line 378) kills the other's drag. Photos silently reorder; first photo is the cover, so this changes what leads the post. | Key drag state by `e.pointerId` and ignore `move`/`up` whose `pointerId` isn't the active drag. |
| 3 | `src/views/PostBuilder.jsx:439, 602` | `const text = overrides[tab] ?? caption` only falls back on `undefined`. The override textarea writes `""` on full backspace, so the preview goes blank and an empty-string override is queued and stored, indistinguishable from a deliberate blank caption. | Use `overrides[tab] || caption` and delete the key when the field is emptied. |
| 4 | `src/views/PostBuilder.jsx:486-491` | `applyIdea` resets `caption`, `refs`, `on`, `refsByPlatform` but never `overrides`. Apply a new AI idea after editing a Facebook override and Facebook queues the old override text against the new idea's photos. | Add `setOverrides({})`. |
| 5 | `server/lib/unfurl.js:100-110` | `lookup(u.hostname)` checks an IP that is then discarded; `fetch(u.href, { redirect: "follow" })` re-resolves independently and follows redirects unchecked. A pasted shortener returning `302 → http://100.x.y.z/` or `169.254.169.254` reaches the tailnet/metadata anyway. DNS rebinding works without a redirect. | `redirect: "manual"`, re-run `ipBlocked` on every `Location`, or pin the vetted IP with a custom dispatcher `lookup`. |
| 6 | `src/views/PostBuilder.jsx:493, 559` | `queue()` has no in-flight flag and the button only disables on `!caption \|\| !activePlatforms.length`; `createPost` mints a fresh random id per call with no idempotency key. A double-tap on a laggy tailnet writes two identical drafts that both feed `historyBlock()`. | `submitting` state that disables the button for the duration of the fetch. |
| 7 | `src/views/PostBuilder.jsx:541 vs 582` | Turning off the platform you're viewing (Compose chip) leaves its preview, placement picker and override box fully live and editable; only the tab pill's dashed border hints at it. Jake edits content that isn't in the post. | When `!on[tab]`, switch `tab` to an active platform or render an "excluded from this post" banner over the editor. |
| 8 | `src/views/PostBuilder.jsx:493-495`, `server/lib/posts.js:16-23` | Nothing purges `overrides[k]` / `refsByPlatform[k]` when platform `k` is turned off; both objects ship and store raw. Harmless today, wrong the day a "re-edit queued post" feature exists. | Filter both by `platforms` in `queue()` before POST. |
| 9 | `src/views/PostBuilder.jsx:437` | `placement` syncs to the new tab through a post-commit `useEffect`, so one frame renders the new platform with the old placement. FB and IG both define "Story" (lines 16, 18), so this is a visible flicker today, not just theoretical. | Derive placement from `tab` (`useMemo`) or set it in the tab click handler. |
| 10 | `server/lib/suggest.js:74-79, 96-97` | The HARD RULES (no dollar figures, no "Dirt to Done", no tilt-wall) are prompt text only, and catalogue `shows`/`scope`/`stage` interpolate unescaped. `lint()` (client, line 27) warns but only for the tab being viewed and never blocks the queue. | Regex-check returned captions server-side and drop violating ideas; strip newlines/braces from catalogue text before interpolation. |

**Rejected**

- "`listPosts`/`listGenRequests` are a performance problem" — `readdirSync` + sort over a few thousand small files is sub-millisecond; both dirs are currently empty. Unbounded growth is real but it's housekeeping, not a defect (phase C).
- "No indicator when a platform is toggled off" — the tab pill does change to dashed `+ Facebook` (line 545). The real defect is the still-live editor, which is #7.
- "Stale overrides resurrect on resume" — no resume/re-edit path exists in `Media.jsx` or the API, so this is prevention, kept as #8 at low severity.
- "Placement mismatch misrenders" — the fall-through is to the correct default (IG "Reel" → FB desktop feed = FB's own default). Flicker only, hence #9 last.

## 2. Capability matrix

`N` native in the platform's own composer · `A` available through the publish API · `N+A` both · `—` not available.

| Ability | Facebook | Instagram | GBP | X | LinkedIn | Pinterest | YouTube | Houzz |
|---|---|---|---|---|---|---|---|---|
| Scheduling | N+A | N (75d), no API | — (self-cron) | N, no API | N, no API | N (2wk), no API | N+A (`publishAt`) | — |
| Alt text | N | N | — | N+A | N+A | N+A | — (captions) | — |
| First comment | A (comment on post id) | N+A | — | A (self-reply) | A | A | — |
| Location tag | N+A (`place`) | N+A (`location_id`) | — (profile is the location) | N (spotty) | — | — | A (`recordingDetails`) | — (service area) |
| CTA button | N (Page/ads) | N (Story link sticker) | N+A (fixed 6, 1/post) | — | — (ads only) | — (ads only) | — | — |
| Post types beyond single photo | N+A (Stories API-blocked) | N+A (carousel/Reel/Story) | N+A (Update/Event/Offer/Product) | N+A (4 img, poll, thread) | N (PDF carousel), A partial | N+A (video, 2-5 carousel) | N+A (Shorts); Community posts N only | N only |
| User / product tagging | N | N+A (`user_tags`, `product_tags`) | — | N (@ in text) | N+A (mention URN) | N (catalog), A partial | — | — |
| Thread / multi-part | — | — | — | N+A | — | — | — | — |
| Board / destination target | — | — | A (per-location) | — | — | N+A (`board_id` required) | N+A (playlist) | — |
| Video / Reel upload | N+A (resumable) | N+A (public URL only) | N+A (≤75MB) | N+A (chunked) | N+A | N+A (register media_id) | N+A (resumable) | N only |
| Limit the builder must enforce | 63,206 ch | 2,200 ch; 100 posts/24h | 1,500 ch; 7-day expiry | 280 ch, t.co = 23 | 3,000 ch; 150/day | 100 title / 500 desc | 100 title / 5,000 desc; 6 uploads/day unverified | none published |
| Publish-API readiness for RCC | Blocked: app review + business verification | Blocked: same + IG Business link | Blocked: Google manual access request | Ready: pay-per-use, $0.01/post | Gated: page admin + product approval | Near: trial access now, review to scale | Near: OAuth verification to exceed 6/day | None — no write API |

## 3. Upgrade plan

### Phase A — fix what's wrong, add the fields that are free

1. Ship bugs 1-4 as one commit. They are the four that change what actually gets published.
2. Ship bugs 5-10. SSRF first (Jake pastes vendor and city links all day, and this box sits on the tailnet).
3. Per-photo alt text field on the strip. Every platform we care about except GBP and YouTube accepts it, and it is the cheapest SEO and accessibility win in the product.
4. `scheduleAt` datetime on the post, stored in the queue file. Everything downstream needs it, and FB/YT can pass it straight to the API while the rest need our own cron.
5. GBP post type (Update/Event/Offer) plus CTA button and URL. GBP is the highest-intent channel for a Springtown GC and today we model it as a plain caption, which is the wrong shape.
6. Pinterest board picker and destination link. A Pin without a `board_id` cannot be created at all, so without this the Pinterest tab is a preview that can never publish.
7. YouTube title/description split at the newline, made explicit. The caption hack is already documented in the placeholder text; make it a real field before anyone relies on it.
8. Enforce the matrix's hard limits as blocking, not warning: X 280 with t.co counted as 23, IG 2,200, GBP 1,500, Pinterest 100/500.
9. Purge overrides and photo forks for platforms toggled off, before POST. Closes the whole class that bugs 1, 7 and 8 come from.

### Phase B — publish APIs, easiest first

1. **X** — pay-per-use, no app review, chunked media upload. Smallest integration that proves the queue→publish path end to end.
2. **Pinterest v5** — trial access is immediate; needs the two-step media register/poll for video and the board targeting from A6.
3. **YouTube Data v3** — resumable upload with chunk retry, `privacyStatus: private` + `publishAt` for real scheduling. Start the OAuth branding review early; 6 uploads/day until it clears.
4. **Facebook Pages + Instagram** — one Meta app, pinned version string, Resumable Upload for video, container-poll-until-FINISHED for IG. Blocked on app review and business verification, so file those the day phase A lands. Stories stay a notification-to-phone workflow, not a silent drop.
5. **Google Business Profile** — submit the manual access request now (weeks of latency), then Local Posts with our own scheduler and a 7-day re-post before expiry so the profile never goes stale.
6. **LinkedIn `/rest/posts`** — needs page-admin verification and the "Share on LinkedIn" product; keep 150/day and 100k/app/day in the queue's backoff.
7. **Houzz** — no write API. Treat it as preview-and-checklist only; do not build a composer that cannot post.

### Phase C — the rest

1. Per-platform notification fallback (push the composed post to Jake's phone to finish in-app) for IG Stories, FB Stories, YouTube Community. Serious builders do this instead of dropping the post type.
2. Publish worker with retry/backoff and per-platform rate ledgers (IG 100/24h, LinkedIn 150/day, YouTube 6-100/day), because none of these APIs schedule for us.
3. Queue pruning: archive `posted`/`abandoned` past 90 days, rotate `post-suggestions.jsonl`.
4. First-comment field (hashtags and the link IG won't make clickable), posted as a follow-up call after publish.
5. LinkedIn PDF carousel generation from selected photos — the only route to swipeable content there since native carousels were killed, and a genuine differentiator for project recaps.
6. Location tagging on FB/IG from the JobTread job's address, since every post is tied to a real jobsite already.
7. Server-side voice-rule enforcement shared by `lint()` and `suggestPosts()`, one module, so the browser and the model are held to the same house rules.
