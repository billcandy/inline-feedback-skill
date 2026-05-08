# inline-feedback-skill

A Claude Code skill that drops an **inline annotation feedback widget** into
any web app: customers click any UI element on the deployed site, leave a
comment in a popover, and Claude triages threads via the `/triage-feedback`
slash command — proposing fixes, opening PRs, or asking clarifying questions.

**Self-hosted backend** — DB tables + API endpoints live inside the target
app, no external service.

## What it gives you

- Floating bubble button on every page → click → annotate any element → leave comment
- Inbox sidebar showing customer's threads (open / clarification / done)
- "Jump to element" cross-page navigation with auto-highlight
- Customer-editable thread titles
- `/triage-feedback` slash command — pulls open threads, reverse-looks-up
  source files via signal-priority strategy, posts fix proposals or opens PRs

Reference implementation:
[`billcandy/NTUST-SchoolFees`](https://github.com/billcandy/NTUST-SchoolFees)
on Railway.

## Stacks supported (v0.1)

| Stack                                | Status        |
| ------------------------------------ | ------------- |
| .NET 8 + Blazor Server + EF Core     | drop-in templates (proven) |
| Next.js / Express / Django / others  | universal `docs/spec.md` — Claude implements per-stack |

## Setup (one-time)

```bash
# 1. clone the skill into your dev folder
mkdir -p ~/skills
git clone https://github.com/billcandy/inline-feedback-skill ~/skills/inline-feedback-skill

# 2. symlink into Claude Code's skill directory
ln -s ~/skills/inline-feedback-skill ~/.claude/skills/inline-feedback
```

## Usage

In any project's Claude Code session:

> 加 inline feedback widget

Claude will:

1. Detect your stack (`*.csproj` → .NET, `package.json next` → Next.js, etc.)
2. Confirm AI assistant name + autofix mode
3. Copy widget JS, slash command, runbook
4. Install entities + endpoints + DB integration (.NET) or generate per-spec (other)
5. Verify build, prompt for env var setup

After deploy:

```bash
# In target hosting platform (Railway / Vercel etc.):
FEEDBACK_ENABLED=1
FEEDBACK_SERVICE_TOKEN=<openssl rand -hex 32>
FEEDBACK_AI_NAME=設計小幫手  # optional, default "AI 助理"
```

## Workflow

```
demo to customer → customer clicks UI elements + leaves comments
                            ↓
            you run /triage-feedback in Claude Code
                            ↓
       Claude pulls threads → reverse-look-up source → posts fix proposals
                            ↓
       customer approves in widget sidebar → Claude opens PR
                            ↓
       PR merged → customer clicks "標記完工" → thread closed
```

## License

MIT — see [LICENSE](./LICENSE).
