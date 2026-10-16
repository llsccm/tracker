# 宴戏（SpellID=7017）：成功批次与单张获得

宴戏的获得移动使用 `MoveType=8`。先获得对方手牌是成功的可靠标志，随后连续获得两张牌堆牌。
非国战模式下，虽然消息的 `FromPosition=65282` 表示来源位置未明确给出，实际顺序仍是依次从牌堆顶取牌；
失败只获得一张时，无法仅凭这条移动确定原来的第一或第二槽位。国战模式下成功获得仍按随机来源处理，不改为牌顶。

## 成功样例：连续获得两张

以下是同一段成功序列，目标均为座位 7。第一条是从座位 4 的手牌获得 `116`；其后两条才是从牌堆连续获得 `68`、`55`：

```yaml
CardCount: 1
CardIDs: [116]
FromID: 4
FromPosition: 65282
FromZone: 5
FromZoneParam: 0
MoveType: 8
SpellID: 7017
ToID: 7
ToPosition: 65280
ToZone: 5
ToZoneParam: 0
```

```yaml
CardCount: 1
CardIDs: [68]
FromID: 255
FromPosition: 65282
FromZone: 1
FromZoneParam: 0
MoveType: 8
SpellID: 7017
ToID: 7
ToPosition: 65280
ToZone: 5
ToZoneParam: 0
```

```yaml
CardCount: 1
CardIDs: [55]
FromID: 255
FromPosition: 65282
FromZone: 1
FromZoneParam: 0
MoveType: 8
SpellID: 7017
ToID: 7
ToPosition: 65280
ToZone: 5
ToZoneParam: 0
```

非国战模式下，两条牌堆来源移动按消息顺序表示连续取牌：`68` 是牌堆顶第一张，`55` 是随后取得的牌堆顶第二张。
`FromID=255` 是牌堆来源的占位值，不是角色座位；判断来源应结合 `FromZone=1`。

## 单张样例：只能确定前两张范围

```yaml
CardCount: 1
CardIDs: [126]
FromID: 255
FromPosition: 65282
FromZone: 1
FromZoneParam: 0
MoveType: 8
SpellID: 7017
ToID: 7
ToPosition: 65280
ToZone: 5
ToZoneParam: 0
```

这条消息只记录了一张牌堆获得，无法从移动本身判断 `126` 是牌堆顶第一张还是第二张。
两种位置都应保留为可能，不应仅凭 `FromPosition=65282` 或 `CardIDs` 中的身份强行选定其中一个。

## 识别要点

- 宴戏相关移动以 `SpellID=7017` 识别；牌堆获得为 `FromZone=1`、`ToZone=5`、`MoveType=8`。
- 先出现同技能、同获得者的 `5 -> 5` 对方手牌转移时，开启两张成功批次；非国战下随后两条 `1 -> 5` 均取当时牌顶，国战保留随机来源。
- 单张获得不足以区分牌堆顶第一张或第二张，推断应保持两者皆可能。
- `FromPosition=65282` 在这些样例中没有提供单条移动的精确牌堆槽位；连续事件顺序是两张牌顶端顺序的依据。

## 当前实现取舍

- `src/tracker/skill/YanXi.ts` 通过全局移动装饰器观察成功标志与批次打断，状态存入 Room 的 `tracker` scope、key `7017`；不在无状态位置归一化中猜测分支。
- 成功批次记录获得者与剩余两张额度。非国战按当前牌顶顺序移动；暗牌协议遇到已知牌顶时补入内部事件身份，并同步身份账本，不修改原始协议。国战成功批次直接保留通用随机获得，不触发失败降级。
- 失败但协议含真实 `CardID` 时，不主动清除已有明牌定位，直接走通用已知牌移动；判据是协议可见性，不硬编码主视角座位。
- 失败且没有真实 `CardID` 时，不实现前两张范围候选；只在移动前匿名化原牌顶两个物理槽位中的明牌，同时将相应身份释放回账本未定位批次，再执行通用 `RANDOM` 暗牌获得。
- 该降级不删除身份、不额外改变牌数，也不向更深处寻找第二张明牌；原第三张及更深明牌不因此被匿名化。
- 成功批次消费完即删除；新的成功标志替换旧批次，其他移动（含洗牌、不同获得者或不匹配的移动类型）打断旧批次；Room 生命周期统一清空状态。不用定时器拼接两次单张获得。
- 当前仅接入 `7017`，不自动把旧 `7016` 规则视为相同协议。
- 回归：`tests/tracker/yanXi.test.ts`、`tests/tracker/pileIdentityLedger.test.ts`。

## 相关入口

- [协议索引](README.md)
- [牌堆位置通用说明](move-position.md)
