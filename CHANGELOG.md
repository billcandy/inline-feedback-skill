# CHANGELOG

## v0.1.0 — 2026-05-08

Initial release. Extracted from
[`billcandy/NTUST-SchoolFees`](https://github.com/billcandy/NTUST-SchoolFees)
reference implementation (commits `a638b4a` … `f638813`).

### Included

- Universal `feedback-widget.js` (Vanilla JS, Shadow DOM, ~880 lines)
- .NET 8 + Blazor Server + EF Core templates:
  - `FeedbackThread.cs` / `FeedbackMessage.cs` entities
  - `FeedbackEndpoints.cs` — 5 minimal API endpoints
  - DbContext / Program.cs / `_Host.cshtml` / Demo Gate diff snippets
- `triage-feedback.md` slash command template
- `feedback-triage-runbook.md` operator manual
- `docs/spec.md` — universal architecture for non-.NET stacks
- `SKILL.md` — Claude Code skill entry point
- `INSTALL.md` — detailed Claude install reference

### Features

- Floating annotate + inbox buttons (Shadow DOM, no style leaks)
- Cross-page "jump to element" via URL hash
- Customer-editable thread titles
- AI assistant display name configurable per-deploy (`FEEDBACK_AI_NAME`)
- Flash highlight color configurable (`FEEDBACK_FLASH_COLOR`)
- Service token + cookie dual auth
- User-controlled "標記完工" status (Claude opens PR but doesn't auto-close)
- Interactive `/triage-feedback` — list threads, pick which to handle

### Out of scope (future versions)

- Next.js / Express / Django ready-to-paste templates
- macOS Keychain / 1Password CLI for token storage
- Slack / email webhook for new-thread notifications
- Multi-tenant SaaS dashboard
- html2canvas screenshot capture
