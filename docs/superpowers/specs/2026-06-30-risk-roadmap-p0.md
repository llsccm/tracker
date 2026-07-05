# P0 核心稳定性 — 详细设计

> 📅 2026-06-30 | 父文档：[`总览`](2026-06-30-risk-roadmap-overview.md)
>
> 解决风险：R1 协议咽喉单点故障 / R2 高风险路径测试缺失 / R3 协议字段无校验 / R6 遗留代码误引用

---

## 目标

拆解协议咽喉、建立测试安全网、隔离遗留代码。P0 完成后，后续任何迭代都有回归保护，新增技能只需在注册表添加条目而无需修改主函数。

---

## P0-1: handleMoveCard 职责拆分

### 当前问题

`src/handler/PubGsCMoveCard.js:handleMoveCard()` 是一个 408 行的函数，承载 5 类职责：

1. **协议预处理**（`prepareMoveCardIDs`）— 已抽取
2. **位置归一化**（`normalizeMovePosition`）— 已抽取
3. **特殊区域分支** — 回收区 12、浑天仪底置、初始牌添加、手气卡放回、弃牌洗入洗牌堆 — 内联在主函数
4. **游戏流程状态** — 初始牌分配、摸牌逻辑、权道计数 — 内联在主函数
5. **技能副作用** — 称象(441/3492)、吉占(3033)、和衷(3329)、捷悟(3659)、灼魂(3821)、佐练(3488)、清议/联句(3157/3511)、思泣(3543)、椒遇(3571)、迁附(3750)、宴戏(7016/7017) — 内联在主函数的 switch-case

### 拆分策略

```text
handleMoveCard() — 瘦编排器 ~80行
├── prepareMoveCardIDs()    — 已存在，不变
├── normalizeMovePosition() — 已存在，不变
├── handleSpecialZones()    — 新：特殊区域分支
├── handleGameFlowState()   — 新：游戏流程状态
├── spellSideEffectRegistry — 新：技能副作用注册表
└── syncTrackerMove()       — 已存在，不变
```

#### 新模块：handleSpecialZones

- 文件位置：`src/handler/specialZones.js`
- 职责：回收区 12、浑天仪底置(3694)、初始牌添加、手气卡放回、弃牌洗入洗牌堆
- 接口：`handleSpecialZones(msg, normalizedMove) => { handled: boolean }`
- 如果 `handled === true`，主函数直接调用 `finishMove()` 并 return

#### 新模块：handleGameFlowState

- 文件位置：`src/handler/gameFlowState.js`
- 职责：初始牌分配位置修正（`POSITION_RANDOM`）、摸牌逻辑、战法计数 `Game.record()`、权道计数展示
- 接口：`handleGameFlowState(msg, normalizedMove) => void`
- 权道计数展示应考虑后续迁移到 `src/tracker/view/` 或独立 UI 模块

#### 新模块：技能副作用注册表

- 文件位置：`src/handler/spellEffects.js`（或 `src/handler/spellEffects/index.js` + 按技能分文件）
- 模式：`Map<SpellID, (msg, normalizedMove) => void>`
- 注册表在模块加载时静态构建，无运行时开销
- 主函数只需 `spellRegistry.get(SpellID)?.(msg, normalizedMove)`
- 每个技能处理器是纯函数，易于独立测试

技能注册表条目清单：

| SpellID | 技能名 | 当前行为 |
|---------|-------|---------|
| 441, 3492 | 称象 | 计算点数展示 |
| 3033 | 吉占 | 牌堆点数比较展示 |
| 3329 | 和衷 | 牌堆分类点数比较展示 |
| 3659 | 捷悟 | 记录 spellState |
| 3821 | 灼魂 | 记录 pending 牌名 |
| 3488 | 佐练 | CardIDs 修正 + spellState |
| 3157, 3511 | 清议/联句 | CardIDs 回填 |
| 3543 | 思泣 | CardIDs 回填（弃牌堆红色牌） |
| 3571 | 椒遇 | CardIDs 回填 |
| 3750 | 迁附 | CardIDs 控顶回填 |
| 7016, 7017 | 宴戏 | CardIDs 推断 |

### 拆分后的 handleMoveCard 伪代码

```javascript
export function handleMoveCard(msg) {
  // 1. 预处理
  const prepared = prepareMoveCardIDs(msg)
  if (prepared.shouldReturn) return
  let { CardIDs } = prepared

  // 2. 位置归一化
  const normalized = normalizeMovePosition({ ...msg, CardIDs })
  CardIDs = normalized.CardIDs

  const context = { msg, CardIDs, normalized }

  // 3. 特殊区域分支
  if (handleSpecialZones(context).handled) {
    syncTrackerMove(msg, normalized)
    return
  }

  // 4. 游戏流程状态
  handleGameFlowState(context)

  // 5. 技能副作用
  const handler = spellRegistry.get(msg.SpellID)
  if (handler) handler(context)

  // 6. tracker 同步
  syncTrackerMove(msg, normalized)
}
```

### 验收条件

- [ ] `handleMoveCard()` 函数体不超过 100 行
- [ ] 所有技能副作用通过注册表调用，主函数无 switch-case
- [ ] 特殊区域分支抽取为独立函数
- [ ] 现有行为不变：`pnpm test:tracker` 全绿
- [ ] `pnpm lint` + `pnpm build` 通过

---

## P0-2: 高风险路径测试补齐

### 当前测试覆盖

现有 10 个测试文件：

| 测试文件 | 覆盖范围 |
|---------|---------|
| `room.import.test.ts` | 导入边界 |
| `state-user.import.test.ts` | 状态/用户导入边界 |
| `trackerController.test.ts` | Controller 基本流程 |
| `locationCandidates.test.ts` | 位置候选基本逻辑 |
| `publicCandidates.test.ts` | 公共区候选 |
| `locationIndex.test.ts` | CardLocationIndex |
| `hiddenMarkCandidates.test.ts` | 暗置标记候选 |
| `handCountObservation.test.ts` | 手牌观测同步 |
| `moveEventLogging.test.ts` | 移动事件日志 |
| `pileDisplayOrder.test.ts` | 牌堆展示顺序 |

### 需补齐的关键测试

#### A. Room.moveCards() 组合路线

1. **已知牌 + 暗牌混合移动到玩家区**
   - 3 张已知 + 2 张暗牌 → 玩家 A 手牌
   - 验证：已知牌 `isKnown=true`、暗牌从正确来源取出、候选席位绑定正确

2. **暗牌从玩家到玩家（候选传播）**
   - 玩家 A 有 3 张明牌 + 1 张暗牌 → 暗取 1 张到玩家 B
   - 验证：明牌候选传播到 B、ConstraintGroup 创建正确

3. **来源明牌残留公共区的占位回补**
   - 协议声明玩家 A 来源明牌移入弃牌堆，但本地该牌仍在牌堆 Zone
   - 验证：旧公共区槽位被暗占位修复、同批已知牌不互相充当回补

4. **公共区候选位置传播**
   - 牌堆顶候选被摸走 → 传播到玩家手牌候选
   - 验证：publicCandidates 正确维护、手牌候选继承

5. **玩家手牌数归零时的候选剔除**
   - 同步观测到玩家 A 手牌数 = 0
   - 验证：A 的手牌候选被剔除、装备容器候选保留

#### B. 拆分后的 handleMoveCard 模块

1. **handleSpecialZones**：每个特殊区域分支的独立测试
2. **handleGameFlowState**：初始分配、摸牌、权道计数
3. **spellEffects**：每个注册技能的独立测试（称象/吉占/和衷等）

#### C. MoveEventNormalizer

1. 标准 PubGsCMoveCard 消息归一化
2. 未知区域编号的降级处理
3. 边界值：CardIDs 为空、CardCount 为 0、缺失字段

### 验收条件

- [ ] 新增测试文件覆盖上述 A/B/C 三组场景
- [ ] `pnpm test:tracker` 全绿
- [ ] 测试可在 CI 环境中无浏览器运行（Node/Vitest）

---

## P0-3: 协议字段校验断路器

### 当前问题

- `MoveEventNormalizer.normalizeMoveEvent()` 不校验字段存在性
- `protocolZones.ts` 中区域编号是魔术数字
- 未识别的区域编号会导致运行时异常

### 改进方案

#### 区域编号常量表

在 `src/tracker/protocolZones.ts` 中提取所有魔术数字为命名常量：

```typescript
export const PROTOCOL_ZONE = {
  NONE: 0,
  PILE: 1,
  DISCARD: 2,
  // ... 完整枚举
} as const
```

#### 归一化入口校验

在 `normalizeMoveEvent()` 入口添加：

1. 关键字段存在性检查（`FromZone`、`ToZone`、`CardCount`）
2. 未识别区域编号 → 记录警告日志 + 继续执行（不抛异常）
3. CardIDs 长度与 CardCount 不一致 → 记录警告日志

#### 桥接层防御

在 `TrackerController.syncTrackerMove()` 中添加 try-catch：

- 捕获记牌器异常后记录日志
- 不向上传播，避免阻断宿主游戏消息链

### 验收条件

- [ ] `protocolZones.ts` 无魔术数字
- [ ] 未识别区域编号不触发运行时异常
- [ ] 记牌器异常不阻断宿主消息链
- [ ] 新增测试覆盖异常字段场景

---

## P0-4: 遗留代码隔离

### 当前问题

- `src/handler/old/` 包含 4 个遗留处理器：`handleLegacyChengLieMove.js`、`handleLegacyJieLiMove.js`、`handleLegacyWenGuaMove.js`、`handleYanXi.js`
- `src/handler/legacyMoveCard.js` 包含 5 个遗留函数
- 虽未通过 `src/handler/index.js` 导出，但仍可被 IDE 自动补全误引用

### 处理策略

1. 确认这些文件无任何活跃引用（通过 `find_referencing_symbols` 验证）
2. **如果无引用**：直接删除文件
3. **如果有残留引用**：
   - 添加 `@deprecated` JSDoc 标记
   - 在 `eslint.config.js` 中添加 `no-restricted-imports` 规则，禁止从这些路径导入
   - 在下一个迭代中清理残留引用后删除

### 验收条件

- [ ] `handler/old/` 目录已删除或标记 deprecated + eslint 规则阻止导入
- [ ] `legacyMoveCard.js` 已删除或标记 deprecated + eslint 规则阻止导入
- [ ] `pnpm lint` + `pnpm build` 通过
