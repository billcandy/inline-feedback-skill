---
name: inline-feedback
description: |
  Add an inline annotation feedback widget to a web app. Customers click any
  UI element on the deployed site, leave a comment in a popover, and Claude
  triages threads via the /triage-feedback slash command — proposes fixes,
  opens PRs, or asks clarifying questions. Self-hosted backend per project
  (DB tables + API endpoints live inside the target app, no external service).

  Triggers when the user asks to: "add inline feedback", "add a feedback
  widget", "client comment widget", "annotation widget", "let customers
  comment on the mockup", "demo feedback", "客戶留言系統", "回饋小工具",
  "註解 widget".

  Best for .NET 8 + Blazor Server + EF Core (proven, drop-in templates from
  NTUST reference impl). For Next.js / Express / Django / other stacks,
  Claude follows docs/spec.md to implement the same architecture per-stack.
---

# Inline Feedback Widget — installation workflow

You are installing a customer feedback widget into the user's repo. The
flow:

1. **Detect the host stack** — look at root files:
   - `*.csproj` + `Program.cs` + `_Host.cshtml`/`App.razor` → .NET 8 + Blazor
   - `package.json` with `next` dep → Next.js
   - `package.json` with `express` → Express
   - `pyproject.toml` / `manage.py` → Python (Django/Flask)
   - else → ask user

2. **Confirm with user** before doing anything destructive. Repeat back:
   - "Detected `<stack>` — install widget here?"
   - "AI assistant display name?" (default "AI 助理"; example "設計小幫手")
   - "Autofix mode?" (default `propose` — Claude posts fix proposals,
     customer approves before PR opens. `direct` opens PRs immediately.)

3. **Branch by stack:**
   - .NET 8 Blazor → follow `assets/dotnet8-blazor/README.md`
   - Other stack → read `docs/spec.md` and implement the schema, 5
     endpoints, and auth model in the host's idioms (Route Handlers for
     Next.js, Express middleware, Django views, etc.). The widget JS itself
     (`assets/widget/feedback-widget.js`) is universal — drop it into the
     equivalent of `wwwroot/js/`.

4. **Universal steps** (all stacks):
   - Copy `assets/widget/feedback-widget.js` to the host's static asset
     dir (`wwwroot/js/`, `public/js/`, `static/js/`, etc.)
   - Copy `assets/slash-command/triage-feedback.md.tmpl` to
     `<target-repo>/.claude/commands/triage-feedback.md`, replacing
     `{{REPO_PATH}}` with the absolute path of the target repo and
     `{{SRC_PATH}}` with the path that contains the .razor / .tsx files
     to grep
   - Copy `docs/runbook.md.tmpl` to `<target-repo>/docs/feedback-triage-runbook.md`
   - Show `assets/settings/settings.local.json.example` to user, instruct
     them to merge into their existing `.claude/settings.local.json`

5. **Token + env vars** — instruct the user to:
   - Run `openssl rand -hex 32` in their **own terminal** (NOT in chat) to
     generate a 64-char hex service token
   - Save the token to their password manager
   - Set 3 env vars in their hosting platform (Railway/Vercel/etc.):
     - `FEEDBACK_ENABLED=1`
     - `FEEDBACK_SERVICE_TOKEN=<the 64 chars>`
     - `FEEDBACK_AI_NAME=<their chosen name>` (optional)
   - Set the same `FEEDBACK_SERVICE_TOKEN` + `FEEDBACK_API_BASE` in their
     `.claude/settings.local.json` env block (so `/triage-feedback` works
     without `export`)

6. **Build verification:**
   - .NET → `dotnet build` 0 errors
   - Next.js → `pnpm build` (or detected pkg manager) 0 errors
   - Other → equivalent type check / build

7. **Commit checklist** (DO NOT auto-commit unless user says so):
   - List files modified
   - Remind user `.claude/settings.local.json` is gitignored — token stays
     local
   - Suggest commit msg: `feat(feedback): inline annotation widget + triage`

8. **Final step** — tell the user:
   - "Run `/triage-feedback` after your next demo to handle customer comments."
   - "If widget doesn't appear: check `FEEDBACK_ENABLED=1` is set."

---

## Important guard rails

- **Idempotency** — if entity files / endpoints / DbSets already exist (signs
  the widget was installed before), SKIP that step. Don't duplicate.
- **No tokens in chat** — never print the user's actual token, never paste
  it into chat. Always tell them to set it themselves in env / password
  manager.
- **Schema safety** — for `EnsureCreatedAsync` projects (most Blazor MVPs),
  new entities auto-create. For projects with `Migrations/` folder, run
  `dotnet ef migrations add AddFeedbackTables` instead.
- **Demo Gate / auth allowlist** — if the host has a path-based auth
  middleware, `/api/feedback` MUST be in the allowlist (it does its own
  cookie + service token auth). `/js/feedback-widget.js` allowlist is
  conditional — see `assets/dotnet8-blazor/snippets/DemoGate.diff.md`.

## Files in this skill

```
assets/widget/feedback-widget.js               ← drop-in, no placeholders
assets/slash-command/triage-feedback.md.tmpl   ← {{REPO_PATH}} {{SRC_PATH}}
assets/settings/settings.local.json.example
assets/dotnet8-blazor/
  ├── README.md                                ← .NET 8 install steps
  ├── Domain/
  │   ├── FeedbackThread.cs.tmpl               ← {{NAMESPACE}}
  │   └── FeedbackMessage.cs.tmpl
  ├── Application/Feedback/FeedbackEndpoints.cs.tmpl  ← multiple placeholders
  └── snippets/
      ├── DbContext.diff.md
      ├── Program.diff.md
      ├── _Host.cshtml.diff.md
      └── DemoGate.diff.md
docs/
  ├── spec.md                                  ← universal architecture
  └── runbook.md.tmpl                          ← /triage-feedback operator manual
INSTALL.md                                     ← detailed reference
README.md                                      ← human-facing setup
```

## Reference implementation

Production reference: `github.com/billcandy/NTUST-SchoolFees` —
.NET 8 + Blazor Server + EF Core, deployed on Railway with Demo Gate.

Bug fixes flow: skill repo first → sync to NTUST. The skill repo is the
source-of-truth.
