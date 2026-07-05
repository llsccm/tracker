# 项目概览与重构进度

> 💡 当你需要了解项目整体模块结构、核心模块划分、功能保留/废弃状态以及当前重构进度时，请阅读本文档。

---

## 项目概览

- 本项目是"三国杀打小抄"浏览器用户脚本，基于 Vite 与 `vite-plugin-monkey` 构建。
- 主要入口：
  - `src/index.js`：用户脚本主入口，负责初始化 `window.SGSMODULE` 消息分发与生命周期调度。
- 当前保留范围：记牌器（`src/tracker/` 已完全切换为主动运行模式）、山河图信息展示、斗地主记牌、基础聊天输出兼容、本地设置。
- 已清理/隔离范围：Laya 自动化、后端网络集成、皮肤/主题/壁纸/卡背自定义、报表、CDK、秒杀、签到、快捷语音、自动任务、自动托管、手牌自动化等非保留能力。
- 核心模块：
  - `src/dom.js`：DOM 入口协调层，负责注入界面、窗口、按钮、尺寸调整与生命周期；较大的 UI 辅助逻辑已拆入 `src/ui/`。
  - `src/ui/`：tooltip/外链（`domHelpers.js`）、拖拽（`drag.js`）、座位覆盖层（`seatOverlay.js`）、主窗口 shell（`shell.js`）、注入 HTML 初始化（`frameContent.js`）、山河图城市与商店 UI 渲染（`CitiesUI.js`）、生命周期辅助（`lifecycle.js`）与部分视觉效果辅助（`effect.js`）。记牌器主面板渲染已迁至 `src/tracker/view/`。
  - `src/featureFlags.js`：保留能力标记与消息白名单，按生命周期、聊天、山河图、牌局状态、记牌器核心消息分组。
  - `src/logic.js`：游戏消息路由与记牌器核心编排；非保留消息先经白名单过滤。
  - `src/handler/`：消息处理器模块，从 `src/logic.js` 重构抽离的核心协议处理器：
    - `chat.js`：聊天过滤、房间号链接化、重复消息处理与 `INFO:` 兼容逻辑。
    - `doudizhu.js`：斗地主记牌器消息处理。
    - `StartGame.js` / `MsgGameOver.js` / `MsgGameTurnNtf.js` / `GsCGamephaseNtf.js` / `GsCTriggerSpellNew.js`：对局开始、结束、轮次、阶段与技能触发消息处理。
    - `PubGsCMoveCard.js`：`PubGsCMoveCard` 消息处理、位置归一化、`CardIDs` 修正、技能辅助副作用保留，并将移动事件同步到 `src/tracker/bridge.ts` 当前 `Room`。
    - `GsCRoleOptTargetNtf.js`：张菖蒲严教、刘辟易城等技能/角色操作目标通知消息处理。
    - `RogueLike.js`：山河图（Roguelike）消息处理与小抄提示。
    - `legacyMoveCard.js` 与 `old/`：遗留链表记牌器辅助文件，仍保留在仓库中但不经 `src/handler/index.js` 主动导出，普通运行路径不应依赖它们。
    - `index.js`：统一导出入口。
  - `src/tracker/`：当前主动运行的记牌器与运行时状态核心，已经替代旧 `src/refactor/` 和旧 `src/context/` 主动实现；详细边界、历史设计与验证清单见 [`card_tracker.md`](card_tracker.md)：
    - `index.ts`：仅导出共享运行时状态入口（`globalConfig`、`globalState`、`rogueMap`、`UI`）、`user` 与 `Game`；底层核心对象需要从各自子模块直接导入。
    - `state.ts` / `configStore.ts` / `user.ts` / `userModel.ts` / `gameState.ts` / `Game.ts` / `types.ts` / `traversalStats.ts`：本地设置代理、全局 UI 状态、用户态、对局生命周期、回合阶段与战法计数兼容层，以及遍历计数插桩与类型定义。
    - `Room.ts`：单局状态源，持有物理牌池、玩家、公共区域、计数器、局部约束组、增量索引、增量快照和脏变更记录。
    - `Card.ts` / `BaseCard.ts` / `Player.ts` / `Zone.ts`：物理牌实例、玩家手牌额度、公共有序区域、公共候选位置与候选席位状态模型。
    - `ConstraintGroup.ts` / `AmbiguousKnownIndex.ts` / `CardLocationIndex.ts` / `CardCounter.ts`：局部候选包约束，以及模糊明牌反查、区域投影与查询计数的增量索引。
    - `MoveEventNormalizer.ts` / `protocolZones.ts`：移动事件归一化与协议区域映射。
    - `roomConstraints.ts` / `roomPublicZones.ts`：`Room` 挂载的约束和公共区行为模块。
    - `roomMovement.ts` 与 `roomMovement/`（`candidates.ts` / `hiddenMarks.ts` / `sources.ts` / `types.ts`）：`Room` 挂载的移动行为模块及其子模块，负责来源查找、候选传播、暗置标记账本和移动类型定义。
    - `candidate/`（`locationCandidate.ts` / `subZoneCandidate.ts` / `publicCandidate.ts` / `handSlotCounts.ts` / `cardPositions.ts` / `equipmentMarkContainer.ts` / `hiddenMarkMove.ts` / `markSpellID.ts`）：位置候选、子区候选、公共候选、手牌槽位统计与各类特化候选位置模型。
    - `runtime/`（`bridge.ts` / `browser.ts` / `browserUserBinding.ts` / `moveEventHandlers.ts` / `trackerController.ts`）：可注入运行时依赖的记牌器控制器与浏览器桥接，负责 `trackerRoom` 生命周期、协议同步、明牌输入与视图调度。
    - `skill/`（`ChengLie.ts` / `JieLi.ts`）：技能特化处理器。
    - `helper/`（`moveSummary.ts` / `pileOrder.ts`）：移动摘要与牌堆顺序辅助。
    - `view/`：包含 `index.ts`、`dirtyRenderState.ts` 与各个组件视图（`PlayerHandView.ts`、`QueryPanelView.ts`、`StatisticsView.ts`、`cardButton.ts` 、`publicFieldCandidates.ts`），负责主面板与覆盖层的 DOM 渲染与脏变更控制。
  - `tests/tracker/`：Vitest 记牌器回归测试，覆盖导入边界、Controller、位置候选、公共候选、位置索引与暗置标记候选。
  - `src/config/`：远端配置解析系统：
    - `ConfigBase.js`：配置解析基类，提供缩写映射与解析框架。
    - `ConfigManager.js`：配置管理器，从远端加载 Config_w.sgs 并分发到各配置解析器。
    - `CardConfig.js`：卡牌配置解析（花色、点数、名称映射）。
    - `SkillsConfig.js`：技能配置解析。
    - `CharacterConfig.js`：武将配置解析。
    - `RoguelikeConfig.js`：山河图（Roguelike）配置解析（城市、战法、卡牌、武将等）。
    - `index.js`：统一导出入口。
  - `src/draw.js`：界面绘制、记牌器输出、山河图展示、聊天输出与剪贴板辅助逻辑；严教、糜竺、称象、宜城属于保留的记牌辅助小抄函数。
  - `src/runtime/gameAdapter.js`：最小运行时适配层，封装保留功能所需的安全 Laya/游戏对象读取。
  - `src/utils/`：工具模块集合：
    - `BackgroundWorker.js`：后台定时器增强系统，解决浏览器后台限制问题。
    - `chatRoomLink.js`：聊天房间号提取与链接生成。
    - `errorNotifier.js`：脚本错误捕获与记录。
    - `generalTip.js`：武将提示 Laya 文本覆盖。
    - `htmlResource.js`：外部 HTML 资源加载（界面 HTML 从远端加载，替代旧的构建时 HTML 转 JS 方案）。
    - `notification.js`：Toast 通知队列系统。
    - `trial.js`：高级功能试用体系（灼魂、权御、裴秀小抄）。
    - `tavern.js`：酒馆状态兼容空实现（已收缩）。
    - `date.js`、`timer.js`：日期与定时器工具。
    - `index.js`：通用工具（`idleCallback`、`retry`、`wait` 等）。

---
