# 木牛流马：标记空间识别与迁座（700）

## 区域与身份

- 装备本体为 CardID `161`，附属标记空间为 `700`。
- 协议区域：`5` 为手牌，`6` 为装备，`4` 为标记。
- 对区域 `4`，来源标记 ID 优先取 `FromZoneParam`，目标标记 ID 优先取 `ToZoneParam`；不要只用触发动作的 `SpellID` 判断空间。
- 木牛流马装备本体在装备区间移动时，两端 ZoneParam 都可以为 `0`；这条协议只移动实体 `161`，不处理内部牌。

## 原始协议顺序

以下三条协议依次发生：座位 0 暗置一张手牌，再将木牛流马移交座位 6，随后收到附属标记的迁座通知。

### 1. 手牌暗置到木牛流马

```yaml
CardCount: 1
CardIDs: []
FromID: 0
FromPosition: 65282
FromZone: 5
FromZoneParam: 0
MoveType: 15
SpellID: 700
ToID: 0
ToPosition: 65280
ToZone: 4
ToZoneParam: 700
```

`CardIDs: []` 不表示没有牌：声明数量为 1，牌面不可见。存在来源明牌时，记录 hand/container 候选；来源全暗时沿用暗牌实体移动。

### 2. 装备本体迁座

```yaml
CardCount: 1
CardIDs: [161]
FromID: 0
FromPosition: 65282
FromZone: 6
FromZoneParam: 0
MoveType: 15
SpellID: 700
ToID: 6
ToPosition: 65282
ToZone: 6
ToZoneParam: 0
```

此时只移动装备本体 `161`。内部已知牌、暗占位、账本目标座位和候选投影仍留在座位 0，等待后续标记空间协议。

### 3. 附属标记空间的暗迁座通知

```yaml
CardCount: 1
CardIDs: []
FromID: 0
FromPosition: 65282
FromZone: 4
FromZoneParam: 700
MoveType: 19
SpellID: 700
ToID: 6
ToPosition: 65280
ToZone: 4
ToZoneParam: 700
```

这是同一个木牛流马标记空间的实际迁移入口：此时才将内部实体、暗占位、账本及候选投影从座位 0 移到座位 6。它不是再次从手牌暗置，也不是容器内容的完整可见快照。账本仍使用 `sourceSeat:muniu:161`，约束组 ID 和来源座位不变。

处理要求：

- 装备本体移动时不提前处理内部牌；第三条按来源和目标 `mark:700` 空间迁移内部牌，不额外补造实体，也不增加累计暗置数量。
- 暗迁座只改变位置，保留内部已知牌的身份与可见性，不把明牌降级为暗占位。
- 保留已有 hand/container 弱候选或精确数量约束，不把空 CardIDs 当成“容器为空”。
- 相同暗迁座通知重复到达时，实体、候选、账本与约束组保持不变。
- 普通标记和携带明牌的容器快照仍走各自流程，不因本样例统一忽略所有 `4 -> 4` 协议。

## 实现与回归入口

- `src/tracker/MoveEventNormalizer.ts`：保留声明数量，分别归一化来源与目标标记空间。
- `src/tracker/roomMovement/hiddenMarks.ts`：木牛流马账本与容器投影迁座。
- `tests/tracker/muniuMarkTransfer.test.ts`：使用上述原始协议，覆盖来源全暗、全明的两阶段迁移、已知内部牌可见性，以及重复暗迁座通知和 ZoneParam 优先级。
