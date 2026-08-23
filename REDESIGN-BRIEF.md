# Mission Control — ground-up redesign brief (2026-08-23)

Jake's call: **ground-up redesign**, serving all four purposes at once. This brief is the
fixed input to the design panel; the audit report supplies the facts about what exists.

## The user

Jake Mauldin, owner of a commercial GC. Terse. Opens things on phone and desktop over the
tailnet. Will not read a wall of tiles; will act on a short queue. Financial truth lives in
JobTread + QBO — the dashboard REFLECTS, it is never the system of record.

## Four purposes, one architecture

| Surface | Purpose | Shape |
|---|---|---|
| **Brief** (home) | morning check-in | What changed overnight, what needs Jake today, one screen, zero scrolling on phone. An action queue, not a wall of charts. |
| **Workspaces** | working surface | Deep views he acts in: Media (grade/pick/generate), RFIs (live log, answer state), Money (bills, pay apps, cash), Jobs. |
| **Client view** | client-facing | Per-job, share-link scoped, its OWN route + auth door, hard data separation — a client can never see another job, internal costs, or systems data. Real design bar: this page sells trust. |
| **Systems** | systems monitor | Backup freshness (the four bk_check jobs), disk + rc-media volume, containers, cron outcomes, agent/spend activity. Everything tonight taught us: OUTCOMES, not liveness. |

## Hard constraints (non-negotiable)

1. **Tailnet-only for internal surfaces. No Tailscale Funnel — ever** (standing policy). The
   client view's exposure mechanism is part of the design problem: options are the existing
   nginx + Let's Encrypt + OAuth pattern on the public droplet, or magic-link tokens proxied
   there. Panel must pick one and defend it.
2. **No dev server in production.** Vite builds a static bundle; one Node process serves API +
   bundle. The current :5173 dev-server-as-production is one of the things being killed.
3. **Auth on every internal route.** Even on tailnet — the current unauthenticated :3080 API
   is the other thing being killed.
4. **No execSync of docker anywhere in the API** (froze every endpoint 9-19s once). Async +
   cache, files over shells wherever possible.
5. **Brand**: real RCC palette (#635500 family) via `rc-brand-config.json`; charts follow the
   dataviz-skill conventions (accessible, consistent light/dark).
6. **4-core box**: no heavy per-request work; precompute/cached JSON; the API reads files the
   pipelines already write.
7. **Reflect, don't own**: media grading state stays in the `_*.json` files the photo pipeline
   owns; RFI truth stays in the job's rfi.json; bills stay in bills-tracker. The dashboard
   reads their files. It may WRITE only through the same contracts the CLIs use (todo.sh
   pattern), never by inventing a second store.
8. **Media at scale**: 31k files, 58 GB, on /mnt/rc_media. Thumbs exist (_thumbs). The Media
   workspace must not walk the tree per request.
9. **Existing gallery (:3251) and photo-drop (:3250) keep working during the transition** —
   decision for the panel: absorb the gallery's queues into the Media workspace eventually,
   but nothing breaks on day one.
10. **Git discipline**: work happens on a branch in the mission-control repo (8-commit
    history preserved), commits per unit.

## What "SOTA" means here (and what it does not)

- It means: instant loads, keyboard-fast, phone-first Brief, live-updating without reload
  (SSE or polling — panel picks), a UI that looks designed rather than assembled, dark mode.
- It means Higgsfield/media-studio generation capabilities surfaced where Jake works with
  media (generate a variant, cut a clip → these dispatch to existing pipelines, not new ones).
- It does NOT mean: a component-library kitchen sink, a rewrite of working pipelines, or
  features no one asked for. Every view must answer "what does Jake DO here."

## Panel deliverable

Each proposal must cover: information architecture (routes + nav), the Brief's exact
content and ranking logic, Media + RFI workspace interaction design, client-view exposure +
auth mechanism, Systems page content, serving/auth architecture, tech choices with WHY
(keep Vite+React? state? styling?), migration order from the 16 existing views, and a
phased build plan where phase 1 is shippable in one session.

## Addendum (Jake, mid-design)

- **Higgsfield generation is Fable-prompted**: the Media workspace dispatches generation jobs,
  but prompt authoring happens in Jake's session (Fable), never a subagent. The UI collects
  intent + refs; the prompt is composed upstream.
- **CAD → generation**: tools/cad reads .dwg geometry (verified against Doreen St). Explore
  plan-sheet-aware generation — renders of unbuilt work grounded in actual plan geometry —
  as a candidate Media-workspace ability. Unproven; design for it as an optional module.
