# DbContext.cs — 加 2 個 DbSet + 3 個 index

把以下兩段加進 target 專案的 `DbContext` 類別（通常在
`<InfraProject>/Data/<DbContextName>.cs`）。

## 1. 加 `DbSet`

在現有 `DbSet` 宣告附近（class 上半部）加：

```csharp
public DbSet<FeedbackThread> FeedbackThreads => Set<FeedbackThread>();
public DbSet<FeedbackMessage> FeedbackMessages => Set<FeedbackMessage>();
```

如果 `Domain.Entities` namespace 跟 DbContext 不同，記得 `using
{{DOMAIN_NAMESPACE}}.Entities;`。

## 2. 加 index（在 `OnModelCreating(ModelBuilder builder)` 內）

加在 method 結尾、`}` 之前：

```csharp
// === Feedback 索引：客戶看自己的列表 / Claude triage 撈 open 的 ===
builder.Entity<FeedbackThread>(e =>
{
    // 客戶 GET /api/feedback?session=... 走這個
    e.HasIndex(x => new { x.SessionId, x.CreatedAt });
    // Claude triage 撈待處理的走這個（open / clarification 是熱資料）
    e.HasIndex(x => new { x.Status, x.UpdatedAt });
});
builder.Entity<FeedbackMessage>(e =>
{
    // GET /api/feedback/{id} 取單一 thread 的所有 messages
    e.HasIndex(x => new { x.ThreadId, x.CreatedAt });
});
```

## 3. Schema 初始化

如果專案用 `EnsureCreatedAsync()`（沒有 EF migrations folder），新 entity
會自動建立。如果用 migrations，跑：

```bash
dotnet ef migrations add AddFeedbackTables
dotnet ef database update
```

## Schema 風險

`EnsureCreatedAsync` 在 SQLite / SQL Server 都會自動建新表，**不會**在
existing prod DB 動既有 schema — 安全。Postgres 同理。
