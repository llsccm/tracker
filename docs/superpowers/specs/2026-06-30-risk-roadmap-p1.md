# P1 状态一致性 — 详细设计

> 📅 2026-06-30 | 父文档：[`总览`](2026-06-30-risk-roadmap-overview.md)
>
> 解决风险：R4 状态一致性边缘情况 / R5 候选系统四套并行 / R7 视图整区重绘
>
> 前置条件：P0 完成（咽喉拆分 + 测试安全网就绪）

---

## 目标

加固状态推断的边缘情况、推进候选系统从四套投影收敛到单一主模型、防止高频消息下的视图闪烁。

---

## P1-1: 洗牌与暗置标记回归加固

### 当前风险

`docs/agents/card_tracker.md` 风险与验证清单明确标注了以下高风险路径：

1. 洗牌时协议 `cardCount` 与本地可枚举牌堆不一致
2. 暗置标记候选的 4 选 1 / 4 选 2 / 4 选 3 多场景
3. `resolveConstraints()` 三类收敛的边界交互
4. `publicCandidates` 与 `ConstraintGroup`、`AmbiguousKnownIndex` 的边界

### 需补齐的测试矩阵

#### 洗牌路径

| 场景 | 协议张数 | 本地可枚举 | 预期行为 |
|------|---------|-----------|---------|
| 精确匹配 | 30 | 30 | 正常洗牌，顺序保留 |
| 协议多于本地 | 35 | 30 | 补 5 个 id=0 暗占位在前 |
| 协议少于本地 | 25 | 30 | 5 个正 ID 暂停追踪为场上候选 |
| 暗标记占位被洗 | 30 | 30（含 2 暗标记占位） | 创建新 id=0 暗标记占位替换账本引用 |

#### 暗置标记候选

| 场景 | 明牌数 | 暗牌数 | 暗置数 | 预期约束 |
|------|-------|-------|-------|---------|
| 全明无暗 | 4 | 0 | 1 | 精确约束 手牌=3 标记=1 |
| 全明多暗置 | 4 | 0 | 3 | 精确约束 手牌=1 标记=3 |
| 混有暗牌 | 2 | 2 | 2 | 只记录不创建强约束 |
| 叠加跨角色 | 2（A/B 候选） | 0 | 1 | 追加目标标记候选，不丢跨角色候选 |
| 木马容器 | 4 | 0 | 1 | container:equipment:161:700 精确约束 |
| 逐张明置 | - | - | - | 确认占用对应名额 |

#### resolveConstraints 收敛

| 场景 | 预期行为 |
|------|---------|
| seats.size === 1 | 自动确认 owner |
| ConstraintGroup 期望值达到 | 局部剔除对应席位 |
| 玩家确定明牌占满已知手牌数 | 全局剔除该席位的候选手牌明牌 |
| 三类收敛交叉 | 不会互相干扰导致过度收敛 |

### 验收条件

- [x] 洗牌路径 4 种场景全覆盖
- [x] 暗置标记候选 6 种场景全覆盖
- [x] resolveConstraints 收敛 4 种场景全覆盖
- [x] 现有测试不受影响：`pnpm test:tracker` 全绿

---

## P1-2: 候选系统迁移推进

### 当前状态

`src/tracker/Card.ts` 已收敛为以 `locationCandidates` 为唯一候选主模型：

| 系统 | 用途 | 状态 |
|------|-----|------|
| `locationCandidates` | 完整位置候选主模型 | ✅ 主模型 |
| `subZoneCandidates` | 玩家区完整位置候选（三元组） | ✅ 只读兼容投影 |
| `publicCandidates` | 牌堆顶/底候选位置 | ✅ 只读公共区投影 |
| `seats` | 座位投影 | ✅ 只读座位投影 |

### 迁移路线

分 3 步收敛，每步配套回归测试确保行为不变：

**步骤 1：将 `subZoneCandidates` 完全由 `locationCandidates` 驱动**

- [x] `subZoneCandidates` 变为 `locationCandidates` 的只读计算属性
- [x] 所有写入操作统一走 `locationCandidates`
- [x] `syncLegacyCandidatesFromLocationCandidates()` 保留为候选变化后的兼容同步入口

**步骤 2：将 `seats` 完全由 `locationCandidates` 驱动**

- [x] `seats` 变为 `locationCandidates` 的只读座位投影
- [x] `setSeats()` 改为通过 `locationCandidates` 过滤或生成候选实现
- [x] `syncOwnerFromSeats()` 改为从候选座位投影推导 owner

**步骤 3：评估 `publicCandidates` 合并可行性**

- [x] `publicCandidates` 已统一为 `locationCandidates(type: public)` 的只读投影
- [x] 确定公共区位置仍由 `Card.location` + `Zone` 表达
- [x] 公共区候选仅表达牌堆顶/底等不确定候选位置

### 验收条件

- [x] `subZoneCandidates` 成为只读投影，无独立写入路径
- [x] `seats` 成为只读投影，无独立写入路径
- [x] `publicCandidates` 边界已明确并合并为只读公共区投影
- [x] 所有现有测试通过
- [x] 新增候选迁移专项回归测试

---

## P1-3: 视图防闪烁

### 当前问题

- `src/tracker/view/index.ts` 的 `flushRender()` 执行整区重绘
- `Room` 已有 `dirtyCards` 和 `viewDirty` 脏变更记录，但视图层尚未消费
- 高频 `PubGsCMoveCard` 消息下，每帧重绘整个手牌和公共区会导致闪烁

### 改进方案

#### 阶段性优化（P1 范围）

1. **消费 dirtyCards**：`flushRender()` 检查 `room.dirtyCards`，只重绘变更涉及的玩家手牌区
2. **消费 viewDirty**：只在 `viewDirty` 标记为 true 时重绘统计和查询面板
3. **跳过无变更帧**：如果 `dirtyCards` 为空且 `viewDirty` 为 false，跳过整个渲染

#### 不在 P1 范围的优化

- 虚拟 DOM 或 DOM diff（过度工程化，留到 P3）
- 单卡粒度增量更新（需要更精细的脏变更追踪，留到 P3）

### 验收条件

- [x] `flushRender()` 消费 `dirtyCardEvents` 和 `viewDirty`
- [x] 无变更帧不执行 DOM 操作
- [x] 高频消息场景下只刷新受影响玩家手牌，避免整区重绘闪烁
- [x] `pnpm build` + `pnpm lint` 通过

### 实施备注

- `Room.dirtyCards` 保留为本局审计集合，不在视图渲染后清空；视图通过私有游标消费 `dirtyCardEvents`，日志裁剪时再兜底全量刷新玩家手牌。
