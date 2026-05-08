# INSTALL.md — Detailed installation reference

This file is what Claude reads in detail when installing the skill into a
target project. Humans usually don't need to read this; humans read
[`README.md`](./README.md). The flow that Claude follows is summarized in
[`SKILL.md`](./SKILL.md).

---

## Stack detection logic

Order of checks, first match wins:

| File found in repo root            | Stack                |
| ---------------------------------- | -------------------- |
| `*.csproj` with `Microsoft.AspNetCore.App` | .NET 8 Blazor (use `assets/dotnet8-blazor/`) |
| `package.json` with `next`         | Next.js → use `docs/spec.md` |
| `package.json` with `express`      | Express → `docs/spec.md` |
| `pyproject.toml` + `manage.py`     | Django → `docs/spec.md` |
| `Gemfile` + `config/application.rb` | Rails → `docs/spec.md` |
| else                               | ask user             |

Multi-project .NET solution (Domain / Application / Infrastructure / Web
projects) — entity goes to Domain project, endpoint to Application,
DbContext changes in Infrastructure, script + Program.cs glue in Web.
Single-project .NET (everything in `WebApp.csproj`) — put it all under
one namespace.

## .NET 8 install — files to create / modify

| Action  | Path (relative to target repo) | Source in skill |
| ------- | ------------------------------ | --------------- |
| CREATE  | `<DomainProject>/Entities/FeedbackThread.cs` | `assets/dotnet8-blazor/Domain/FeedbackThread.cs.tmpl` |
| CREATE  | `<DomainProject>/Entities/FeedbackMessage.cs` | `assets/dotnet8-blazor/Domain/FeedbackMessage.cs.tmpl` |
| CREATE  | `<AppProject>/Feedback/FeedbackEndpoints.cs` | `assets/dotnet8-blazor/Application/Feedback/FeedbackEndpoints.cs.tmpl` |
| MODIFY  | `<InfraProject>/Data/<DbContext>.cs` | `assets/dotnet8-blazor/snippets/DbContext.diff.md` |
| MODIFY  | `<WebProject>/Program.cs` | `assets/dotnet8-blazor/snippets/Program.diff.md` |
| MODIFY  | `<WebProject>/Pages/_Host.cshtml` (or App.razor) | `assets/dotnet8-blazor/snippets/_Host.cshtml.diff.md` |
| MODIFY  | `<WebProject>/Middleware/<DemoGate>.cs` (if any) | `assets/dotnet8-blazor/snippets/DemoGate.diff.md` |
| CREATE  | `<WebProject>/wwwroot/js/feedback-widget.js` | `assets/widget/feedback-widget.js` |
| CREATE  | `<target-repo>/.claude/commands/triage-feedback.md` | `assets/slash-command/triage-feedback.md.tmpl` |
| CREATE  | `<target-repo>/docs/feedback-triage-runbook.md` | `docs/runbook.md.tmpl` |
| MERGE   | `<target-repo>/.claude/settings.local.json` | `assets/settings/settings.local.json.example` |

## Placeholder substitution

| Placeholder           | Replace with                                   | Example                          |
| --------------------- | ---------------------------------------------- | -------------------------------- |
| `{{NAMESPACE}}`       | The Domain project's namespace (entity files) | `MyApp.Domain`                   |
| `{{APP_NAMESPACE}}`   | The Application project's namespace           | `MyApp.Application`              |
| `{{DOMAIN_NAMESPACE}}` | Same as `{{NAMESPACE}}` (entity import)       | `MyApp.Domain`                   |
| `{{INFRA_NAMESPACE}}` | The Infrastructure project's namespace        | `MyApp.Infrastructure`           |
| `{{DB_CONTEXT}}`      | The DbContext class name                      | `MyAppDbContext`                 |
| `{{REPO_PATH}}`       | Absolute path of target repo                  | `/Users/me/dev/myapp`            |
| `{{SRC_PATH}}`        | Path under which source files live (.razor / .tsx) | `MyApp.Web/Pages` or `src/app`   |

For single-project .NET apps, `{{NAMESPACE}}`, `{{APP_NAMESPACE}}`,
`{{DOMAIN_NAMESPACE}}`, `{{INFRA_NAMESPACE}}` are all the same.

## Idempotency

If you see signs the widget is already installed, SKIP that step:

- `FeedbackThread.cs` exists in target → don't recreate
- `MapFeedbackEndpoints` already in `Program.cs` → don't re-add
- `feedback-widget.js` already in `wwwroot/js/` → don't re-copy
- `feedback-widget` script tag already in `_Host.cshtml` → don't re-inject
- `DbSet<FeedbackThread>` already in DbContext → don't re-add

In a re-install scenario (skill version bumped), recommend the user run a
diff against this skill's `assets/widget/feedback-widget.js` and accept
the new version manually — auto-overwrite would clobber any local tweaks.

## Verification checklist

After install:

- [ ] `dotnet build` (or `pnpm build` etc.) returns 0 errors
- [ ] Set local env: `FEEDBACK_ENABLED=1 FEEDBACK_SERVICE_TOKEN=test-dev`
- [ ] `dotnet run` (or equivalent)
- [ ] Visit page → see two FAB buttons bottom-right
- [ ] Click bubble → annotate any element → see toast "已送出註解"
- [ ] Click inbox → see thread with page title as label
- [ ] Click "跳到該元素" → element gets amber flash highlight
- [ ] curl with service token: `GET /api/feedback?status=open` → returns JSON

## Deployment env vars

Hosting platform (Railway / Vercel / Fly.io / etc.):

```
FEEDBACK_ENABLED=1
FEEDBACK_SERVICE_TOKEN=<openssl rand -hex 32 — keep secret>
FEEDBACK_AI_NAME=設計小幫手  # optional, default "AI 助理"
FEEDBACK_FLASH_COLOR=#5e6ad2  # optional, default amber #f59e0b
```

Local Claude Code (`.claude/settings.local.json`, gitignored):

```json
{
  "env": {
    "FEEDBACK_API_BASE": "https://your-app.railway.app",
    "FEEDBACK_SERVICE_TOKEN": "<same as Railway>",
    "FEEDBACK_AUTOFIX_MODE": "propose"
  }
}
```

Restart Claude Code (cmd+Q) for env vars to take effect.

## Troubleshooting

| Symptom | Likely cause | Fix |
| ------- | ------------ | --- |
| Widget doesn't appear | `FEEDBACK_ENABLED` not `1`, or script blocked by gate middleware | Check env, allowlist `/js/` in gate |
| 500 on submit | DB tables not created | Verify `EnsureCreatedAsync` ran, or run migrations |
| 403 from Claude triage | Token mismatch | Local + hosting env must be identical |
| Widget appears before login | Gate middleware allowlists `/js/` too eagerly | Move `@if(feedbackEnabled)` to a Layout that only renders post-auth |
| Inbox shows route as title | New thread will use `document.title`; old threads fallback to route — by design |
