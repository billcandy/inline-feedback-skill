# _Host.cshtml — 條件注入 widget script

target Blazor Server 專案的 `_Host.cshtml`（或 `App.razor` for Blazor United）
加兩段。

## 1. 頂部 `@{}` block — 讀 3 個環境變數

放在 `@page "/"` 後、`<!DOCTYPE html>` 前：

```cshtml
@{
    // Feedback widget 載入開關 — 環境變數 FEEDBACK_ENABLED=1 才注入
    var feedbackEnabled = Environment.GetEnvironmentVariable("FEEDBACK_ENABLED") == "1";

    // 可設定的 AI 助理顯示名稱（widget UI 顯示，不影響 DB authorType='claude'）
    var feedbackAiName = Environment.GetEnvironmentVariable("FEEDBACK_AI_NAME") ?? "AI 助理";
    var feedbackAiNameJs = System.Text.Json.JsonSerializer.Serialize(feedbackAiName);

    // 跨頁 highlight flash 邊框配色 — FEEDBACK_FLASH_COLOR 設單一 hex（如
    // "#5e6ad2"），widget 自動推算 fill / glow。不設走預設琥珀色。
    var feedbackFlashColor = Environment.GetEnvironmentVariable("FEEDBACK_FLASH_COLOR");
    var feedbackFlashColorJs = !string.IsNullOrWhiteSpace(feedbackFlashColor)
        ? System.Text.Json.JsonSerializer.Serialize(feedbackFlashColor)
        : null;
}
```

## 2. body 末段 — 條件式 script 注入

放在 `</body>` 之前、所有其他 `<script>` 之後：

```cshtml
@if (feedbackEnabled)
{
    <script>window.__feedbackAiName = @Html.Raw(feedbackAiNameJs);</script>
    @if (feedbackFlashColorJs != null)
    {
        <script>window.__feedbackFlashColor = @Html.Raw(feedbackFlashColorJs);</script>
    }
    <script src="~/js/feedback-widget.js" defer asp-append-version="true"></script>
}
```

## 為什麼條件注入

- prod 上 `FEEDBACK_ENABLED=1` → 客戶看到右下兩顆 FAB（紫色泡泡 + 白色信箱）
- 一般使用者 / 真實上線環境關掉（`FEEDBACK_ENABLED` 沒設 / `=0`） → widget
  完全不載入、不影響任何效能 / 安全 surface
- 改 `FEEDBACK_ENABLED=0` 即時關掉，DB 留下的 thread 不會掉
