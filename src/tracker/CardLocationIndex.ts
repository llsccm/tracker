import {
  getContainerLocationCandidates,
  getPlayerLocationCandidates
} from './candidate/locationCandidate'
import { recordTraversal } from './traversalStats'
import type { Card } from './Card'
import type { Room } from './Room'
import type { PublicZoneName, SeatID, SpellID } from './types'

type CardsBySeat = Map<SeatID, Card[]>
type CardsBySpell = Map<SpellID, Card[]>
type MarkCardsBySeat = Map<SeatID, CardsBySpell>

/**
 * 单张牌在展示投影里落到的一个桶槽位。
 * 一张牌可能同时投影到多个槽位（如多座位候选手牌 / 完整位置候选）。
 */
type ProjectionTarget =
  | { bucket: 'knownHand'; seat: SeatID }
  | { bucket: 'candidateHand'; seat: SeatID }
  | { bucket: 'equip'; seat: SeatID }
  | { bucket: 'judge'; seat: SeatID }
  | { bucket: 'mark'; seat: SeatID; spellID: SpellID }

interface ProjectionRecord {
  location: Card['location']
  targets: ProjectionTarget[]
}

interface ApplyDirtyOptions {
  /**
   * 显式声明本批次受影响的公共区。
   * 纯公共区之间的暗牌移动（pile→discard 等）不经过 clearSeats，不发 dirtyCard 事件，
   * 需要移动层显式告知；玩家区↔公共区的迁移会由脏牌自身的新旧位置覆盖。
   */
  dirtyPublicZones?: Iterable<PublicZoneName>
}

/**
 * 区域投影索引，负责根据当前 Room 卡牌的推断状态维护各展示区域的分区投影。
 * 避免视图渲染时直接高频遍历 Room.cards 现场分类。
 *
 * 支持两种更新方式：
 * - `rebuild(room)`：全量重建，作为初始化、回退与测试断言基准。
 * - `applyDirtyCardEvents(room)`：按 `Room.dirtyCardEvents` 游标增量维护；游标断档时自动回退全量。
 * 两条路径共用同一个 `projectCard()` 单牌投影函数，保证增量结果与全量结果等价。
 */
export class CardLocationIndex {
  declare knownHandBySeat: CardsBySeat
  declare candidateHandBySeat: CardsBySeat
  declare equipBySeat: CardsBySeat
  declare judgeBySeat: CardsBySeat
  declare markBySeatAndSpell: MarkCardsBySeat
  declare publicByZone: Map<PublicZoneName, Card[]>

  // 每张牌上一轮的投影记录，用于增量更新时先按旧记录删除再按新状态插入。
  declare projections: WeakMap<Card, ProjectionRecord>
  // 玩家区桶保持 room.cards 顺序；orderKey 提供稳定排序键以便增量插入定位。
  declare cardOrder: Map<Card, number>
  declare maxOrder: number
  // 已消费到的 dirtyCardEvents 序号；断档（被 DIRTY_CARD_EVENT_LIMIT splice）时回退全量。
  declare lastConsumedSeq: number
  // 带装备容器候选的牌：其投影座位取决于装备当前承载座位（跨牌依赖）。
  // 装备移动时这些牌自身不脏，增量批次需一并重投影。
  declare containerDependentCards: Set<Card>

  constructor() {
    this.knownHandBySeat = new Map()
    this.candidateHandBySeat = new Map()
    this.equipBySeat = new Map()
    this.judgeBySeat = new Map()
    this.markBySeatAndSpell = new Map()
    this.publicByZone = new Map()

    this.projections = new WeakMap()
    this.cardOrder = new Map()
    this.maxOrder = -1
    this.lastConsumedSeq = 0
    this.containerDependentCards = new Set()
  }

  /**
   * 根据当前 Room 状态全量重建投影数据。
   * @param options.record 是否记录 `locationIndex:rebuild` 遍历采样；DEV 影子对比传 false 避免污染基线。
   */
  rebuild(room: Room, options: { record?: boolean } = {}): void {
    const { record = true } = options
    if (record) recordTraversal('locationIndex:rebuild', room.cards.length)
    this.knownHandBySeat.clear()
    this.candidateHandBySeat.clear()
    this.equipBySeat.clear()
    this.judgeBySeat.clear()
    this.markBySeatAndSpell.clear()
    this.publicByZone.clear()

    this.projections = new WeakMap()
    this.cardOrder = new Map()
    this.maxOrder = -1
    this.containerDependentCards = new Set()

    room.zones.forEach((zone, zoneID) => {
      this.publicByZone.set(zoneID, [...zone.cards])
    })

    // 初始化每个玩家的空数组/Map，保证视图读取时无需判空。
    room.players.forEach((player) => {
      this.knownHandBySeat.set(player.seatID, [])
      this.candidateHandBySeat.set(player.seatID, [])
      this.equipBySeat.set(player.seatID, [])
      this.judgeBySeat.set(player.seatID, [])
      this.markBySeatAndSpell.set(player.seatID, new Map())
    })

    // 按 room.cards 顺序遍历：桶内顺序即 room.cards 顺序，增量插入也沿用该顺序。
    room.cards.forEach((card, index) => {
      this.cardOrder.set(card, index)
      this.maxOrder = index

      const targets = this.projectCard(room, card)
      targets.forEach((target) => {
        const list = this.listForTarget(target, true)
        if (list) list.push(card)
      })
      this.projections.set(card, { location: card.location, targets })
      if (this.cardHasContainerCandidates(card)) this.containerDependentCards.add(card)
    })

    this.lastConsumedSeq = room.dirtyCardSeq
  }

  /**
   * 为全量 rebuild 之后动态创建的实体预先分配稳定顺序。
   * 若等到首次脏事件才登记，顺序会取决于实体进入投影桶的先后；
   * 全量 rebuild 却按 room.cards 创建顺序登记，两条路径随后就会产生不同桶顺序。
   */
  registerCard(card: Card): void {
    if (this.cardOrder.has(card)) return

    this.maxOrder += 1
    this.cardOrder.set(card, this.maxOrder)
  }

  /**
   * 按 `Room.dirtyCardEvents` 游标增量更新受影响玩家桶与公共区桶。
   * @returns 是否走了增量路径；false 表示检测到游标断档并回退了全量 rebuild。
   */
  applyDirtyCardEvents(room: Room, options: ApplyDirtyOptions = {}): boolean {
    const events = room.dirtyCardEvents

    // 断档检测：需要的下一条事件已被 DIRTY_CARD_EVENT_LIMIT splice 掉时，只能全量回退。
    if (events.length > 0 && events[0].seq > this.lastConsumedSeq + 1) {
      this.rebuild(room)
      return false
    }

    const affectedCards = new Set<Card>()
    for (const event of events) {
      if (event.seq > this.lastConsumedSeq) affectedCards.add(event.card)
    }

    const affectedZones = new Set<PublicZoneName>()
    for (const zoneID of options.dirtyPublicZones ?? []) {
      if (room.zones.has(zoneID)) affectedZones.add(zoneID)
    }

    affectedCards.forEach((card) => {
      const previousLocation = this.projections.get(card)?.location
      if (previousLocation && room.zones.has(previousLocation as PublicZoneName)) {
        affectedZones.add(previousLocation as PublicZoneName)
      }

      this.applyCardChange(room, card)

      if (room.zones.has(card.location as PublicZoneName)) {
        affectedZones.add(card.location as PublicZoneName)
      }
    })

    // 装备容器候选牌的投影座位随装备承载座位漂移；装备移动时它们自身不脏，需一并重投影。
    // 容器候选罕见（木马类装备标记空间），通常为空集，对常规移动零开销。
    if (this.containerDependentCards.size > 0) {
      for (const card of Array.from(this.containerDependentCards)) {
        if (!affectedCards.has(card)) this.applyCardChange(room, card)
      }
    }

    if (affectedZones.size > 0) this.refreshPublicZones(room, affectedZones)

    recordTraversal('locationIndex:applyDirty', affectedCards.size)
    this.lastConsumedSeq = room.dirtyCardSeq
    return true
  }

  /**
   * 单牌重投影：先按旧投影记录从桶中删除，再按当前状态计算新投影并有序插入。
   */
  applyCardChange(room: Room, card: Card): void {
    const previous = this.projections.get(card)
    if (previous) {
      previous.targets.forEach((target) => this.removeProjection(card, target))
    }

    const targets = this.projectCard(room, card)
    targets.forEach((target) => this.insertProjectionOrdered(card, target))
    this.projections.set(card, { location: card.location, targets })

    if (this.cardHasContainerCandidates(card)) this.containerDependentCards.add(card)
    else this.containerDependentCards.delete(card)
  }

  /**
   * 只刷新受影响公共区的有序数组，避免全量 `room.zones.forEach()`。
   */
  refreshPublicZones(room: Room, zoneIDs: Iterable<PublicZoneName>): void {
    for (const zoneID of zoneIDs) {
      const zone = room.zones.get(zoneID)
      if (zone) this.publicByZone.set(zoneID, [...zone.cards])
    }
  }

  /**
   * 把各桶归一化为可比较的纯结构（用 room.cards 下标做身份令牌，含桶内顺序）。
   * 供 DEV 一致性断言与测试比对“增量结果 vs 全量 rebuild 结果”。
   */
  toComparable(room: Room): unknown {
    const order = new Map<Card, number>()
    room.cards.forEach((card, index) => order.set(card, index))
    const token = (card: Card) => order.get(card) ?? -card.id

    const bySeat = (map: CardsBySeat) =>
      Array.from(map.entries())
        .sort((a, b) => Number(a[0]) - Number(b[0]))
        .map(([seat, cards]) => [Number(seat), cards.map(token)])

    const mark = Array.from(this.markBySeatAndSpell.entries())
      .sort((a, b) => Number(a[0]) - Number(b[0]))
      .map(([seat, spellMap]) => [
        Number(seat),
        Array.from(spellMap.entries())
          .sort((a, b) => Number(a[0]) - Number(b[0]))
          .map(([spellID, cards]) => [Number(spellID), cards.map(token)])
      ])

    const publicByZone = Array.from(this.publicByZone.entries())
      .sort((a, b) => String(a[0]).localeCompare(String(b[0])))
      .map(([zoneID, cards]) => [String(zoneID), cards.map(token)])

    return {
      knownHand: bySeat(this.knownHandBySeat),
      candidateHand: bySeat(this.candidateHandBySeat),
      equip: bySeat(this.equipBySeat),
      judge: bySeat(this.judgeBySeat),
      mark,
      public: publicByZone
    }
  }

  /**
   * 是否带装备容器候选（投影座位依赖装备承载座位的跨牌依赖）。
   */
  private cardHasContainerCandidates(card: Card): boolean {
    if (!card.hasLocationCandidates?.()) return false
    return getContainerLocationCandidates(card.getLocationCandidates()).length > 0
  }

  /**
   * 计算单张牌当前应落到的所有投影槽位。
   * 该函数是 rebuild 与增量共用的唯一投影真源，避免两条路径分类逻辑分裂。
   * 非玩家区牌返回空数组（公共区顺序由 publicByZone 单独维护）。
   */
  private projectCard(room: Room, card: Card): ProjectionTarget[] {
    if (card.location !== 'player') return []

    const targets: ProjectionTarget[] = []

    const locationCandidates = card.hasLocationCandidates?.()
      ? getPlayerLocationCandidates(card.getLocationCandidates())
      : []
    const containerCandidates = card.hasLocationCandidates?.()
      ? getContainerLocationCandidates(card.getLocationCandidates()).flatMap((candidate) =>
          room.resolveEquipmentContainerLocationCandidates(candidate)
        )
      : []

    if (
      locationCandidates.length > 0 ||
      containerCandidates.length > 0 ||
      card.hasSubZoneCandidates?.()
    ) {
      if (card.isKnown !== true) return targets

      // 完整位置候选需要同时投影到所有可能区域。
      // 例如 A 手牌 / A 标记会同时出现在候选手牌和对应标记区里。
      // 装备容器候选会先按装备当前承载座位展开，再作为普通 mark 候选投影。
      const candidates =
        locationCandidates.length > 0 || containerCandidates.length > 0
          ? [...locationCandidates, ...containerCandidates]
          : card.getSubZoneCandidates()

      candidates.forEach((candidate) => {
        if (candidate.subZone === 'hand') {
          targets.push({ bucket: 'candidateHand', seat: Number(candidate.seatID) })
          return
        }

        if (candidate.subZone === 'equip' || candidate.subZone === 'judge') {
          targets.push({
            bucket: candidate.subZone === 'equip' ? 'equip' : 'judge',
            seat: Number(candidate.seatID)
          })
          return
        }

        if (candidate.subZone === 'mark' && candidate.spellID !== null) {
          targets.push({
            bucket: 'mark',
            seat: Number(candidate.seatID),
            spellID: candidate.spellID
          })
        }
      })

      return targets
    }

    if (card.subZone === 'hand') {
      if (card.isKnown !== true) return targets

      if (card.seats.size === 1) {
        const [seatID] = card.seats
        targets.push({ bucket: 'knownHand', seat: Number(seatID) })
      } else if (card.seats.size > 1) {
        card.seats.forEach((seatID) => {
          targets.push({ bucket: 'candidateHand', seat: Number(seatID) })
        })
      }

      return targets
    }

    if (card.subZone === 'equip' || card.subZone === 'judge') {
      if (card.seats.size !== 1) return targets

      const [seatID] = card.seats
      targets.push({ bucket: card.subZone === 'equip' ? 'equip' : 'judge', seat: Number(seatID) })
      return targets
    }

    if (card.subZone === 'mark' && card.spellID !== null) {
      // 暗标记实体只参与数量维护，不应投影成玩家可见的标记牌。
      if (card.isKnown !== true) return targets

      const spellID = card.spellID
      card.seats.forEach((seatID) => {
        targets.push({ bucket: 'mark', seat: Number(seatID), spellID })
      })
    }

    return targets
  }

  /**
   * 取目标槽位对应的桶数组；`create` 为真时按需创建 mark 的 spellID 子数组。
   * 座位不在 players 中（无对应桶）时返回 null，与 rebuild 的静默跳过语义一致。
   */
  private listForTarget(target: ProjectionTarget, create: boolean): Card[] | null {
    if (target.bucket === 'mark') {
      const spellMap = this.markBySeatAndSpell.get(Number(target.seat))
      if (!spellMap) return null

      let list = spellMap.get(target.spellID)
      if (!list) {
        if (!create) return null
        list = []
        spellMap.set(target.spellID, list)
      }
      return list
    }

    const map =
      target.bucket === 'knownHand'
        ? this.knownHandBySeat
        : target.bucket === 'candidateHand'
          ? this.candidateHandBySeat
          : target.bucket === 'equip'
            ? this.equipBySeat
            : this.judgeBySeat

    return map.get(Number(target.seat)) ?? null
  }

  private insertProjectionOrdered(card: Card, target: ProjectionTarget): void {
    const list = this.listForTarget(target, true)
    if (list) this.spliceOrdered(list, card)
  }

  private removeProjection(card: Card, target: ProjectionTarget): void {
    const list = this.listForTarget(target, false)
    if (!list) return

    const index = list.indexOf(card)
    if (index !== -1) list.splice(index, 1)

    // 清掉空的 mark spellID 子数组，保持与 rebuild（只在有牌时创建条目）一致。
    if (target.bucket === 'mark' && list.length === 0) {
      this.markBySeatAndSpell.get(Number(target.seat))?.delete(target.spellID)
    }
  }

  /**
   * 按 room.cards 顺序键把牌插入桶，保持与 rebuild 相同的桶内顺序。
   */
  private spliceOrdered(list: Card[], card: Card): void {
    const key = this.orderOf(card)
    let index = list.length
    while (index > 0 && this.orderOf(list[index - 1]) > key) index -= 1
    list.splice(index, 0, card)
  }

  private orderOf(card: Card): number {
    const existing = this.cardOrder.get(card)
    if (existing !== undefined) return existing

    // rebuild 之后新增（append 到 room.cards 末尾）的牌，顺序键单调递增即可保持追加序。
    this.registerCard(card)
    return this.cardOrder.get(card) ?? this.maxOrder
  }
}
