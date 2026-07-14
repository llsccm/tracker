import { collectHandSlotCardsBySeat } from './candidate/handSlotCounts'
import {
  createLocationCandidateKey,
  fromSubZoneCandidate,
  parseLocationCandidateKey,
  toSubZoneCandidate
} from './candidate/locationCandidate'
import { parseSubZoneCandidateKey } from './candidate/subZoneCandidate'
import type { Card } from './Card'
import type { Room } from './Room'
import type { SeatID } from './types'

interface HandCountInput {
  knownCount?: number
  candidateCount?: number
}

/**
 * 重构版玩家类
 * 负责管理该玩家绑定的各个卡牌区域视图
 */
export class Player {
  /** 房间中的座位 */
  declare seatID: SeatID
  declare room: Room
  /** 牌局中的顺位 一号位开始 */
  declare fixedViewId: number | undefined
  declare hasObservedHandCount: boolean
  declare observedHandCount: number
  declare unknownCardCount: number
  declare knownHandCards: Card[]
  declare candidateHandCards: Card[]
  declare equipCards: Card[]
  declare judgeCards: Card[]
  declare markCards: Map<number, Card[]>

  /** 玩家角色 国战为2个武将id */
  generals: number[] = []
  /** 玩家阵营类型 */
  figure = 0

  /**
   * @param seatID - 座位号 (玩家物理座位号，取值在 0-7 之间)
   * @param room - 所属 Room 实例引用，用于动态反查
   */
  constructor(seatID: SeatID, room: Room) {
    this.seatID = seatID
    this.room = room

    // 牌局计算座位，初始为 undefined，待收到首发摸牌消息设定 firstID 后由 Room 统一进行计算和赋值更新
    this.fixedViewId = undefined

    // 观测到的真实手牌总数来自协议快照或移动事件 delta；候选牌只参与推理，不反推这个事实值。
    this.hasObservedHandCount = false
    this.observedHandCount = 0
    this.unknownCardCount = 0

    // 物理卡牌持有数组，由 syncViewGroups 响应式同步，用以给 DOM 渲染提供稳定的物理排布顺序
    this.knownHandCards = [] // 确定的普通手牌明牌
    this.candidateHandCards = [] // 模糊明牌手牌
    this.equipCards = [] // 装备区卡牌
    this.judgeCards = [] // 判定区卡牌

    // 标记区卡牌管理映射 (按技能归类)，用以解决玩家存在多个由不同技能产生出的标记区（如：佐练、七星）时的渲染
    this.markCards = new Map() // spellID -> Card[]
  }

  /**
   * 同步外部观测到的真实手牌总数。
   */
  syncObservedHandCount(count: number): void {
    this.hasObservedHandCount = true
    this.observedHandCount = Math.max(0, Number(count) || 0)
    this.refreshUnknownCardCount()
  }

  /**
   * 应用移动事件推导出的手牌总数变化。
   */
  applyObservedHandCountDelta(delta: number): void {
    const nextCount = this.observedHandCount + delta
    if (!this.hasObservedHandCount && nextCount < 0) return

    this.syncObservedHandCount(nextCount)
  }

  /**
   * 根据观测到的真实总手牌数与确定普通明牌数量重算暗牌额度。
   * @returns 是否发生变化
   */
  refreshUnknownCardCount(counts: HandCountInput | null = null): boolean {
    if (!this.hasObservedHandCount) return false

    const resolvedCounts = counts ?? this.collectHandSlotCountInput()
    const knownCount = resolvedCounts.knownCount ?? 0
    const candidateCount = resolvedCounts.candidateCount ?? 0
    const nextUnknownCount = Math.max(0, this.observedHandCount - knownCount - candidateCount)
    const changed = this.unknownCardCount !== nextUnknownCount
    this.unknownCardCount = nextUnknownCount
    return changed
  }

  private collectHandSlotCountInput(): HandCountInput {
    // 兜底路径一次性取 known/candidate，避免 getKnown/getCandidate 各自全量扫描。
    const handSlotCards = collectHandSlotCardsBySeat(this.room.cards, [this.seatID]).get(
      this.seatID
    )
    const candidateCards = handSlotCards?.candidateCards ?? []
    return {
      knownCount: handSlotCards?.knownCards.length ?? 0,
      candidateCount: this.getCandidateHandSlotCount(candidateCards)
    }
  }

  /**
   * 计算当前玩家确定普通明牌占用的手牌槽位数量。
   */
  getKnownHandSlotCount(): number {
    const handSlotCards = collectHandSlotCardsBySeat(this.room.cards, [this.seatID]).get(
      this.seatID
    )
    return handSlotCards?.knownCards.length ?? 0
  }

  /**
   * 计算当前玩家手牌中由模糊明牌占用的期望槽位数量。
   * 优先采用局部分组的 expectedSlotsBySeat；没有显式期望时退化为候选明牌数量。
   */
  getCandidateHandSlotCount(candidateCards: Card[] | null = null): number {
    const handSlotCards =
      candidateCards === null
        ? collectHandSlotCardsBySeat(this.room.cards, [this.seatID]).get(this.seatID)
        : null
    const handCandidateCards = candidateCards ?? handSlotCards?.candidateCards ?? []

    if (handCandidateCards.length === 0) return 0

    const countedCards = new Set<Card>()
    let expectedCount = 0

    this.room.constraintGroups.forEach((group) => {
      if (!group.expectedSlotsBySeat.has(this.seatID)) return

      const groupCards: Card[] = []
      for (const card of handCandidateCards) {
        if (group.cards.has(card) && !countedCards.has(card)) {
          groupCards.push(card)
        }
      }
      if (groupCards.length === 0) return

      const groupExpected = group.expectedSlotsBySeat.get(this.seatID)
      expectedCount += Math.min(groupExpected, groupCards.length)
      groupCards.forEach((card) => countedCards.add(card))
    })

    this.room.constraintGroups.forEach((group) => {
      group.expectedSlotsByLocation.forEach((groupExpected, key) => {
        const candidate = toSubZoneCandidate(parseLocationCandidateKey(key))
        if (!candidate || candidate.seatID !== this.seatID || candidate.subZone !== 'hand') return

        const groupCards: Card[] = []
        for (const card of handCandidateCards) {
          if (group.cards.has(card) && !countedCards.has(card)) {
            groupCards.push(card)
          }
        }
        if (groupCards.length === 0) return

        expectedCount += Math.min(groupExpected, groupCards.length)
        groupCards.forEach((card) => countedCards.add(card))
      })
    })

    this.room.constraintGroups.forEach((group) => {
      group.expectedSlotsBySubZone.forEach((groupExpected, key) => {
        // 完整位置约束中的 hand 名额也要计入手牌候选槽位。
        const candidate = parseSubZoneCandidateKey(key)
        if (!candidate || candidate.seatID !== this.seatID || candidate.subZone !== 'hand') return

        const locationKey = createLocationCandidateKey(fromSubZoneCandidate(candidate))
        if (locationKey && group.expectedSlotsByLocation.has(locationKey)) return

        const groupCards: Card[] = []
        for (const card of handCandidateCards) {
          if (group.cards.has(card) && !countedCards.has(card)) {
            groupCards.push(card)
          }
        }
        if (groupCards.length === 0) return

        expectedCount += Math.min(groupExpected, groupCards.length)
        groupCards.forEach((card) => countedCards.add(card))
      })
    })

    return expectedCount
  }

  /**
   * 获取玩家当前所拥有的所有 Card 实例
   */
  get cards(): Card[] {
    return this.room.cards.filter(
      (card) => card.location === 'player' && card.seats.has(this.seatID)
    )
  }

  /**
   * 根据具体技能获取该技能对应的标记牌实体列表
   */
  getMarkCardsBySpell(spellID: number | string): Card[] {
    return this.markCards.get(Number(spellID)) ?? []
  }

  /**
   * 重置玩家状态
   */
  reset(): void {
    this.hasObservedHandCount = false
    this.observedHandCount = 0
    this.unknownCardCount = 0
    this.fixedViewId = undefined
    this.knownHandCards = []
    this.candidateHandCards = []
    this.equipCards = []
    this.judgeCards = []
    this.markCards.clear()
    this.generals.length = 0
  }
}
