# Universal Architecture Spec

This document is the canonical architecture for the inline feedback widget.
.NET 8 templates implement it; for other stacks (Next.js, Express, Django,
Rails, etc.), Claude reads this and implements equivalents per-stack.

## Components

```
┌──────────────────┐     ┌──────────────────┐     ┌──────────────────┐
│  Browser widget  │ ←→ │  Host app API    │ ←→ │  Host app DB     │
│  (Shadow DOM JS) │     │  (5 endpoints)   │     │  (2 tables)      │
└──────────────────┘     └──────────────────┘     └──────────────────┘
        ↑                          ↑
        │                          │
   customer cookie         service token header
        │                          │
        │                          ↓
        │                ┌──────────────────────┐
        │                │  Claude Code +       │
        └──────────────→│  /triage-feedback    │
                         │  (slash command)     │
                         └──────────────────────┘
```

## Database schema

### `feedback_threads`

| Column          | Type           | Notes                                         |
| --------------- | -------------- | --------------------------------------------- |
| `id`            | UUID PK        | client-generated or server-generated          |
| `session_id`    | varchar(64)    | from `feedback-session` cookie                |
| `page_url`      | varchar(500)   | full URL when comment was made                |
| `route`         | varchar(200)   | path only (e.g. `/cashier/dashboard`)         |
| `selector`      | varchar(2000)  | CSS path to element                           |
| `outer_html`    | text           | element outerHTML, ≤1500 chars                |
| `bbox_json`     | text (json)    | `{x, y, w, h}` viewport-relative              |
| `viewport_json` | text (json)    | `{w, h}` window inner size                   |
| `signals_json`  | text (json)    | see Signals object below                      |
| `deployment_sha`| varchar(40)    | optional, from `window.__DEPLOY_SHA__`        |
| `screenshot_b64`| text           | optional, html2canvas (Phase 5+)              |
| `status`        | varchar(20)    | `open` / `clarification` / `done`             |
| `pr_url`        | varchar(500)   | nullable, set when Claude opens PR            |
| `created_at`    | timestamp      |                                               |
| `updated_at`    | timestamp      |                                               |

**Indexes:**

- `(session_id, created_at)` — customer's own threads
- `(status, updated_at)` — Claude triage scan

### `feedback_messages`

| Column          | Type           | Notes                                         |
| --------------- | -------------- | --------------------------------------------- |
| `id`            | UUID PK        |                                               |
| `thread_id`     | UUID FK        | → `feedback_threads.id`                       |
| `author_type`   | varchar(20)    | `customer` / `claude`                         |
| `kind`          | varchar(20)    | `comment` / `clarification` / `proposal` / `approval` / `done-note` |
| `body`          | text           | ≤4000 chars                                   |
| `screenshot_b64`| text           | optional                                      |
| `created_at`    | timestamp      |                                               |

**Indexes:**

- `(thread_id, created_at)` — list messages by time

## Signals object (`signals_json`)

JSON object stored on `feedback_threads.signals_json`. Used by Claude to
reverse-look-up the source component.

```json
{
  "customClasses":      ["ds-kpi-card", "is-warning"],
  "parentCustomClasses":["ds-grid"],
  "grandparentCustomClasses": ["dashboard-section"],
  "visibleText":        "新生報到率",
  "inlineStyle":        "min-width: 200px",
  "ariaLabel":          "",
  "role":               "",
  "dataTestId":         "",
  "tagName":            "div",
  "pageTitle":          "Cashier Dashboard - MyApp",
  "customTitle":        "字太小",
  "url":                "https://app.example.com/cashier/dashboard"
}
```

- `customClasses` excludes framework classes (e.g. `mud-*`, `ant-*`).
  Highest priority for reverse-lookup.
- `visibleText` ≤200 chars, whitespace collapsed.
- `pageTitle` from `document.title` at submit time.
- `customTitle` set by user via PATCH endpoint, displayed instead of
  `pageTitle` if present.

## API — 5 endpoints

### `POST /api/feedback`

Create a new thread.

**Request body:**

```json
{
  "session_id":     "<uuid>",
  "page_url":       "https://...",
  "route":          "/dashboard",
  "selector":       "main > .card:nth-child(2)",
  "outer_html":     "<div class=\"...\">",
  "bbox":           { "x":160, "y":420, "w":280, "h":160 },
  "viewport":       { "w":1280, "h":800 },
  "signals":        { "...": "..." },
  "comment":        "字太小看不清楚",
  "deployment_sha": null
}
```

**Auth:** none required (any visitor with cookie can post). Server SHOULD set
`feedback-session=<uuid>` cookie on first POST if not present.

**Response:** `201 Created`, `{ id, status: "open", created_at }`

**Validation:** `comment` non-empty, `signals` valid JSON, lengths within
column limits.

### `POST /api/feedback/{id}/messages`

Add a message to an existing thread.

**Request body:**

```json
{ "kind": "comment", "body": "進度怎樣？", "screenshot_b64": null }
```

**Auth:**

- Customer (cookie): `kind` MUST be `comment`. Can only post on threads
  matching `session_id`.
- Claude (service token header `X-Feedback-Service-Token`): any `kind`
  allowed.

**Response:** `201 Created`, `{ id, author_type, kind, created_at }`

### `GET /api/feedback?status=...&session=...`

List threads.

**Auth:**

- Customer (cookie): returns own threads only (server filters by
  `session_id` from cookie).
- Claude (service token): returns all, can filter by `status` query param.

**Response:** array of `ThreadSummaryDto` (id, route, selector, signals_json,
status, pr_url, created_at, updated_at, message_count).

### `GET /api/feedback/{id}`

Single thread + all messages.

**Auth:**

- Customer: only own threads (`session_id` matches).
- Claude (service token): any.

**Response:** `ThreadDetailDto` with full payload + `messages: [MessageDto]`.

### `PATCH /api/feedback/{id}`

Update status / pr_url / customTitle.

**Request body:**

```json
{ "status": "done", "pr_url": null, "customTitle": "字太小" }
```

(Any subset of fields; unset fields not modified.)

**Auth & permissions:**

- Customer (cookie):
  - Can set `status` only to `done` (no reversing).
  - Can set `customTitle` (any value, max 100 chars; empty string = clear).
  - Cannot set `pr_url` → 403.
- Claude (service token):
  - Can set any field to any valid value.

**Response:** `{ id, status, pr_url }`

## Auth model

Two parallel auth paths on every endpoint:

1. **Customer cookie** — `feedback-session=<uuid>`. Set by server on first
   POST. HttpOnly, SameSite=Lax, Secure in production. No expiration
   (persistent until cookie store cleared).

2. **Service token header** — `X-Feedback-Service-Token: <64-char-hex>`.
   Token compared with `FEEDBACK_SERVICE_TOKEN` env var (constant-time
   compare recommended). Token MUST NOT be set as anonymous default — if
   env var is missing/empty, treat all requests as not-Claude.

Permission matrix:

| Action                       | Customer (cookie) | Claude (token) |
| ---------------------------- | ----------------- | -------------- |
| POST new thread              | ✓                 | ✓ (rare)       |
| POST `kind=comment` message  | ✓ (own threads)   | ✓              |
| POST other `kind`            | ✗                 | ✓              |
| GET list                     | ✓ (own only)      | ✓ (all)        |
| GET single thread            | ✓ (own only)      | ✓              |
| PATCH `status=done`          | ✓ (own only)      | ✓              |
| PATCH `status=open/clarif`   | ✗                 | ✓              |
| PATCH `pr_url`               | ✗                 | ✓              |
| PATCH `customTitle`          | ✓ (own only)      | ✓              |

## Status state machine

```
        new comment
           │
           ▼
        open ────────► clarification
         │   ◄────────       │
         │ Claude needs more │ customer replies
         │ info              │
         │                   │
         ▼                   ▼
        done (set by customer or Claude)
```

- Default: `open`
- Claude posts `clarification` message → status flips to `clarification`
- Customer replies → status flips back to `open` (Claude re-evaluates next run)
- Claude opens PR → set `pr_url` (status stays `open`)
- Customer clicks "標記完工" → `status=done`

## Widget contract

The browser widget MUST:

1. **Mount inside Shadow DOM** — no style leak in either direction.
2. **Skip path blacklist** — `/Account/`, `/gate`, `/_blazor`,
   `/_framework` (configurable).
3. **Two FABs** — annotate (left) + inbox (right).
4. **Annotate flow** — element click handler with capture phase, prevent
   default. Show popover with element preview + (optional) title input +
   comment textarea + submit/cancel.
5. **Submit** — POST `/api/feedback` with full Signals payload + comment.
6. **Inbox flow** — 30-second polling, show list with badge color per
   status. Detail view shows messages chronologically.
7. **Cross-page jump** — when target route differs from current,
   `location.assign(route + '#feedback-' + id)`. On mount, if
   `location.hash` matches `#feedback-<uuid>`, fetch thread and run
   highlight after Blazor / framework renders.
8. **Highlight** — fixed-position div with amber border + light yellow fill
   + black outline (or `__feedbackFlashColor` override). Wait for `bbox`
   stable across 3 rAF frames before placing.
9. **Customer-editable title** — popover input on submit + pencil-icon
   inline edit on detail view. Both PATCH `{customTitle: ...}`.
10. **Universal config injection** — read 3 globals if defined:
    - `window.__feedbackAiName` — display name for Claude messages
    - `window.__feedbackFlashColor` — hex string or `{stroke, fill, ...}`
    - (others can be added; keep backward-compatible defaults)

## Reverse-lookup contract for `/triage-feedback`

Slash command needs to find the source file (`.razor`, `.tsx`, `.vue`,
template) that rendered the element.

Signal priority (Phase 0 spike validated 5/5 hit rate):

1. `customClasses[0]` (non-framework) → `rg -lF '<class>' --glob '<src>/*.{razor,tsx,vue}'`
2. `visibleText` (≥5 chars, non-data) → same grep with text
3. `inlineStyle` fragment
4. `parentCustomClasses[0]`

Stop when ≤2 candidate files match. If all 4 signals exhausted with ≥3
candidates, post `kind=clarification` to ask user.

## Configuration env vars

| Env var                   | Default        | Purpose                                  |
| ------------------------- | -------------- | ---------------------------------------- |
| `FEEDBACK_ENABLED`        | `0`            | Master switch — `1` to inject widget script |
| `FEEDBACK_SERVICE_TOKEN`  | (none)         | 64-char hex, Claude triage auth          |
| `FEEDBACK_AI_NAME`        | "AI 助理"      | Display name for Claude messages         |
| `FEEDBACK_FLASH_COLOR`    | `#f59e0b`      | Highlight border color                   |
| `FEEDBACK_AUTOFIX_MODE`   | `propose`      | `propose` or `direct` (slash command-side) |
| `FEEDBACK_API_BASE`       | (none)         | Slash command-side: target API host URL  |
