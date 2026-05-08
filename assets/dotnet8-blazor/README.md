# Installing on .NET 8 + Blazor Server + EF Core

This is the proven path. Templates extracted directly from the NTUST reference
implementation. Follow these steps in order.

## Prerequisites

- ASP.NET Core .NET 8 web app (Blazor Server / Razor Pages / MVC)
- EF Core with a `DbContext` — any DB provider (SQLite / SQL Server /
  Postgres / etc.)
- Either `EnsureCreatedAsync` schema initialization OR `Migrations/` folder

## Step 1 — Identify target projects

Multi-project solution (recommended pattern, e.g. Clean Architecture):

| Project              | Hosts                                         |
| -------------------- | --------------------------------------------- |
| `<Domain>`           | Entities (`FeedbackThread.cs`, `FeedbackMessage.cs`) |
| `<Application>`      | `Feedback/FeedbackEndpoints.cs`               |
| `<Infrastructure>`   | `DbContext.cs` modifications                  |
| `<Web>`              | `Program.cs`, `_Host.cshtml`, `wwwroot/js/`, optional `Middleware/<DemoGate>.cs` |

Single-project app: everything goes under one namespace (e.g.
`MyApp.Entities`, `MyApp.Feedback`).

Decide: which project holds the DbContext? That's your `<Infrastructure>`.

## Step 2 — Copy entity files

```
assets/dotnet8-blazor/Domain/FeedbackThread.cs.tmpl   →   <Domain>/Entities/FeedbackThread.cs
assets/dotnet8-blazor/Domain/FeedbackMessage.cs.tmpl  →   <Domain>/Entities/FeedbackMessage.cs
```

Replace `{{NAMESPACE}}` with the Domain project's namespace
(e.g. `MyApp.Domain`).

## Step 3 — Copy endpoints file

```
assets/dotnet8-blazor/Application/Feedback/FeedbackEndpoints.cs.tmpl
  →   <Application>/Feedback/FeedbackEndpoints.cs
```

Replace placeholders:

- `{{APP_NAMESPACE}}` → Application namespace (e.g. `MyApp.Application`)
- `{{DOMAIN_NAMESPACE}}` → Domain namespace
- `{{INFRA_NAMESPACE}}` → Infrastructure namespace
- `{{DB_CONTEXT}}` → DbContext class name (e.g. `MyAppDbContext`)

## Step 4 — Modify DbContext

Read `snippets/DbContext.diff.md`. Add 2 `DbSet`s + 3 indexes to the target
`DbContext.cs`.

## Step 5 — Modify Program.cs

Read `snippets/Program.diff.md`. Add `using`, env var read, and
`MapFeedbackEndpoints` call (must be before `MapFallbackToPage`).

## Step 6 — Modify `_Host.cshtml`

Read `snippets/_Host.cshtml.diff.md`. Add `@{}` block at top reading 3 env
vars + conditional `<script>` injection at the end of body.

## Step 7 — Demo Gate / auth middleware (if applicable)

Read `snippets/DemoGate.diff.md`. If your app has a path-based auth gate
middleware, allowlist `/api/feedback` (mandatory) and possibly `/js/`
(see notes in that file).

## Step 8 — Copy widget JS

```
assets/widget/feedback-widget.js   →   <Web>/wwwroot/js/feedback-widget.js
```

No placeholders. Stack-agnostic.

## Step 9 — Copy slash command + runbook

```
assets/slash-command/triage-feedback.md.tmpl   →   <repo-root>/.claude/commands/triage-feedback.md
docs/runbook.md.tmpl                           →   <repo-root>/docs/feedback-triage-runbook.md
```

In the slash command, replace:

- `{{REPO_PATH}}` → absolute path of target repo (e.g. `/Users/me/dev/myapp`)
- `{{SRC_PATH}}` → path containing `.razor` files (e.g. `MyApp.Web/Pages`)

## Step 10 — Merge `.claude/settings.local.json`

If user already has a `.claude/settings.local.json`, ADD the `env` block
from `assets/settings/settings.local.json.example`. Don't overwrite their
`permissions` block. After they paste their actual token, they need to
restart Claude Code (cmd+Q).

## Step 11 — Build verification

```bash
dotnet build <Web>.csproj
```

Expect 0 errors. Warnings about MudBlazor / unrelated project are fine.

## Step 12 — Run + smoke test

```bash
export FEEDBACK_ENABLED=1
export FEEDBACK_SERVICE_TOKEN=dev-test-token
export FEEDBACK_AI_NAME=設計小幫手
dotnet run --project <Web>.csproj
```

Open browser → see right-bottom two FAB (purple bubble + white inbox).
Click bubble → annotate any element → green toast "已送出註解".

## Step 13 — Production env vars

Tell user to set in their hosting platform (Railway / Vercel / Fly.io):

- `FEEDBACK_ENABLED=1`
- `FEEDBACK_SERVICE_TOKEN=<openssl rand -hex 32>` ← **secret, NEVER commit**
- `FEEDBACK_AI_NAME=<their choice>` (optional)

After deploy, smoke-test on production URL. Then run `/triage-feedback` to
verify the slash command works against production API.

## Step 14 — Commit

DO NOT auto-commit. Suggest commit:

```
git add <Web>/wwwroot/js/feedback-widget.js \
        <Web>/Program.cs \
        <Web>/Pages/_Host.cshtml \
        <Domain>/Entities/FeedbackThread.cs \
        <Domain>/Entities/FeedbackMessage.cs \
        <Application>/Feedback/FeedbackEndpoints.cs \
        <Infrastructure>/Data/<DbContext>.cs \
        .claude/commands/triage-feedback.md \
        docs/feedback-triage-runbook.md

git commit -m "feat(feedback): inline annotation widget + triage API + slash command"
```

Note: `.claude/settings.local.json` is gitignored — token stays local.
