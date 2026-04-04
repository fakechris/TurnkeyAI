# Browser Relay Bridge v1

> 更新日期：2026-04-04  
> 目的：在现有 `BrowserBridge` / browser session runtime 基础上，为 `turnkeyai` 定义自己的浏览器端 relay bridge 协议、架构分层和最小实现范围。

## 1. 结论先说

当前 `turnkeyai` 已经有自己的 browser runtime contract，但还没有自己的 browser-side relay transport。

现状是：

- 上层 contract 已存在：`BrowserBridge`、`BrowserSession`、`BrowserTarget`、`BrowserTaskRequest`、`BrowserTaskResult`
- 当前 transport 只有本地 automation：`LocalChromeBrowserBridge -> ChromeSessionManager -> playwright-core`
- 设计上已经预留 `relay / direct-cdp / local` 三类 transport，但代码里没有真正的 `relay-adapter`

因此，这份设计的目标不是重做 browser runtime，而是：

1. 保留现有 session / target / ownership / replay / recovery 模型
2. 把 relay 作为第二种 transport 接进现有 runtime
3. 明确浏览器端 bridge 层由谁负责什么
4. 让未来的桌面端、已登录浏览器接管、手动接力、验证码/SSO 场景有稳定落点

一句话定义：

> `Browser Relay Bridge v1` 是 `turnkeyai` 自己的浏览器端 transport，不是第三方 relay 协议的直接镜像，也不是替换现有 local bridge 的重写工程。

## 2. 参考与取舍

这份设计参考了两类来源：

1. `accio` 时期已经成型的 browser runtime 边界
2. 现有 relay 类系统常见技术路径：浏览器扩展常驻、本地桌面守护、本地与扩展双向消息

保留的原则：

1. `role runtime -> worker runtime -> browser session runtime -> transport adapter`
2. browser session 是一等对象
3. transport 只是执行层，不是产品内核
4. runtime ownership、session/target/recovery 归本地 daemon 管
5. 浏览器端扩展只负责执行和观察，不负责业务编排

明确不采用的做法：

1. 不把第三方 relay 协议原样当内核
2. 不把 session/target 真相放到浏览器扩展里
3. 不让 content script 直接承担完整 orchestration
4. 不让上层 runtime 直接依赖特定浏览器扩展的内部实现细节

## 3. 设计目标

`Browser Relay Bridge v1` 只解决下面 6 个问题：

1. 接管用户已经打开、已经登录的真实浏览器 tab
2. 让本地 daemon 可以稳定识别 browser / window / tab / frame 的执行对象
3. 把 DOM snapshot、ref、action trace、console、screenshot 统一回流到现有 runtime
4. 在 relay transport 下保留现有 ownership / lease / resume / recovery 语义
5. 在用户手动接管和自动执行之间建立显式边界
6. 让 relay 和 local automation 可以在同一个 `BrowserBridge` contract 下并存

非目标：

1. v1 不做跨浏览器全支持，先只收 Chrome/Chromium 扩展
2. v1 不做完整多 frame 深度自动化
3. v1 不做“远端云浏览器” transport
4. v1 不让浏览器扩展直接运行 agent 或模型

## 3.1 Transport Support Matrix

不要把 `relay bridge` 理解成“支持一堆产品名”。更合理的分法是：

1. 我们原生支持哪些 transport category
2. 哪些第三方浏览器/runtime 可以作为某个 adapter 背后的实现
3. 哪些不该进入 v1 的一等范围

### v1 必做的一等 transport

| 类别 | transportMode | 优先级 | 为什么要支持 | 建议实现形态 |
| --- | --- | --- | --- | --- |
| Chrome Relay | `relay` | P0 | 接管用户真实浏览器、真实登录态、手动接力，这是 relay bridge 的本体价值 | `relay-adapter` + Chrome extension bridge |
| Direct CDP | `direct-cdp` | P0 | 直接连接本地或远端 Chromium/CDP endpoint，是最通用的自动化后备层 | `direct-cdp-adapter` |
| Local Automation | `local` | P0 | 当前已存在，最稳的回归、测试和本地控制执行层 | `local-automation-adapter` |

### v1.5 可以接入，但不是顶层协议类别

| 具体形态 | 应归属到哪一层 | 判断 |
| --- | --- | --- |
| Agent Browser | `direct-cdp` 或单独 `remote-browser-adapter` | 可以支持，但前提是提供稳定 CDP 或 browser control API |
| Hosted Chromium / Browser-as-a-Service | `direct-cdp` 或 `remote-browser-adapter` | 可以支持，但不应定义核心 bridge contract |
| Chrome relay-like hosted browser | `relay` 或 `remote-browser-adapter` | 可以兼容，但要映射到我们自己的 session/target/ownership |

### 暂不作为 v1 一等目标

| 具体形态 | 原因 | 处理方式 |
| --- | --- | --- |
| Camoufox | 更像浏览器发行版/anti-detect runtime，不是顶层 relay 协议 | 若兼容 Playwright/CDP，可作为 `local` 或 `direct-cdp` 背后实现 |
| `bbbrowser` 一类品牌化浏览器运行时 | 本质更像特定 provider，不适合变成核心协议分类 | 若暴露稳定 API/CDP，则适配成 provider-specific adapter |
| 其他品牌浏览器控制产品 | 不应该把 bridge 架构绑在某个品牌上 | 统一走 adapter，不进入 core runtime 抽象 |

### 设计约束

这张矩阵的含义是：

1. 核心协议类别只有少数几种：`relay / direct-cdp / local`
2. `Agent Browser`、`Camoufox`、`bbbrowser` 这些都不该变成顶层 transport enum
3. 它们如果值得支持，应该只是某个 adapter 背后的实现选择

换句话说：

> 我们支持的是 transport category，不是产品名目录。

## 4. 当前代码与目标代码的关系

当前关键代码：

- `BrowserBridge` 契约在 [team.ts](../../packages/core-types/src/team.ts)
- 当前 daemon 直接接本地 transport，在 [daemon.ts](../../packages/app-gateway/src/daemon.ts)
- 当前 transport 实现在 [local-chrome-browser-bridge.ts](../../packages/browser-bridge/src/local-chrome-browser-bridge.ts)
- 当前本地执行层在 [chrome-session-manager.ts](../../packages/browser-bridge/src/chrome-session-manager.ts)

目标关系：

1. 保留 `BrowserBridge` 对上接口
2. 新增 transport adapter 抽象
3. 把当前 `ChromeSessionManager` 收编为 `local-automation-adapter`
4. 新增 `relay-adapter`
5. 让 session runtime 统一调度两种 transport

也就是说：

- `BrowserBridge` 不变成“扩展 API”
- 扩展只是 `transport adapter` 的执行面
- session / target / replay / recovery 仍由本地 runtime 管

## 5. 总体架构

建议架构：

```text
role runtime
  -> worker runtime
    -> browser session runtime
      -> transport adapter
         -> local automation adapter
         -> relay adapter

relay adapter
  -> local relay gateway (daemon side)
    -> browser extension bridge
      -> extension service worker
      -> content script
      -> page probe / injected DOM helper
```

职责切分：

### 5.1 Browser Session Runtime

本地真相层，负责：

1. `BrowserSession` / `BrowserTarget` 生命周期
2. ownership / lease / resume mode
3. dispatch mode：`spawn / send / resume`
4. recovery / replay / history / artifact 回流
5. transport 选择与降级

### 5.2 Relay Adapter

本地 relay transport 适配层，负责：

1. 发现浏览器扩展连接
2. 把 browser action 转成 relay protocol message
3. 把浏览器端回传统一转换成 `BrowserTaskResult`
4. 维护 relay peer、tab、frame、port 的映射
5. 把 relay transport 的失败标准化为现有 failure taxonomy

### 5.3 Local Relay Gateway

本地 daemon 子组件，负责：

1. WebSocket 或 native messaging 会话
2. relay peer 注册、鉴权、心跳
3. 消息路由：session -> target -> relay peer
4. backpressure / timeout / reconnect

### 5.4 Browser Extension Bridge

浏览器端最小桥，负责：

1. 扩展侧会话登记
2. tab/frame 发现
3. content script 注入与存活
4. 执行动作和采集结果
5. 向本地 relay gateway 回传标准化事件

### 5.5 Content Script / Injected Probe

执行与观测层，负责：

1. DOM snapshot
2. ref 抽取
3. element 定位
4. click / type / scroll / selection
5. 局部 console / page-state 采集

不负责：

1. session 真相
2. ownership 判断
3. recovery 策略
4. operator 文案

## 6. 数据模型

现有模型继续保留：

- `BrowserSession`
- `BrowserTarget`
- `BrowserProfile`
- `BrowserTaskRequest`
- `BrowserTaskResult`
- `BrowserTransportMode = "relay" | "direct-cdp" | "local"`

需要新增的 relay 侧模型：

```ts
type RelayPeerId = string;
type RelayConnectionId = string;
type RelayTabId = string;
type RelayFrameId = string;

interface RelayPeer {
  relayPeerId: RelayPeerId;
  browserName: "chrome";
  extensionVersion: string;
  userAgent?: string;
  connectedAt: number;
  lastHeartbeatAt: number;
  capabilities: {
    domSnapshot: boolean;
    elementAction: boolean;
    screenshot: boolean;
    consoleProbe: boolean;
    fileDownloadProbe: boolean;
  };
}

interface RelayTargetBinding {
  browserSessionId: string;
  targetId: string;
  relayPeerId: RelayPeerId;
  relayTabId: RelayTabId;
  relayFrameId?: RelayFrameId;
  url: string;
  title?: string;
  attachedAt: number;
  lastSeenAt: number;
}

interface RelayExecutionContext {
  requestId: string;
  browserSessionId: string;
  targetId?: string;
  taskId: string;
  dispatchMode: "spawn" | "send" | "resume";
  actionCursor: number;
}
```

这些对象都不替代现有 `BrowserSession/BrowserTarget`，只作为 transport 绑定层。

## 7. 协议分层

协议建议分成 4 类消息：

1. peer lifecycle
2. target discovery / attach
3. action request / action result
4. event stream / heartbeat

### 7.1 Peer Lifecycle

```ts
type RelayHello = {
  type: "relay.hello";
  relayPeerId: string;
  browserName: "chrome";
  extensionVersion: string;
  capabilities: Record<string, boolean>;
};

type RelayHelloAck = {
  type: "relay.hello.ack";
  connectionId: string;
  serverTime: number;
};

type RelayHeartbeat = {
  type: "relay.heartbeat";
  relayPeerId: string;
  openTabs: number;
  activeTabId?: string;
  observedTargets?: Array<{
    relayTabId: string;
    url: string;
    title?: string;
  }>;
};
```

### 7.2 Target Discovery / Attach

```ts
type RelayDiscoverTargets = {
  type: "relay.targets.list";
  requestId: string;
};

type RelayAttachTarget = {
  type: "relay.target.attach";
  requestId: string;
  browserSessionId: string;
  targetId: string;
  relayTabId: string;
  expectedUrl?: string;
};

type RelayOpenTarget = {
  type: "relay.target.open";
  requestId: string;
  browserSessionId: string;
  url: string;
  preferredDisposition?: "current_tab" | "new_tab";
};
```

### 7.3 Action Request / Action Result

```ts
type RelayExecuteAction = {
  type: "relay.action.execute";
  requestId: string;
  browserSessionId: string;
  targetId: string;
  taskId: string;
  action: BrowserTaskAction;
  timeoutMs?: number;
};

type RelayActionResult = {
  type: "relay.action.result";
  requestId: string;
  browserSessionId: string;
  targetId: string;
  ok: boolean;
  actionKind: BrowserTaskAction["kind"];
  trace: BrowserActionTrace;
  snapshot?: BrowserSnapshotResult;
  screenshotPath?: string;
  artifactIds?: string[];
  error?: {
    code:
      | "target_not_found"
      | "tab_closed"
      | "permission_denied"
      | "content_script_unavailable"
      | "element_not_found"
      | "navigation_timeout"
      | "bridge_disconnected"
      | "unknown";
    message: string;
  };
};
```

### 7.4 Event Stream

```ts
type RelayTargetEvent = {
  type: "relay.target.event";
  relayPeerId: string;
  relayTabId: string;
  event:
    | "tab_opened"
    | "tab_updated"
    | "tab_closed"
    | "content_ready"
    | "content_lost";
  url?: string;
  title?: string;
  recordedAt: number;
};
```

## 8. 浏览器端 bridge 层设计

浏览器端建议拆三层：

### 8.1 Extension Service Worker

负责：

1. 与本地 daemon 建立长连接
2. 接收 attach/open/action 消息
3. 跟踪 tab / frame / content script 存活
4. 维护 `relayTabId -> chrome.tabId`
5. 处理权限、安装状态、版本协商

### 8.2 Content Script

负责：

1. 在页面上下文执行 DOM 查询和动作
2. 采集 snapshot / text / ref
3. 做轻量 element resolution
4. 回传执行结果和 probe

### 8.3 Injected Page Probe

仅在必要时使用，负责：

1. 获取更稳定的 DOM/selection 视图
2. 规避 isolated world 与真实页面上下文差异
3. 对复杂输入、富文本、局部 selection 做补充探测

v1 原则：

- 默认以 content script 为主
- 只有遇到上下文隔离问题时才用 injected probe
- 不在 injected 层放复杂业务逻辑

## 9. 与现有 local bridge 的统一抽象

建议在 `packages/browser-bridge/src/transport/` 下新增：

```text
transport/
  transport-adapter.ts
  local-automation-adapter.ts
  relay-adapter.ts
  relay/
    relay-gateway.ts
    relay-peer-registry.ts
    relay-target-registry.ts
    relay-message-codec.ts
```

抽象接口建议：

```ts
interface BrowserTransportAdapter {
  readonly mode: BrowserTransportMode;

  canAttach(input: {
    browserSessionId: string;
    targetId?: string;
    preferredOwnerType: BrowserOwnerType;
    preferredOwnerId: string;
  }): Promise<boolean>;

  spawn(input: BrowserSessionSpawnInput): Promise<BrowserTaskResult>;
  send(input: BrowserSessionSendInput): Promise<BrowserTaskResult>;
  resume(input: BrowserSessionResumeInput): Promise<BrowserTaskResult>;

  openTarget(input: {
    browserSessionId: string;
    targetId?: string;
    url: string;
  }): Promise<BrowserTarget>;

  listObservedTargets(input?: {
    ownerType?: BrowserSessionOwnerType;
    ownerId?: string;
  }): Promise<BrowserTarget[]>;
}
```

抽象要求：

1. local 和 relay 都产出同形态 `BrowserTaskResult`
2. local 和 relay 都服从同一 `BrowserSessionManager`
3. recovery / replay 不关心 transport 细节

## 10. Target 与 ownership 语义

relay transport 下，最容易出错的是“用户浏览器里的 tab 真相”和“runtime target 真相”混淆。

必须坚持：

1. `BrowserTarget.targetId` 是 runtime id
2. `relayTabId` / `chrome.tabId` 只是 transport id
3. target ownership 决策在本地 runtime，不在扩展里
4. 扩展只报告 tab/frame 状态，不裁决 ownership

因此 attach 规则建议是：

1. daemon 先决定要 attach 哪个 runtime target
2. relay adapter 再把它绑定到某个 observed tab
3. 若 tab 已被手动切走或关闭，返回标准化 failure
4. recovery runtime 再决定是 reconnect、reopen、new_target 还是 waiting_manual

## 11. 动作范围

v1 只支持这组动作：

1. `open`
2. `snapshot`
3. `click`
4. `type`
5. `scroll`
6. `console`
7. `screenshot`

原因：

- 这与现有 local bridge 对齐
- replay / verifier / failure taxonomy 已能理解这些动作
- 不应该在引入 relay transport 时同时扩动作面

## 12. 安全与权限

relay bridge 必须额外处理 5 类边界：

1. 哪些页面允许注入 content script
2. 哪些目标站点允许自动动作
3. daemon 与 extension 的本地连接如何鉴别来源
4. 用户手动接管时怎样让 runtime 进入 `waiting_manual`
5. 哪些数据可以回流 artifact/replay，哪些只能本地瞬时使用

v1 最小安全策略：

1. 只允许本地 loopback 连接
2. 连接建立时做一次随机会话 token 握手
3. content script host permissions 先收窄，不做 `<all_urls>` 无边界开放
4. screenshot / DOM snapshot 默认走现有 artifact store
5. 对敏感页面允许返回“可见但不自动执行”的 gate

## 13. Recovery 与 operator 语义

relay transport 不能只关心“动作是否成功”，还必须回流 operator 能理解的失败。

v1 需要标准化这些 relay failure：

1. 扩展未连接
2. target tab 关闭
3. content script 不可用
4. 页面权限不足
5. element ref 失效
6. 用户手动切走导致 attach 失效
7. 本地 relay 连接断开

这些失败都要能落回现有：

- failure taxonomy
- replay bundle
- recovery next action
- operator triage

建议默认映射：

1. `content_script_unavailable` -> `fallback_transport` 或 `inspect_then_resume`
2. `bridge_disconnected` -> `retry_same_layer`
3. `tab_closed` -> `fallback_transport` 或 `new_target`
4. `permission_denied` -> `request_approval`
5. `user_interference / manual_takeover` -> `waiting_manual`

## 14. rollout 方案

不要一步到位。建议按 4 个阶段推进：

### Phase A. Transport Refactor

目标：

- 抽出 `BrowserTransportAdapter`
- 让当前 local chrome 实现迁到 `local-automation-adapter`

交付：

1. adapter 抽象
2. 兼容现有测试
3. daemon 仍默认走 local

### Phase B. Relay Skeleton

目标：

- 加最小 relay gateway 和扩展骨架

交付：

1. extension service worker
2. daemon-side relay gateway
3. `relay.hello / heartbeat / target.list`

### Phase C. Action Parity

目标：

- 让 relay transport 跑通 `open / snapshot / click / type / scroll`

交付：

1. attach/open 流程
2. snapshot/ref 回流
3. trace/result 标准化

### Phase D. Recovery / Operator Integration

目标：

- relay transport 的失败和恢复进入现有 operator/replay 主线

交付：

1. recovery mapping
2. replay continuity 显示 transport=relay
3. operator triage 能识别 relay-specific failure

## 15. 为什么这层值得做

做这层不是为了“再造一个扩展”，而是因为它会解决现有 local automation 无法自然解决的场景：

1. 接管真实用户浏览器和真实登录态
2. 更自然的人机接力
3. 更贴近桌面产品的伴随式使用
4. 把 browser runtime 从“自动化专用”推进到“真实工作浏览器 transport”

如果不做：

- browser runtime 仍偏测试友好、自动化友好
- 但对真实生产使用场景，特别是登录态、手动接管、长期挂起，会始终存在割裂

## 16. 最终建议

建议把这层作为一个明确的新 workstream：

`Browser Transport v1: local automation parity + relay transport skeleton`

优先级判断：

1. 它比 Electron 更该先做
2. 它比 Phase 2 kernel lift 更贴近真实产品价值
3. 但它不该打断当前 release / acceptance / soak 主线

因此推荐顺序是：

1. 先完成真实 release 闭环
2. 同时把 `transport-adapter` 抽象落代码
3. 再实现 relay skeleton
4. 最后再做 browser-side relay action parity
