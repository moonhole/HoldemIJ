# H5_SOLUTION

本文档描述当前 `apps/h5` 的实际方案与边界，不是早期规划稿。

## 1. 目标
- 提供可联调、可迭代的移动端德州客户端。
- React 负责业务 UI，Pixi 负责桌面渲染和动画。
- 协议走 protobuf，实时链路走 WebSocket。

## 2. 分层边界（已落地）

### 2.1 React（业务 UI）
- 文件入口：`apps/h5/src/ui/UiLayerApp.tsx`
- 主要职责：
  - 登录页（`LoginOverlay`）
  - 大厅操作层（`LobbyOverlay`）
  - 牌桌操作层（`ActionOverlay`）
  - 表单、按钮、错误提示、HUD 文案

### 2.2 Pixi（视觉层）
- 入口：`apps/h5/src/main.ts`
- 场景：
  - `LoginScene`
  - `LobbyScene`
  - `TableScene`
- 主要职责：
  - 桌布、座位、牌、筹码、倒计时桌布渲染
  - 发牌/下注/收池等动画

### 2.3 Store（双端消费）
- `gameStore`：消费服务端流事件（snapshot/action/pot/showdown/...）
- `uiStore`：场景与 quick start 状态
- `authStore`：登录态、token 生命周期
- React 和 Pixi 都消费 store，不再靠旧式 handler 互调。

## 3. 网络与协议
- 传输：protobuf binary over WebSocket
- 生成代码：`apps/h5/src/gen/messages_pb.*`
- 客户端网络层：`apps/h5/src/network/GameClient.ts`
  - 管理 WS、session token、重连、server clock offset
  - 对外事件回调再喂给 store

## 4. 登录流（当前）

### 4.1 HTTP 鉴权 API
- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/auth/me`

### 4.2 客户端流程
1. 启动先执行 `bootstrapAuthSession()`
2. token 可用 -> 进 `lobby`
3. token 不可用 -> 进 `login`
4. 登录成功后保存 token，再连接 `/ws?session_token=...`

## 5. 倒计时与动作
- 服务端 `ActionPrompt` 提供：
  - `time_limit_sec`
  - `action_deadline_ms`（绝对时间）
- 客户端通过 server time offset 计算剩余时间，减少本地时钟漂移影响。

## 6. 分辨率与适配
- 基线：iPhone 14 Pro Max（逻辑宽度 750）
- Pixi Stage 使用 contain 缩放，避免左右裁切
- DOM 叠层通过 `--stage-x/y/width/height` 与 Canvas 对齐

## 7. 本地运行

### 7.1 前端
```bash
pnpm dev
```
默认地址：`http://127.0.0.1:5173`

### 7.2 代理
- `/api` -> `http://127.0.0.1:18080`
- `/ws` -> `ws://127.0.0.1:18080`

## 8. 关键目录
- `apps/h5/src/main.ts`
- `apps/h5/src/network/GameClient.ts`
- `apps/h5/src/store/gameStore.ts`
- `apps/h5/src/store/uiStore.ts`
- `apps/h5/src/store/authStore.ts`
- `apps/h5/src/scenes/TableScene.ts`
- `apps/h5/src/ui/actions/ActionOverlay.tsx`
- `apps/h5/src/ui/lobby/LobbyOverlay.tsx`
- `apps/h5/src/ui/auth/LoginOverlay.tsx`

## 9. 近期迭代建议
1. 把登录后用户信息（昵称/头像）接进桌面与大厅展示。
2. 给 `authStore` 增加 refresh/失效重登策略。
3. 把 UI 文案做 i18n 抽离，避免散落在组件里。
