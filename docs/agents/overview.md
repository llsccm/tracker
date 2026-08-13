# 项目概览与重构进度

> 💡 当你需要了解项目整体模块结构、核心模块划分、功能保留/废弃状态以及当前重构进度时，请阅读本文档。
>
> **维护约定**：只写模块路径与职责，不绑定行号。

---

## 项目概览

- 本项目是"三国杀打小抄"浏览器用户脚本，基于 Vite 与 `vite-plugin-monkey` 构建。
- 主要入口：
  - `src/index.js`：用户脚本主入口，负责初始化 `window.SGSMODULE` 消息分发与生命周期调度。
- 当前保留范围：记牌器（`src/tracker/` 主动运行）、山河图信息展示、斗地主记牌、基础聊天输出兼容、本地设置、裴秀路线/地图辅助。
- 已清理/隔离范围：Laya 自动化、后端网络集成、皮肤/主题/壁纸/卡背自定义、报表、CDK、秒杀、签到、快捷语音、自动任务、自动托管、手牌自动化等非保留能力。
- 核心模块：
  - `src/dom.js`：DOM 入口协调层，负责注入界面、窗口、按钮、尺寸调整与生命周期；较大的 UI 辅助逻辑已拆入 `src/ui/`。
  - `src/ui/`：
    - `domHelpers.js`：tooltip/外链
    - `drag.js`：拖拽
    - `seatOverlay.js`：座位覆盖层
    - `shell.js`：主窗口 shell（含可见性快捷键绑定）
    - `frameContent.js`：注入 HTML 初始化
    - `CitiesUI.js`：山河图城市与商店 UI
    - `lifecycle.js`：生命周期辅助
    - `effect.js`：视觉效果辅助
    - `PeiXiuMapWindow.js`：裴秀地图窗口
    - `trackerVisibility.ts`：记牌器面板显隐与快捷键
    - 记牌器主面板渲染在 `src/tracker/view/`，不在本目录
  - `src/featureFlags.js`：保留能力标记与消息白名单（生命周期、聊天、山河图、牌局状态、记牌器核心消息）。
  - `src/logic.js`：游戏消息路由与记牌器核心编排；非保留消息先经白名单过滤。
  - `src/handler/`：协议处理器（由 `index.js` 统一导出主动路径）：
    - `chat.js`：聊天过滤、房间号链接化、重复消息与广播兼容。
    - `doudizhu.js`：斗地主记牌。
    - `StartGame.js`：开局/录像座位注册（`handleStartGame` / `handleRecordStartGame`）；当前 `logic` 主动接通的是录像座位旗标路径。
    - `MsgGameOver.js` / `MsgGameTurnNtf.js` / `GsCGamephaseNtf.js` / `GsCTriggerSpellNew.js`：结束、轮次、阶段、技能触发。
    - `PubGsCMoveCard.js`：移动协议预处理与同步到 `tracker`。
    - `gameFlowState.js`：开局发牌/摸牌局流副作用与权道展示等。
    - `specialZones.js` / `spellEffects.js`：特殊区域与技能辅助副作用。
    - `skills/`（如 `JiZhan.js`、`YanXi.js`）：从 `spellEffects` 拆出的技能特化处理。
    - `GsCRoleOptTargetNtf.js`：角色操作目标通知（严教、宜城、裴秀相关等）。
    - `RogueLike.js`：山河图消息与提示。
    - `legacyMoveCard.js`：遗留链表记牌器辅助，**不经** `index.js` 导出，不可当作运行路径。
    - `index.js`：主动导出入口。
  - `src/tracker/`：当前主动记牌器与运行时状态核心；详细边界见 [`card_tracker.md`](card_tracker.md)：
    - `index.ts`：仅导出 `globalConfig`、`globalState`、`rogueMap`、`UI`、`user`、`Game`。
    - `state.ts` / `configStore.ts` / `user.ts` / `userModel.ts` / `Game.ts` / `types.ts` / `traversalStats.ts`：配置代理、全局 UI、用户态、对局状态（`GameState` + `Game` 实例）、遍历插桩。
    - `Room.ts`：单局状态源；状态所有权、生命周期与行为模块边界见 [`room.md`](room.md)。
    - `Card.ts` / `BaseCard.ts` / `Player.ts` / `Zone.ts`：牌/玩家/公共区模型；字段与不变量见 [`card_player_model.md`](card_player_model.md)。
    - `ConstraintGroup.ts` / `AmbiguousKnownIndex.ts` / `CardLocationIndex.ts` / `CardCounter.ts`：约束与增量索引。
    - `MoveEventNormalizer.ts` / `protocolZones.ts`：移动归一化与协议区映射。
    - `roomConstraints.ts` / `roomPublicZones.ts` / `roomMovement.ts` + `roomMovement/*`：Room 行为拆分。
    - `candidate/*`：完整位置、子区、公共区、手牌槽、装备容器、暗置标记等候选模型。
    - `runtime/`（`bridge.ts` / `browser.ts` / `browserUserBinding.ts` / `moveEventHandlers.ts` / `trackerController.ts`）：可注入控制器与浏览器桥接。
    - `skill/`：Room 内技能装饰（如骋烈、诫厉）。
    - `helper/`：移动摘要、牌堆顺序。
    - `view/`：`index.ts`、`dirtyRenderState.ts`、`PlayerHandView.ts`、`QueryPanelView.ts`、`StatisticsView.ts`、`cardButton.ts`、`publicFieldCandidates.ts`。
  - `tests/tracker/`：Vitest 记牌器回归（导入边界、Controller、候选、索引、暗置标记、匿名实体、随机转移、脏渲染、遍历基线等）。
  - `tests/contracts/pile-identity/`：不接生产状态的牌堆身份纯模型、oracle 与长期语义契约。
  - `src/config/`：远端配置解析：
    - `ConfigBase.js` / `ConfigManager.js`
    - `CardConfig.js` / `SkillsConfig.js` / `CharacterConfig.js` / `RoguelikeConfig.js` / `SpellExtendConfig.js`
    - `vo/`：配置 VO（如山河图难度）
    - `index.js`：统一导出
  - `src/draw.js`：界面绘制、记牌器输出、山河图展示、聊天输出与剪贴板辅助；统一 re-export `src/draw/` 中的保留小抄函数。
  - `src/draw/`：按技能拆分的 `drawMiZhu.js`、`drawYanJiao.js`、`drawChengXiang.js`、`drawYiCheng.js` 及共用的 `drawHelpers.js`。
  - `src/runtime/gameAdapter.js`：安全读取 Laya/游戏对象的最小适配层。
  - `src/types/global.d.ts`：宿主与全局类型声明。
  - `src/utils/`：
    - `BackgroundWorker.js`：后台定时器
    - `chatRoomLink.js`：聊天房间号链接
    - `client.js` / `clipboard.js` / `logger.js`：客户端/剪贴板/日志
    - `errorNotifier.js`：错误捕获
    - `generalTip.js`：武将提示 Laya 文本覆盖（注意：仍 import 已不存在的 `trial.js`，属待清理残留）
    - `htmlResource.js`：远端 HTML 资源加载
    - `notification.js`：Toast 队列
    - `peixiuRouteFeature.js`：裴秀路线求解
    - `tavern.js`：酒馆兼容空实现
    - `date.js` / `timer.js` / `index.js`：日期、定时器与通用工具

---
