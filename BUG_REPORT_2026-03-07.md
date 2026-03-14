# Bug Report — Antigravity Bridge 權限攔截失效

> **日期**: 2026-03-07
> **版本**: v2.6
> **嚴重度**: 🔴 Critical
> **狀態**: ✅ 全部修復（v3.0 ~ v3.2）

---

## 症狀描述

1. **重複回應** — AI 回覆了兩次相同內容
2. **後續指令全部超時** — 發訊息後一直等到 timeout，完全沒回應
3. **根因發現** — 到 IDE 一看，原來 AI 在等用戶同意（permission dialog），但 Bridge 沒攔截到，沒轉發到 Telegram

**預期行為**: 權限請求應該被 Bridge 攔截，以 inline button（✅ Allow / ❌ Deny）發到 Telegram，用戶在手機上操控

**實際行為**: 權限請求沒有轉發，IDE 自己跳出同意對話框，Bridge 傻等回應直到超時

---

## Bug 分析

### Bug #1（致命）：Polling Fallback 完全沒有權限處理

**檔案**: `lib/rpc.js` — `sendToAI()` 函數

**問題**: 當 streaming 失敗 fallback 到 polling 模式時，`onPermission` callback 完全沒有傳進 `pollResponse()`。Polling 只會輪詢 response text，完全不偵測 WAITING 狀態。

```javascript
// ❌ 目前的程式碼
} catch (streamErr) {
    console.warn(`Streaming failed: ${streamErr.message}, falling back to polling`);
    useStreaming = false;
    const fallback = createPollingFallback(port, csrfToken, () => cascadeId);
    const snap = await fallback.getTrajectorySnapshot();
    return await fallback.pollResponse(timeoutMs, onUpdate, snap.executorCount, snap.lastResponseText);
    // ⚠️ onPermission 完全沒傳！pollResponse 也不支援權限偵測！
}
```

**影響**: 一旦進入 polling 模式，所有需要權限的操作都會超時

**修復方向**:
- `pollResponse()` 加入 permission 偵測（檢查 trajectory snapshot 中的 WAITING status）
- 或者改為：polling 也從 `getTrajectorySnapshot()` 中偵測 step status = WAITING
- `onPermission` 必須傳入 fallback

---

### Bug #2（致命）：`useStreaming = false` 永久生效

**檔案**: `lib/rpc.js`

**問題**: `useStreaming` 是模組級變數，一旦 streaming 失敗設為 `false`，後續所有訊息（包括新的 cascade）都永遠用 polling，不會重試 streaming。

```javascript
// ❌ 目前的邏輯
let useStreaming = true;

// streaming 失敗時
useStreaming = false; // ← 永久！直到 Bridge 重啟
```

**影響**: 一次網路閃斷就永久喪失 streaming 能力（包括權限攔截能力）

**修復方向**:
- 每次新 cascade（`resetCascade()`）時重置 `useStreaming = true`
- 或設定重試計數器：失敗 N 次後才永久切換
- 或每隔一段時間（如 5 分鐘）自動重試 streaming

---

### Bug #3（中等）：Timeout 不考慮等待權限的情況

**檔案**: `lib/rpc.js` — `streamResponse()`

**問題**: `timeoutMs` 計時器從 stream 開始就啟動，不管是否正在等待用戶回應權限請求。用戶可能需要時間看 Telegram 訊息並決定是否 Allow。

```javascript
// ❌ 目前的邏輯
const timeoutHandle = setTimeout(() => {
    if (!done) {
        done = true;
        if (activeStream) activeStream.abort();
        // 不管 permission 是否 pending，直接超時
        if (responseText) resolve(responseText);
        else reject(new Error('AI response timeout'));
    }
}, timeoutMs);
```

**影響**: 即使權限按鈕已經發到 Telegram，用戶還沒來得及按，Bridge 就超時了

**修復方向**:
- 當偵測到 permission 等待時，暫停或延長 timeout
- 加入 `permissionPending` flag，超時判斷時檢查
- 或改為「自從最後一次有新 frame 後開始計時」而非「從開始就計時」

---

### Bug #4（低）：Replay 階段可能漏掉權限

**檔案**: `lib/rpc.js` — `streamResponse()`

**問題**: Stream 連接後會 replay 當前狀態。如果 AI 在 `messageIsSent = true` 之前就已經在 WAITING 狀態，replay frame 帶著的 WAITING 會被當作舊資料跳過。之後因為狀態沒變，不會再收到新的 WAITING frame。

```javascript
// ❌ Replay 階段跳過的權限不會再出現
} else if (info.permissionWait && !messageIsSent) {
    console.log(`  ⏭️ Skipping replayed permission (step ${info.stepIndex})`);
    // 之後 messageIsSent = true 時，不會再收到這個 WAITING frame
}
```

**影響**: 如果 AI 回應很快（或恢復舊 cascade），權限可能被永久漏掉

**修復方向**:
- 記錄 replay 階段看到的 pending permissions
- `messageIsSent = true` 後重新檢查，如果仍然 WAITING 就觸發 `onPermission`
- 或在 `messageIsSent` 切換時，主動查詢一次 trajectory snapshot 確認有無 pending permission

---

### Bug #5（觀察）：重複回應的可能原因

**推測原因**:
1. Stream replay 帶著上一輪的完整回覆文字
2. 如果 `messageIsSent` 切換時機不對，replay 的文字可能被當作新回覆
3. 或者 `responseText` 清空（`responseText = ''`）的時機和新 frame 到達之間有 race condition
4. 也可能是 server 端的 diff 包含了多輪對話的完整回覆文字

**需要更多 log 才能確認確切原因**

---

## 問題重現步驟

1. 啟動 Bridge，正常使用一陣子
2. 等待 streaming 出錯（網路抖動、IDE 重啟等）
3. Bridge log 出現 `Streaming failed: ..., falling back to polling`
4. 之後發任何需要 AI 執行工具（終端指令、檔案編輯）的訊息
5. AI 進入 WAITING 狀態
6. Telegram 上看不到權限按鈕（因為 polling 不偵測權限）
7. 等到超時
8. 去 IDE 看 → 發現 AI 在等你同意

---

## 修復優先級

| 優先級 | Bug | 修復難度 | 影響 |
|--------|-----|----------|------|
| 🔴 P0 | #1 Polling 沒有權限處理 | 中 | 直接導致功能失效 |
| 🔴 P0 | #2 useStreaming 永久 false | 低 | 一次失敗永久壞掉 |
| 🟡 P1 | #3 Timeout 不管權限等待 | 中 | 用戶來不及回應 |
| 🟡 P1 | #4 Replay 漏權限 | 中 | 邊界情況但可能觸發 |
| 🔵 P2 | #5 重複回應 | 高 | 需要更多 log |

---

## 經驗學習（Lessons Learned）

### 1. Fallback 路徑必須有同等功能

> **原則**: 當你有 A 路徑（streaming）和 B 路徑（polling）時，B 路徑必須支援 A 路徑的所有關鍵功能。

Polling fallback 被視為「降級但可用」的替代方案，但實際上它缺少了權限處理這個核心功能。Fallback 不是「能動就好」，而是「核心功能都要在」。

**行動**: 建立 fallback 時，列出所有 critical features，逐一確認 fallback 路徑都有覆蓋。

### 2. 模組級狀態切換要有恢復機制

> **原則**: 任何把系統切到降級模式的 flag，都必須有明確的恢復路徑。

`useStreaming = false` 一設就是永久的，沒有任何機制會把它設回 `true`。這相當於「一次失敗就永久殘廢」。

**行動**: 每個降級 flag 都要搭配：
- 重試機制（定時或事件觸發）
- 作用範圍限制（per-cascade 而非全域）
- 恢復條件（明確定義何時回到正常模式）

### 3. Timeout 策略要考慮人機互動

> **原則**: 當系統在等待人類操作時，機器的 timeout 不應該打斷人類。

120 秒的 timeout 對 AI 運算是合理的，但對「用戶看到 Telegram 通知 → 打開手機 → 閱讀權限請求 → 決定是否允許」這個人類流程來說太短了。

**行動**: Timeout 應區分「等 AI 回應」和「等人類操作」兩種模式，後者應大幅延長或完全暫停。

### 4. 每個 callback/handler 都要追蹤是否真的被調用

> **原則**: 傳入 callback 不代表 callback 會被調用。要有機制確認 critical callback 確實被觸發。

`onPermission` callback 被傳入 `sendToAI()`，但在 polling 路徑中被完全忽略。開發時容易假設「我傳了 callback，它就會被用到」，但 fallback 路徑可能根本不知道這個 callback 的存在。

**行動**:
- Critical callback 要有「未觸發」的告警機制
- 或用介面/型別約束確保所有路徑都處理必要的 callback

### 5. 測試要覆蓋 degraded mode

> **原則**: 不只測正常路徑，也要測降級路徑。

Streaming 正常時一切 OK，但 streaming 失敗後的 polling 路徑從沒被測試過權限功能。

**行動**: 測試矩陣應包含：
- ✅ Streaming + 權限 → OK
- ❌ Polling + 權限 → 從未測試 → Bug 潛伏

---

## 相關檔案

| 檔案 | 行數 | 相關 Bug |
|------|------|----------|
| `lib/rpc.js` | ~761 | #1, #2, #3, #4 |
| `lib/telegram.js` | ~1332 | 權限 UI 邏輯（本身正確） |
| `bridge.js` | ~72 | 入口（無直接 bug） |
| `CHANGELOG.md` | — | 記錄修復版本 |

---

## 修復紀錄

- [x] Bug #1: polling fallback 加入權限偵測 → v3.0 `pollResponse()` 加入 WAITING 偵測
- [x] Bug #2: `useStreaming` 改為 per-cascade → v3.0 `resetCascade()` 重置
- [x] Bug #3: 等權限時暫停/延長 timeout → v3.0 `permissionPending` + 10 分鐘上限
- [x] Bug #4: replay 權限追蹤 + 重新檢查 → v3.0 `replayedPermission` 機制
- [x] Bug #5: 重複回應 → v3.0 `replayBaseline` 過濾
- [x] v3.2: 改用 `StreamAgentStateUpdates`，串流內直接偵測 WAITING，不再依賴 polling 權限偵測
