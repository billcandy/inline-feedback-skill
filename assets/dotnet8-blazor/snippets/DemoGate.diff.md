# Auth / Demo Gate Middleware — allowlist `/api/feedback` + `/js/`

只在 target 專案有「demo gate」或「auth wall」middleware 時才需要 — 一般
ASP.NET Core auth 內建 attribute（`[AllowAnonymous]`）即可。

## 通用做法（任何 path-based gate middleware）

在中介層的 path allowlist 函式裡加兩條：

```csharp
private static bool IsAllowed(string path)
{
    return path.StartsWith("/gate", StringComparison.OrdinalIgnoreCase)
        || path.StartsWith("/_blazor", StringComparison.OrdinalIgnoreCase)
        || path.StartsWith("/_framework", StringComparison.OrdinalIgnoreCase)
        || path.StartsWith("/css", StringComparison.OrdinalIgnoreCase)
        || path.StartsWith("/images", StringComparison.OrdinalIgnoreCase)
        // === 加這兩條 ===
        || path.StartsWith("/js", StringComparison.OrdinalIgnoreCase)
        // /api/feedback：客戶 widget 透過 cookie 認證 / Claude 透過 service token header；
        // 自帶權限檢查、不走 Demo Gate
        || path.StartsWith("/api/feedback", StringComparison.OrdinalIgnoreCase);
}
```

## 為什麼 `/api/feedback` 需要繞過 Gate

`/api/feedback` 自己的 endpoint handler 已經做了：
- 客戶 → 看 `feedback-session` cookie，session id mismatch 就 403
- Claude → 看 `X-Feedback-Service-Token` header，token mismatch 就 403

如果讓 Demo Gate middleware 先檔下來，Claude triage 端用 service token 仍
會被 Gate 擋（Gate 只認自己的 cookie），triage 永遠跑不起來。

## 為什麼 `/js` 需要繞過

widget script 本身（`/js/feedback-widget.js`）若被 Gate 擋，未過密碼 gate
的訪客就看不到 widget，但 demo gate 通常打算「過 gate 才開放」，這個沒過 gate 不該
看到 widget — **此時可以不加 `/js` 進 allowlist**。要讓 widget 在 gate 之前
就出現（例如做匿名 feedback），才需要加。

NTUST 的決定：加 `/js` 進 allowlist，因為 widget 在 Demo Gate 通過後才透過
`@if (feedbackEnabled)` 條件注入，沒過 gate 的訪客根本不會載到 script tag。
