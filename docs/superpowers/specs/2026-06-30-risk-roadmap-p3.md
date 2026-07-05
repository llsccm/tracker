# P3 能力演进 — 详细设计

> 📅 2026-06-30 | 父文档：[`总览`](2026-06-30-risk-roadmap-overview.md)
>
> 解决风险：R9 JS/TS 混合边界 / R11 技能覆盖不全 / 新功能
>
> 前置条件：P1 完成（候选系统迁移推进）、P2 完成（CI 门禁就绪）

---

## 目标

扩展产品价值边界。基于 P0-P2 建立的测试安全网、注册表模式和 CI 门禁，安全地添加新技能覆盖、统一代码语言边界、实现增量渲染和中途加入同步。

---

## P3-1: 技能覆盖扩展

### 当前问题

`docs/agents/card_tracker.md` 明确标注："宴戏、权变、诫厉等技能仍需要用新版 ConstraintGroup 做进一步精细化。"

当前已有的技能处理器（`src/tracker/skill/`）仅覆盖：

| 技能 | 文件 | 状态 |
|------|-----|------|
| 称列 | `ChengLie.ts` | ✅ 已实现 |
| 节礼 | `JieLi.ts` | ✅ 已实现 |

### 待适配技能清单

以下技能需要通过 `ConstraintGroup` 做精细化推断，而非仅通过 `handleMoveCard` 中的 CardIDs 修正：

| 技能名 | SpellID | 核心行为 | 适配难度 |
|-------|---------|---------|---------|
| 宴戏 | 7016/7017 | 看牌后从多张中选取，协议 CardIDs 可能不完整 | 中 |
| 权变 | 实现时需协议分析确认 | 不确定性分配，需要 ConstraintGroup 约束 | 中 |
| 诫厉 | 实现时需协议分析确认 | 技能标记区交互，类似暗置标记流程 | 高 |

### 适配策略

基于 P0 建立的技能副作用注册表（`src/handler/spellEffects.js`）和 `src/tracker/skill/` 目录：

1. 每个新技能创建独立文件：`src/tracker/skill/<SkillName>.ts`
2. 技能文件导出移动事件装饰器，注册到 `Room.moveEventHandlers`
3. 如果技能需要 CardIDs 修正，同时在 `spellEffects` 注册表添加条目
4. 每个技能配套独立测试文件：`tests/tracker/<skillName>.test.ts`

### 新增技能的标准流程

```
1. 分析协议行为（PubGsCMoveCard 消息中的字段模式）
2. 确定是否需要 CardIDs 修正（spellEffects 注册表）
3. 确定是否需要 ConstraintGroup 精细化（skill 装饰器）
4. 编写测试（基于协议录制或手工构造）
5. 实现技能处理器
6. 回归验证
```

### 验收条件

- [ ] 宴戏(7016/7017)通过 ConstraintGroup 精细化推断
- [ ] 至少 2 个其他高频技能完成适配
- [ ] 每个新技能有独立测试文件
- [ ] 新增技能不修改 `handleMoveCard()` 主函数

---

## P3-2: JS/TS 边界统一

### 当前问题

- `src/handler/` 全部为 JavaScript，无类型保护
- `src/tracker/` 全部为 TypeScript
- 跨边界传参（handler 调用 tracker API）无编译期类型校验
- P0 拆分后的新模块（`handleSpecialZones`、`handleGameFlowState`、`spellEffects`）初始为 JS

### 迁移策略

按依赖方向从下游到上游逐步迁移：

**优先迁移（P0 拆分产物）**：
1. `src/handler/spellEffects.js` → `.ts`（最小依赖，最多独立函数）
2. `src/handler/specialZones.js` → `.ts`
3. `src/handler/gameFlowState.js` → `.ts`

**后续迁移（核心处理器）**：
4. `src/handler/PubGsCMoveCard.js` → `.ts`（主编排器）
5. `src/handler/StartGame.js` → `.ts`
6. `src/handler/MsgGameOver.js` → `.ts`
7. 其他 handler 文件

**不急于迁移**：
- `src/dom.js`、`src/draw.js`、`src/logic.js`（DOM 操作和旧逻辑，迁移收益低）
- `src/ui/` 目录（纯 UI 辅助，类型安全需求低）
- `src/config/` 目录（配置解析，接口稳定）

### 迁移原则

- 每次迁移一个文件，配套 `pnpm typecheck:tracker` 验证
- 优先为跨边界 API 添加类型声明
- 不做功能变更，纯类型迁移

### 验收条件

- [ ] P0 拆分产物全部迁移到 TypeScript
- [ ] `PubGsCMoveCard` 主编排器迁移到 TypeScript
- [ ] 跨边界 API 有明确类型声明
- [ ] `pnpm typecheck:tracker` 通过

---

## P3-3: 增量渲染与体验优化

### 当前问题

- P1-3 实现了基于 `dirtyCards`/`viewDirty` 的区域级增量渲染
- 但仍是"整个玩家手牌区重绘"粒度，无单卡级更新
- 中途加入对局时无法同步当前状态
- 无协议消息录制/回放测试框架

### 改进方案

#### 单卡粒度增量更新

1. 扩展 `Room.cardChangeEvents` 记录变更类型（新增/移除/属性变更）
2. `flushRender()` 对于手牌区只操作变更的卡牌 DOM 节点
3. 对于统计面板，只在 counter 数据变化时重新计算

#### 中途加入对局同步

1. 在 `TrackerController` 中添加"延迟初始化"模式
2. 如果检测到对局已在进行中（`Game.isGameStart` 已为 true），跳过正常的 Room 创建流程
3. 基于当前协议可获取的信息（手牌、公共区、装备等）尽可能重建 Room 状态
4. 重建的 Room 标记为"不完整"，在 UI 中提示

#### 协议消息录制/回放测试框架

这是长期投资，建立后可为所有后续迭代提供回归保障：

1. 在 `TrackerController` 中添加录制模式，但不直接落盘 `syncTrackerMove()` 的原始输入
2. 录制前先经过可录制字段白名单/脱敏层，丢弃 `RawMoveCardEvent` 的任意扩展载荷，并按测试需要对 `FromID`、`ToID`、`CardIDs` 等协议状态做匿名化或稳定映射
3. 录制文件格式：`{ events: [{ type, timestamp, data }], metadata: { version, gameMode } }`，其中 `data` 只能是规范化后的可回放事件
4. 回放工具：只读取经过白名单/脱敏的规范化事件，按顺序执行事件，验证最终 Room 状态
5. CI 中可以使用录制文件作为集成测试用例

### 验收条件

- [ ] 手牌区支持单卡粒度增量更新
- [ ] 中途加入对局时有基础状态同步能力
- [ ] 录制链路具备字段白名单/脱敏层，不持久化任意扩展载荷
- [ ] 协议消息录制/回放框架可用
- [ ] 至少 1 个真实对局录制作为集成测试用例
