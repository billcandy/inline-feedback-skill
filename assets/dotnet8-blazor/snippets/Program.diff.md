# Program.cs — wire up endpoints + service token env

在 target 專案的 `Program.cs` 加 3 處。

## 1. using

頂部 using 區塊加：

```csharp
using {{APP_NAMESPACE}}.Feedback;
```

## 2. 讀環境變數

在 `var app = builder.Build();` 後（任意位置都行，建議放在 endpoint mapping 附近）：

```csharp
// Feedback widget service token（Claude triage 認證用）— 環境變數沒設就 disable
var feedbackServiceToken = Environment.GetEnvironmentVariable("FEEDBACK_SERVICE_TOKEN");
```

## 3. Map endpoints

**位置很重要**：必須在 `app.MapFallbackToPage(...)` 或 `app.MapRazorPages()`
之前，否則 Razor fallback 會吃掉 `/api/feedback` 路由。

```csharp
app.MapFeedbackEndpoints(feedbackServiceToken);
```

## 完整片段示例

```csharp
using {{APP_NAMESPACE}}.Feedback;
// ...
var app = builder.Build();
// ...
var feedbackServiceToken = Environment.GetEnvironmentVariable("FEEDBACK_SERVICE_TOKEN");
app.MapFeedbackEndpoints(feedbackServiceToken);

app.MapFallbackToPage("/_Host");   // ← 一定要在 MapFeedbackEndpoints 之後

app.Run();
```

## 為什麼用 service token + cookie 雙認證

- **客戶** 走 cookie（widget 自動發 `feedback-session=<uuid>`）：只能看 / 改
  自己的 thread
- **Claude triage** 走 `X-Feedback-Service-Token` header：可看全部 + 改 status
- token 不對 → 403 Forbidden
- token env 沒設（null）→ Claude 端任何 service-token 認證都 fail，
  widget 流程仍可用（客戶仍能留 comment、看自己的 thread）
