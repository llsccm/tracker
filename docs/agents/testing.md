# 测试与验证策略

> 当你需要为改动选择验证命令、补充回归测试、理解现有测试布局，或做手工验收时，请阅读本文档。
>
> 记牌器领域风险与特殊边界见 [`card_tracker.md`](card_tracker.md)；命令执行细节见 [`commands.md`](commands.md)。

---

## 当前测试版图

- 测试运行器：Vitest（`vitest.config.js`）
- 环境：`node`
- 包含范围：`tests/**/*.test.{js,ts}`
- 覆盖率配置：默认关注 `src/tracker/**/*.{js,ts}`，排除 `src/tracker/view/**`
- 现状：
  - 已有较完整的记牌器单元/回归：`tests/tracker/`
  - 已有少量外围工具测试：`tests/utils/peixiuRouteFeature.test.js`
  - **没有**通用 `pnpm test` 脚本；记牌器专用脚本是 `pnpm test:tracker`（只跑 `tests/tracker`）
  - **没有**浏览器 E2E / 用户脚本注入自动化

### 主要目录

| 路径                     | 覆盖重点                                              |
| ------------------------ | ----------------------------------------------------- |
| `tests/tracker/`         | Room 移动、候选、收敛、Controller、脏渲染、遍历基线等 |
| `tests/tracker/helpers/` | 测试夹具与 noop runtime/view                          |
| `tests/utils/`           | 非 tracker 工具逻辑，如裴秀路线                       |

### 现有 tracker 回归主题（按文件名归类）

- 导入边界：`room.import.test.ts`、`state-user.import.test.ts`
- 控制器与协议路由：`trackerController.test.ts`、`moveCardRoutes.test.ts`、`moveEventNormalizer.test.ts`
- 候选与位置：`locationCandidates.test.ts`、`publicCandidates.test.ts`、`publicFieldCandidates.test.ts`、`locationIndex.test.ts`、`cardLocationIndexIncremental.test.ts`
- 约束与收敛：`convergenceTermination.test.ts`、`resolveConstraintsIncrementalIndex.test.ts`、`ambiguousKnownIndexIncremental.test.ts`
- 暗牌 / 标记 / 随机转移：`hiddenMarkCandidates.test.ts`、`randomTransferLifecycle.test.ts`、`handCountObservation.test.ts`、`playerHandMirror.test.ts`
- 局流与技能副作用：`gameFlowState.test.ts`、`spellEffects.test.ts`、`roleOptTargetNtf.test.ts`
- 视图与展示：`viewDirtyRender.test.ts`、`pileDisplayOrder.test.ts`、`suitGlyph.test.ts`
- 性能护栏：`traversalBaseline.test.ts`
- 计数器：`cardCounter.test.ts`
- 日志：`moveEventLogging.test.ts`

---

## 常用命令

```sh
pnpm test:tracker
pnpm typecheck:tracker
pnpm typecheck
pnpm lint
pnpm build
pnpm build:prod
```

补充：

- 跑全部 Vitest 匹配文件（含 `tests/utils`）：

```sh
pnpm exec vitest run
```

- 单文件 / 关键字：

```sh
pnpm exec vitest run tests/tracker/locationCandidates.test.ts
pnpm exec vitest run -t "shuffle"
```

- 更新遍历基线快照（仅在解释清楚数字变化后）：

```sh
pnpm exec vitest run tests/tracker/traversalBaseline.test.ts -u
```

- 覆盖率（可选，关注 tracker 核心）：

```sh
pnpm exec vitest run --coverage
```

Windows 本机执行时遵循 [`commands.md`](commands.md) 与 Serena 本机记忆；仓库文档不绑定具体 Shell 细节。

---

## 何时跑什么

| 改动范围                                                   | 最低验证                                                        |
| ---------------------------------------------------------- | --------------------------------------------------------------- |
| 仅文档 / 注释                                              | 无需构建与测试                                                  |
| 普通 `src/` 代码（非 tracker 高风险）                      | `pnpm lint` + `pnpm build`                                      |
| `src/tracker/` 或 `tests/tracker/`                         | `pnpm lint` + `pnpm build` + `pnpm test:tracker`                |
| TS 类型契约、`tsconfig*`、ESLint TS 覆盖、tracker 类型迁移 | `pnpm typecheck:tracker`；需要确认全仓入口时再 `pnpm typecheck` |
| `tests/utils/` 或非 tracker 测试                           | `pnpm exec vitest run`（或对应文件）+ 适用 lint/build           |
| 发布配置、打包参数、用户脚本元信息、核心协议高风险路径     | 额外 `pnpm build:prod`                                          |
| 修改 `html/iframe.html` / 远端配置加载                     | 本地 dev 注入验收 + 确认远端部署流程                            |
| Serena 记忆                                                | `serena memories check`                                         |

CI（`.github/workflows/ci.yml`）在 `dev` / `main` 的 PR 与 push 上会跑：`lint`、`typecheck`、`test:tracker`、`build`；`main` 的 push 额外 `build:prod`。本地提交前尽量对齐，避免只靠 CI 兜底。

---

## 什么时候必须补测试

优先补自动化测试，而不是只写“本地看过”：

1. **记牌器状态机**
   - `Room.moveCards()` 新路线或边界组合
   - 候选模型：`locationCandidates` / 公共候选 / 座位投影
   - `resolveConstraints()` 收敛、触碰座位、终止条件
   - 洗牌、暗占位、暂停追踪、暗置标记账本
   - 随机手牌转移、跨座位候选
2. **协议归一化**
   - `MoveEventNormalizer`、zone 映射、特殊 `FromID` / `MoveType`
   - handler 预处理改变 tracker 输入语义时
3. **增量索引 / 性能路径**
   - `CardLocationIndex`、`AmbiguousKnownIndex`、player 快照
   - 任何新增全牌池扫描：必须 `recordTraversal(...)` 插桩，并更新 `traversalBaseline` 场景
4. **可见但可单测的纯逻辑**
   - 计数器、展示顺序、花色 glyph、裴秀路线求解
5. **回归过的 bug**
   - 每个已修复的协议/收敛缺陷，尽量留最小复现测试

可以先不强制自动化、但需要手工验收的：

- 真实浏览器注入、Tampermonkey 权限/匹配
- iframe HTML 布局、拖拽、快捷键手感
- 远端 `Config_w.sgs` / HTML 资源加载
- 录像 UI 与宿主页面耦合行为

---

## 编写测试的约定

- 新测试放在与主题接近的现有文件；新主题再开 `tests/<area>/*.test.ts`
- 优先复用 `tests/tracker/helpers/`，避免每个用例重复搭 Room / Controller
- 测试名写清场景与期望，例如“洗牌 cardCount 大于本地枚举时补 id=0 暗占位”
- 断言关注**可观察状态**：owner、locationCandidates、手牌额度、公共区顺序、脏集合、遍历计数；少断言实现细节私有字段
- 不要依赖真实 DOM / Laya；需要视图时用 helper 中的 noop 或最小 stub
- 保持与源码一致的风格：2 空格、LF、单引号、无分号（Prettier）
- Style Guide 同样适用于测试：优先 `const`、early return、避免别名导入
- 不为了过测试削弱生产断言；必要时拆“可注入依赖”而不是删护栏

### 遍历基线特别规则

- `tests/tracker/traversalBaseline.test.ts` 是性能回归护栏，不是普通业务断言
- 结构性优化导致数字下降：可更新快照，并在 PR 说明收益场景
- 无关改动导致数字上升：先解释原因；不能无说明地 `-u`
- 新增必要全量扫描：先问能否改增量；若必须全量，插桩 + 基线场景同步落地

领域风险细则仍以 [`card_tracker.md`](card_tracker.md) 的「风险与验证清单」为准。

---

## 建议的测试分层

```text
L0 静态检查     lint / typecheck
L1 单元回归     tests/tracker + tests/utils
L2 构建产物     pnpm build / build:prod
L3 手工注入验收 浏览器 / 微端真实页面
```

当前仓库自动化主要覆盖 L0–L2 中的 tracker 与构建；L3 仍靠开发者手工。

---

## 手工验收清单

改到对应能力时，至少覆盖相关项。不必每次全做，但 PR 应写明做了哪些。

### 脚本注入与壳

- [ ] 匹配站点可注入；排除站点不注入
- [ ] 刷新后无重复面板 / 无残留 DOM
- [ ] 主窗口可显示、隐藏、拖拽；显隐快捷键有效
- [ ] 窗口缩放后座位覆盖与面板位置仍可用

### 记牌器核心

- [ ] 开局/录像开局后座位与主视角正确
- [ ] 摸牌、弃牌、置入装备/判定区后计数与展示正确
- [ ] 暗牌移动后候选合理，不出现错误 owner 实锤
- [ ] 洗牌后牌堆张数、顶底候选、暗标记账本不漂
- [ ] 玩家来源明牌残留公共区时占位回补正确
- [ ] 手牌暗置标记区的多选一/多选多场景保守可收敛
- [ ] 对局结束或离桌后状态清理，不开下一局串数据
- [ ] 高频出牌时面板无明显闪烁或节点丢失

### 外围能力

- [ ] 斗地主：先手/身份相关展示与记牌不互相覆盖错误
- [ ] 山河图：提示与城市/商店信息可显示
- [ ] 裴秀：地图窗口、路线与花色统计与协议输入一致
- [ ] 聊天过滤：重复/跑马灯等过滤开关行为符合设置
- [ ] 本地设置项修改后可持久化，并触发预期刷新

### 发布相关

- [ ] `pnpm build:prod` 产出 `daxiaochao.user.js` / `daxiaochao.meta.js`
- [ ] 用户脚本 version、match、updateURL/downloadURL 符合预期（生产模式）

---

## PR 中如何写验证

沿用：

```md
## 验证

- 命令：`pnpm test:tracker`、`pnpm lint`、`pnpm build`
- 手工：开局摸牌、洗牌后顶底候选、主视角切换
- 未跑：`build:prod`（未改打包配置）
```

要求：

- 写实际跑过的命令，不写“应通过”
- 跳过项说明原因
- 修复类附复现路径与回归测试文件名
- 若更新了 `traversalBaseline` 快照，写清前后差异与原因

---

## 已知缺口（文档同步点）

以下是当前策略上的诚实缺口，后续补齐时应同步改本文件：

- 无通用 `pnpm test`；`test:tracker` 不包含 `tests/utils`
- 浏览器注入 / 用户脚本 E2E 未建立
- `Room.moveCards()` 组合路线与技能精细推断仍有覆盖空洞
- UI 视图层默认不在 coverage include 的核心关注内
- 外围功能（聊天、山河图、设置）自动化很少，主要靠手工

---

## 相关文档

- [`conventions.md`](conventions.md)：何时 lint/build/typecheck，以及 PR 验证写法
- [`card_tracker.md`](card_tracker.md)：记牌器风险清单与领域回归重点
- [`lifecycle.md`](lifecycle.md)：开局、移动、结束等运行时路径
- [`environment.md`](environment.md)：脚本与环境入口
- [`commands.md`](commands.md)：终端执行约定
