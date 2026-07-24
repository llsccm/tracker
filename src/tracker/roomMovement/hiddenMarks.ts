import { trackerLogger } from '@/utils/logger'
import { isAnonymous as isAnonymousCard } from '../Card'
import {
  createEquipmentContainerLocationCandidate,
  getEquipmentMarkContainerByMarkSpellID,
  getEquipmentMarkContainerForMove
} from '../candidate/equipmentMarkContainer'
import { isHiddenMarkMove as isHiddenMarkMoveContext } from '../candidate/hiddenMarkMove'
import {
  createLocationCandidateKey,
  fromSubZoneCandidate,
  getPlayerLocationCandidates,
  toSubZoneCandidate
} from '../candidate/locationCandidate'
import { getCompatibleMarkSpellIDs, type SpellIDInput } from '../candidate/markSpellID'
import { createSubZoneCandidateKey } from '../candidate/subZoneCandidate'
import type { Card } from '../Card'
import type { Room } from '../Room'
import type {
  CardID,
  LocationCandidate,
  PlayerLocationCandidate,
  SeatID,
  SpellID,
  SubZone,
  SubZoneCandidate
} from '../types'
interface ObservedEquipmentMarkSnapshot {
  markSpellID: SpellID
  observedSeat: SeatID
}

import {
  HIDDEN_MARK_STATE_KEY,
  UNASSIGNED_MARK_SPACE_STATE_KEY,
  type HiddenMarkRecord,
  type HiddenMarkState,
  type RoomMoveContext,
  type UnassignedMarkSpaceState
} from './types'

export abstract class RoomMovementHiddenMarkMethods {
  declare room: Room

  abstract takeUnknownCardsFromPlayer(
    seatID: SeatID,
    count: number,
    subZone?: SubZone,
    spellIDs?: SpellIDInput | SpellIDInput[]
  ): Card[]

  private deleteConstraintGroupAndMarkDirty(groupID: string, reason: string): void {
    if (this.room.deleteConstraintGroup(groupID)) {
      this.room.markConstraintGroupsDirty(reason)
    }
  }

  createHiddenMarkTargetLocationCandidate(
    spellID: SpellID | null,
    targetSeat: SeatID
  ): LocationCandidate {
    // 装备标记容器使用 container；普通标记仍使用目标座位的 player mark。
    const containerCandidate = createEquipmentContainerLocationCandidate(spellID)
    if (containerCandidate) return containerCandidate

    return {
      type: 'player',
      seatID: targetSeat,
      subZone: 'mark',
      spellID
    }
  }

  /**
   * 读取账本上已缓存的目标候选；旧账本缺失时按 spell/seat 重新推导。
   */
  getHiddenMarkTargetLocationCandidate(record: HiddenMarkRecord): LocationCandidate {
    return (
      record.targetLocationCandidate ??
      this.createHiddenMarkTargetLocationCandidate(record.spellID, record.targetSeat)
    )
  }

  /**
   * 装备牌换座后，连带迁移该装备承载的暗标记空间。
   */
  retargetEquipmentMarkContainer(
    card: Card,
    context: RoomMoveContext,
    previousSpellID: SpellID | null = null
  ): boolean {
    // 只有装备区到装备区的实体移动才会改变装备容器标记空间的承载座位。
    const { fromSeat, fromSubZone, subZone, targetSeats } = context
    if (fromSubZone !== 'equip' || subZone !== 'equip') return false
    if (!Number.isFinite(fromSeat) || targetSeats.length !== 1) return false

    const targetSeat = Number(targetSeats[0])
    if (!Number.isFinite(targetSeat) || targetSeat === fromSeat) return false

    const container = getEquipmentMarkContainerForMove({
      equipmentCardID: card?.id,
      spellID: context?.spellID,
      previousSpellID
    })
    if (!container) return false

    return this.retargetEquipmentMarkContainerProjection(
      container.markSpellID,
      fromSeat,
      targetSeat,
      { equipmentCardID: card.id }
    )
  }

  /**
   * 将指定装备容器标记空间从旧承载座位重定向到新座位。
   */
  retargetEquipmentMarkContainerProjection(
    spellID: SpellIDInput,
    fromSeat: SeatID | null | undefined,
    targetSeat: SeatID | null | undefined,
    detail: Record<string, unknown> = {}
  ): boolean {
    // 装备容器迁走后，已确定的标记实体和候选账本都要投影到新承载座位。
    const markID = Number(spellID)
    const sourceSeat = Number(fromSeat)
    const nextTargetSeat = Number(targetSeat)
    if (
      !getEquipmentMarkContainerByMarkSpellID(markID) ||
      !Number.isFinite(sourceSeat) ||
      !Number.isFinite(nextTargetSeat) ||
      sourceSeat === nextTargetSeat
    ) {
      return false
    }

    let changed = false
    const state = this.room.skillState.get(HIDDEN_MARK_STATE_KEY) as HiddenMarkState | undefined
    const records: HiddenMarkRecord[] = []
    state?.records?.forEach((record) => {
      if (Number(record.spellID) === markID && Number(record.targetSeat) === sourceSeat) {
        records.push(record)
      }
    })

    records.forEach((record) => {
      changed = this.retargetHiddenMarkRecord(record, nextTargetSeat) || changed
    })

    const movedMarkCardIDs: CardID[] = []
    this.room.cards.forEach((card) => {
      if (
        card.location !== 'player' ||
        card.subZone !== 'mark' ||
        Number(card.spellID) !== markID ||
        card.seats.has(sourceSeat) !== true ||
        card.hasLocationCandidates?.() ||
        card.hasSubZoneCandidates?.()
      ) {
        return
      }

      card.setSeats([nextTargetSeat], 'retargetEquipmentMarkContainerProjection')
      movedMarkCardIDs.push(card.id)
      changed = true
    })

    if (changed) {
      trackerLogger.info('装备容器标记空间随装备迁移', {
        spellID: markID,
        fromSeat: sourceSeat,
        targetSeat: nextTargetSeat,
        movedMarkCardIDs,
        retargetedRecordIDs: records.map((record) => record.id),
        ...detail
      })
    }

    return changed
  }

  /**
   * 迁移单个暗标记账本的目标座位，并合并可能已经存在的新座位账本。
   */
  retargetHiddenMarkRecord(
    record: HiddenMarkRecord,
    targetSeat: SeatID | null | undefined
  ): boolean {
    const nextTargetSeat = Number(targetSeat)
    if (!Number.isFinite(nextTargetSeat) || nextTargetSeat === record.targetSeat) return false

    const state = this.getHiddenMarkState()
    const previousTargetSeat = record.targetSeat
    const previousRecordID = record.id
    const previousGroupID = record.groupID
    const nextRecordID = [record.sourceSeat, nextTargetSeat, record.spellID ?? 'none'].join(':')
    const nextGroupID = `hidden_mark_${nextRecordID}`
    const existingRecord = state.records.get(nextRecordID)

    // 装备容器投影换座时，账本身份也要随 targetSeat 一起迁移，避免旧 key 与新投影并存。
    if (existingRecord && existingRecord !== record) {
      existingRecord.cards.forEach((card) => record.cards.add(card))
      existingRecord.placeholderCards?.forEach((card) => record.placeholderCards.add(card))
      existingRecord.confirmedHandCards.forEach((card) => record.confirmedHandCards.add(card))
      existingRecord.confirmedMarkCards.forEach((card) => record.confirmedMarkCards.add(card))
      record.hiddenCount += existingRecord.hiddenCount
      record.knownMarkMin += existingRecord.knownMarkMin
      record.knownMarkMax += existingRecord.knownMarkMax
      record.targetLocationCandidate =
        record.targetLocationCandidate ?? existingRecord.targetLocationCandidate
      state.records.delete(existingRecord.id)
      this.deleteConstraintGroupAndMarkDirty(existingRecord.groupID, 'hiddenMark:mergeRecord')
    }

    record.targetSeat = nextTargetSeat
    record.id = nextRecordID
    record.groupID = nextGroupID
    record.targetLocationCandidate = this.createHiddenMarkTargetLocationCandidate(
      record.spellID,
      nextTargetSeat
    )
    state.records.delete(previousRecordID)
    state.records.set(nextRecordID, record)
    this.deleteConstraintGroupAndMarkDirty(previousGroupID, 'hiddenMark:retargetRecord')
    // 暗标记实体占位也是账本的一部分，装备容器换座时要随标记区一起迁移投影。
    record.placeholderCards?.forEach((card) => {
      if (
        card.location === 'player' &&
        card.subZone === 'mark' &&
        card.spellID === record.spellID
      ) {
        card.bindCandidates([nextTargetSeat], 'mark', record.spellID, { known: false })
      }
    })
    this.clearHiddenMarkProjection(record)

    const changed = this.applyHiddenMarkProjection(record)
    trackerLogger.info('手牌暗置标记区候选随装备容器投影重定向', {
      sourceSeat: record.sourceSeat,
      previousTargetSeat,
      targetSeat: nextTargetSeat,
      spellID: record.spellID,
      candidateCardIDs: Array.from(record.cards).map((card) => card.id)
    })

    return changed
  }

  /* prettier-ignore */
  /**
   * 获取手牌暗置到标记区的房间级候选账本。
   */
  getHiddenMarkState(): HiddenMarkState {
    return this.room.getSkillState(HIDDEN_MARK_STATE_KEY, () => {
       return { records: new Map<string, HiddenMarkRecord>() }
    })
  }

  /**
   * 获取无席位 mark 空间账本。
   * 这类空间来自 seatID=255 的弹窗/标记协议，按 spellID 保存暗占位实体。
   */
  getUnassignedMarkSpaceState(): UnassignedMarkSpaceState {
    return this.room.getSkillState(UNASSIGNED_MARK_SPACE_STATE_KEY, () => {
      return { spaces: new Map<SpellID | string, Card[]>() }
    })
  }

  /**
   * 判断账本引用是否仍是可用的无席位 mark 暗占位。
   * 取牌和清理都会走这里，避免陈旧引用被再次移动。
   */
  isLiveUnassignedMarkSpaceCard(card: Card, spellIDs: (SpellID | string)[] = []): boolean {
    if (
      card.location !== 'player' ||
      card.subZone !== 'mark' ||
      card.seats.size !== 0 ||
      card.isKnown === true
    ) {
      return false
    }

    if (spellIDs.length === 0) return true
    return card.spellID !== null && spellIDs.includes(card.spellID)
  }

  /**
   * 将协议 ID 解释为无席位 mark 空间 ID。
   * 只有它不是当前座位且已存在同名 spellID 空间时，才允许从 FromID 推断。
   */
  getUnassignedMarkSpaceSpellIDFromProtocolID(
    protocolID: SeatID | null | undefined
  ): SpellID | null {
    if (protocolID === null || protocolID === undefined || Number.isNaN(protocolID)) return null
    if (this.room.seatIDs.includes(protocolID)) return null

    const state = this.room.skillState.get(UNASSIGNED_MARK_SPACE_STATE_KEY) as
      | UnassignedMarkSpaceState
      | undefined
    return state?.spaces?.has(protocolID) ? protocolID : null
  }

  /**
   * 将未知牌登记到无席位 mark 空间。
   * 进入弹窗 mark 时目标 seatID 可能是 255，不能绑定到玩家，只能用 spellID 分桶。
   */
  registerUnassignedMarkSpaceCards(spellID: SpellID | null, cards: Card[]): void {
    if (spellID === null || cards.length === 0) return

    const state = this.getUnassignedMarkSpaceState()
    const liveCards = cards.filter((card) => this.isLiveUnassignedMarkSpaceCard(card, [spellID]))
    if (liveCards.length === 0) return

    const previousCards = state.spaces.get(spellID) ?? []
    const mergedCards: Card[] = []
    const seenCards = new Set<Card>()
    const candidateCards = [...previousCards, ...liveCards]

    candidateCards.forEach((card) => {
      if (seenCards.has(card) || !this.isLiveUnassignedMarkSpaceCard(card, [spellID])) return
      seenCards.add(card)
      mergedCards.push(card)
    })

    state.spaces.set(spellID, mergedCards)
  }

  /**
   * 从无席位 mark 空间弹出暗占位实体。
   * 回牌堆时 FromID 可能是技能空间 ID 而不是座位，优先按 spellID 取账本实体。
   * 如果无法确定 spellID，则不从任何空间兜底取牌，避免串用其它技能空间。
   */
  takeUnassignedMarkSpaceCards(count: number, spellID: SpellIDInput): Card[] {
    if (!(count > 0)) return []

    const state = this.room.skillState.get(UNASSIGNED_MARK_SPACE_STATE_KEY) as
      | UnassignedMarkSpaceState
      | undefined
    if (!state?.spaces?.size) return []

    const compatibleSpellIDs = getCompatibleMarkSpellIDs(spellID)
    if (compatibleSpellIDs.length === 0) return []

    const spaceKeys = compatibleSpellIDs
    const selectedCards: Card[] = []

    spaceKeys.forEach((spaceKey) => {
      const spaceCards = state.spaces.get(spaceKey) ?? []
      if (spaceCards.length === 0) return

      const remainingCards: Card[] = []
      spaceCards.forEach((card) => {
        if (!this.isLiveUnassignedMarkSpaceCard(card, compatibleSpellIDs)) return

        if (selectedCards.length < count) {
          selectedCards.push(card)
          return
        }

        remainingCards.push(card)
      })

      if (remainingCards.length > 0) {
        state.spaces.set(spaceKey, remainingCards)
      } else {
        state.spaces.delete(spaceKey)
      }
    })

    return selectedCards
  }

  /**
   * 从所有无席位 mark 空间移除指定实体。
   * 明牌揭示、显式 sourceCards 或公共区回补可能绕过按 spellID 取牌流程。
   */
  removeUnassignedMarkSpaceCards(cards: Card[]): void {
    if (cards.length === 0) return

    const state = this.room.skillState.get(UNASSIGNED_MARK_SPACE_STATE_KEY) as
      | UnassignedMarkSpaceState
      | undefined
    if (!state?.spaces?.size) return

    const removedCards = new Set(cards)
    state.spaces.forEach((spaceCards, spaceKey) => {
      const remainingCards = spaceCards.filter(
        (card) => !removedCards.has(card) && this.isLiveUnassignedMarkSpaceCard(card, [spaceKey])
      )

      if (remainingCards.length > 0) {
        state.spaces.set(spaceKey, remainingCards)
      } else {
        state.spaces.delete(spaceKey)
      }
    })
  }

  /**
   * 判断本次移动是否是“协议全暗的手牌牌进入技能标记区”。
   * 这类移动不能按普通暗牌占位处理，因为来源手牌中可能已有明牌身份。
   */
  isHiddenMarkMove(context: RoomMoveContext): boolean {
    return isHiddenMarkMoveContext(context)
  }

  /**
   * 取得来源手牌中仍可能参与暗置的明牌。
   * 候选子区域牌只要仍包含“来源手牌”位置，也要纳入候选。
   */
  getKnownHandCandidatesForHiddenMark(sourceSeat: SeatID): Card[] {
    return this.room.cards.filter(
      (card) =>
        card.location === 'player' &&
        card.isKnown === true &&
        card.suspended !== true &&
        card.seats.has(sourceSeat) &&
        ((card.subZone === 'hand' && !card.hasSubZoneCandidates?.()) ||
          card.hasSubZoneCandidate?.({
            seatID: sourceSeat,
            subZone: 'hand',
            spellID: null
          }))
    )
  }

  /**
   * 将当前卡牌状态投影成完整位置候选。
   * 普通候选席位会展开成多个“某座位某子区”的候选位置。
   */
  getCardSubZoneCandidates(card: Card): SubZoneCandidate[] {
    if (card.hasSubZoneCandidates?.()) {
      return card.getSubZoneCandidates()
    }

    if (card.location !== 'player') return []

    const subZone = card.subZone ?? 'hand'
    return Array.from(card.seats).map((seatID) => ({
      seatID: Number(seatID),
      subZone,
      spellID: subZone === 'mark' ? card.spellID : null
    }))
  }

  /**
   * 将当前卡牌状态投影成玩家区 LocationCandidate。
   */
  getCardPlayerLocationCandidates(card: Card): PlayerLocationCandidate[] {
    if (card.hasLocationCandidates?.()) {
      return getPlayerLocationCandidates(card.getLocationCandidates())
    }

    return this.getCardSubZoneCandidates(card)
      .map((candidate) => fromSubZoneCandidate(candidate))
      .filter((candidate): candidate is PlayerLocationCandidate => Boolean(candidate))
  }

  /**
   * 在原有候选位置基础上追加“目标标记区”位置。
   * 不能只保留来源手牌/目标标记，否则会破坏既有的跨角色候选。
   */
  getHiddenMarkSubZoneCandidates(card: Card, record: HiddenMarkRecord): SubZoneCandidate[] {
    return this.getHiddenMarkLocationCandidates(card, record)
      .map((candidate) => toSubZoneCandidate(candidate))
      .filter((candidate): candidate is SubZoneCandidate => Boolean(candidate))
  }

  /**
   * 在原有候选位置基础上追加“目标标记区”位置。
   */
  getHiddenMarkLocationCandidates(card: Card, record: HiddenMarkRecord): LocationCandidate[] {
    const targetCandidate = this.getHiddenMarkTargetLocationCandidate(record)
    const targetCandidateKey = createLocationCandidateKey(targetCandidate)
    const locationCandidates: LocationCandidate[] = []
    const locationCandidateKeys = new Set<string>()

    const appendCandidate = (candidate: LocationCandidate): void => {
      const key = createLocationCandidateKey(candidate)
      if (!key || key === targetCandidateKey || locationCandidateKeys.has(key)) return

      locationCandidateKeys.add(key)
      locationCandidates.push(candidate)
    }

    this.getCardPlayerLocationCandidates(card)
      .filter(
        (candidate) =>
          !(
            candidate.subZone === 'mark' &&
            candidate.spellID === record.spellID &&
            (targetCandidate.type === 'container' || candidate.seatID !== record.targetSeat)
          )
      )
      .forEach((candidate) => appendCandidate(candidate))

    card
      .getLocationCandidates()
      .filter((candidate) => candidate.type !== 'player')
      .forEach((candidate) => appendCandidate(candidate))

    return [...locationCandidates, targetCandidate]
  }

  /**
   * 只有当这批候选牌的位置全集只剩“来源手牌/目标标记”时，
   * 才能把暗置数量升级为精确子区域约束。
   * 如果仍存在 B 手牌等其他候选位置，只记录候选，不做 N 选 K 强收敛。
   */
  canCreateHiddenMarkSubZoneConstraint(record: HiddenMarkRecord, cards: Card[]): boolean {
    const targetCandidateKey = createLocationCandidateKey(
      this.getHiddenMarkTargetLocationCandidate(record)
    )

    return cards.every((card) =>
      this.getHiddenMarkLocationCandidates(card, record).every(
        (candidate) =>
          (candidate.type === 'player' &&
            candidate.seatID === record.sourceSeat &&
            candidate.subZone === 'hand' &&
            candidate.spellID === null) ||
          createLocationCandidateKey(candidate) === targetCandidateKey
      )
    )
  }

  /**
   * 处理手牌暗置到标记区的协议全暗移动。
   *
   * 流程：
   * 1. 找出来源手牌中所有可能参与暗置的明牌。
   * 2. 写入 Room.skillState 账本，保留本次技能/座位维度的候选关系。
   * 3. 接管默认暗牌移动，避免错误地只搬走未知占位牌。
   * 4. 尝试把账本投影成可见候选位置与可收敛约束。
   */
  handleHiddenMarkMove(context: RoomMoveContext): boolean {
    if (!this.isHiddenMarkMove(context)) return false

    const sourceSeat = context.sourceHandSeat
    const targetSeat = context.targetSeats[0]
    const candidateCards = this.getKnownHandCandidatesForHiddenMark(sourceSeat)
    // 装备容器标记无 CardIDs 时，如果来源手牌里有明牌，仍要标成“手牌/容器”弱候选；
    // 如果全是暗牌，则没有可展示身份，直接退回普通暗牌移动，后续投影也不会暴露内部实体 ID。
    if (candidateCards.length === 0) return false

    const state = this.getHiddenMarkState()
    const spellID = context.spellID ?? null
    const recordKey = [sourceSeat, targetSeat, spellID ?? 'none'].join(':')

    let record = state.records.get(recordKey)

    if (!record) {
      const targetLocationCandidate = this.createHiddenMarkTargetLocationCandidate(
        spellID,
        targetSeat
      )
      record = {
        id: recordKey,
        groupID: `hidden_mark_${recordKey}`,
        sourceSeat,
        targetSeat,
        spellID,
        targetLocationCandidate,
        cards: new Set(),
        placeholderCards: new Set(),
        hiddenCount: 0,
        knownMarkMin: 0,
        knownMarkMax: 0,
        confirmedHandCards: new Set(),
        confirmedMarkCards: new Set(),
        sourceEvent: context.sourceEvent ?? { type: 'hiddenMarkCandidates' }
      }
      state.records.set(recordKey, record)
    }

    record.targetLocationCandidate ??= this.createHiddenMarkTargetLocationCandidate(
      record.spellID,
      record.targetSeat
    )

    candidateCards.forEach((card) => {
      record.cards.add(card)
      record.confirmedHandCards.delete(card)
    })

    // 混有暗牌时只得到范围；全明手牌时 min/max 相等，可升级为精确 N 选 K。
    const knownMarkMin = Math.max(0, context.unknownCount - context.sourceHandUnknownCount)
    const knownMarkMax = Math.min(context.unknownCount, candidateCards.length)
    record.hiddenCount += context.unknownCount
    record.knownMarkMin += knownMarkMin
    record.knownMarkMax += knownMarkMax
    record.sourceEvent = context.sourceEvent ?? record.sourceEvent

    context.skipUnknownMovement = true
    context.hiddenMarkRecord = record
    this.applyHiddenMarkProjection(record)
    this.moveHiddenMarkPlaceholders(context, record)

    trackerLogger.info('手牌暗置标记区候选记录', {
      sourceSeat,
      targetSeat,
      spellID,
      hiddenCount: context.unknownCount,
      candidateCardIDs: candidateCards.map((card) => card.id),
      knownMarkMin,
      knownMarkMax,
      exact: record.knownMarkMin === record.knownMarkMax
    })

    return true
  }

  /**
   * 暗牌放入标记区时，除了给明牌加弱候选，还要把来源手牌中的暗占位实体移过去。
   * 否则后续标记区打出或换座时，只剩候选明牌，没有可维护数量的暗实体。
   */
  moveHiddenMarkPlaceholders(context: RoomMoveContext, record: HiddenMarkRecord): Card[] {
    const count = Math.max(0, Number(context.unknownCount) || 0)
    if (count <= 0) return []

    const placeholderCards = this.takeUnknownCardsFromPlayer(record.sourceSeat, count, 'hand')
    if (placeholderCards.length === 0) return []

    this.room.removeCardsFromConstraintGroups(placeholderCards)
    placeholderCards.forEach((card) => {
      card.bindCandidates([record.targetSeat], 'mark', record.spellID, { known: false })
      record.placeholderCards.add(card)
    })
    context.movedUnknownCards.push(...placeholderCards)

    trackerLogger.debug('手牌暗置标记区占位移动', {
      sourceSeat: record.sourceSeat,
      targetSeat: record.targetSeat,
      spellID: record.spellID,
      requestedCount: count,
      placeholderCardIDs: placeholderCards.map((card) => card.id)
    })

    return placeholderCards
  }

  // 某个暗标记占位被已知牌替换后，从旧账本中摘掉，避免后续重复迁移。
  removeHiddenMarkPlaceholder(card: Card): void {
    const state = this.room.skillState.get(HIDDEN_MARK_STATE_KEY) as HiddenMarkState | undefined
    if (!state?.records?.size) return

    state.records.forEach((record) => {
      record.placeholderCards?.delete(card)
    })
  }

  private clearHiddenMarkPlaceholdersForObservedSnapshot(
    record: HiddenMarkRecord,
    observedCards: Set<Card>
  ): CardID[] {
    const clearedPlaceholderIDs: CardID[] = []
    const placeholderCards = Array.from(record.placeholderCards ?? [])
    if (placeholderCards.length === 0) return clearedPlaceholderIDs

    placeholderCards.forEach((card) => {
      record.placeholderCards.delete(card)
      this.removeHiddenMarkPlaceholder(card)

      // 快照中的明牌会在后续移动流程里绑定到 mark；这里只摘掉旧“暗占位”身份，不能移走实体。
      if (observedCards.has(card)) return

      const isSameMarkSpace =
        card.location === 'player' &&
        card.subZone === 'mark' &&
        Number(card.spellID) === Number(record.spellID)
      if (!isSameMarkSpace) return

      // 装备容器已经给出“全明且只有这些牌”的快照时，旧匿名/暗实体只是在维护未知数量，
      // 现在该数量已被快照归零，应退出玩家区，避免下一次洗牌继续保留幽灵占位。
      this.room.removeCardsFromConstraintGroups([card])
      card.moveToPublicZone('outside')
      clearedPlaceholderIDs.push(card.id)
    })

    return clearedPlaceholderIDs
  }

  /**
   * 将仍在 unlocated 的协议正 ID 物化到本记录的 mark 匿名占位上。
   * 解决“账本/协议已认定身份，占位仍匿名、cardIndex 无实体”的核心脱钩。
   */
  materializeUnlocatedIdentitiesOntoMarkPlaceholders(
    record: HiddenMarkRecord,
    identityIDs: CardID[],
    reason: string
  ): { cardID: CardID; placeholderEntityID: number }[] {
    const materialized: { cardID: CardID; placeholderEntityID: number }[] = []
    const pendingIDs = identityIDs
      .map((id) => Number(id))
      .filter(
        (id) => id > 0 && !this.room.cardIndex.has(id) && this.room.unlocatedIdentities.has(id)
      )
    if (pendingIDs.length === 0) return materialized

    const placeholders = Array.from(record.placeholderCards ?? []).filter(
      (card) =>
        isAnonymousCard(card) &&
        card.location === 'player' &&
        card.subZone === 'mark' &&
        Number(card.spellID) === Number(record.spellID)
    )

    pendingIDs.forEach((cardID) => {
      const placeholder = placeholders.shift()
      if (!placeholder) return

      const previousEntityID = Number(placeholder.entityID)
      const resolved = this.room.materialize(cardID, placeholder)
      if (!resolved) return

      record.placeholderCards.delete(placeholder)
      this.removeHiddenMarkPlaceholder(placeholder)
      record.cards.add(resolved)
      // 只物化身份到占位，不在此 confirmedMark：
      // 调用方（木马快照）再确认 mark；hand 出牌路径禁止把“从手牌离开的牌”记成 mark。
      record.confirmedHandCards.delete(resolved)
      materialized.push({ cardID, placeholderEntityID: previousEntityID })
    })

    if (materialized.length > 0) {
      trackerLogger.info('暗置标记占位物化未定位身份', {
        reason,
        spellID: record.spellID,
        sourceSeat: record.sourceSeat,
        targetSeat: record.targetSeat,
        materialized,
        remainingPlaceholderCount: record.placeholderCards.size,
        remainingPendingIDs: pendingIDs.filter((id) => !this.room.cardIndex.has(id))
      })
    }

    return materialized
  }

  /**
   * 标记确认后：正 ID 实体落在 mark/container，并从占位账本摘掉对应匿名。
   */
  bindConfirmedMarkCardToMarkSpace(record: HiddenMarkRecord, card: Card, reason: string): boolean {
    if (!(card.id > 0)) return false

    const candidate = this.getHiddenMarkTargetLocationCandidate(record)
    let changed = false

    card.confirmKnown()

    if (candidate.type === 'container') {
      // 容器候选：身份确认后挂 container 候选；展示座位由装备当前位置投影。
      if (card.location === 'player' && !card.hasLocationCandidate?.(candidate)) {
        const next = [...(card.getLocationCandidates?.() ?? []), candidate]
        changed = card.setLocationCandidates(next, reason) || changed
      }
    } else if (candidate.type === 'player') {
      if (card.subZone !== 'mark' || Number(card.spellID) !== Number(record.spellID)) {
        changed = card.resolveLocationCandidate(candidate, reason) || changed
      }
    }

    // 确认后 mark 名额由正 ID 承担：回收仍挂在账本上的多余匿名占位（非本实体）。
    const sparePlaceholders = Array.from(record.placeholderCards ?? []).filter(
      (placeholder) =>
        isAnonymousCard(placeholder) &&
        placeholder !== card &&
        placeholder.entityID !== card.entityID &&
        placeholder.location === 'player' &&
        placeholder.subZone === 'mark' &&
        Number(placeholder.spellID) === Number(record.spellID)
    )
    if (
      sparePlaceholders.length > 0 &&
      (card.subZone === 'mark' || candidate.type === 'container')
    ) {
      const placeholder = sparePlaceholders[0]
      record.placeholderCards.delete(placeholder)
      this.removeHiddenMarkPlaceholder(placeholder)
      this.room.removeCardsFromConstraintGroups([placeholder])
      // 玩家 mark（木马等）占位取自来源手牌，是真实物理牌：当正 ID 确认占住 mark 名额、
      // 把该占位挤出时，被挤出的其实是当初留在手牌里的那张，应挤回来源手牌，
      // 而不是丢进 outside——否则来源手牌凭空少一张，后续 known 物化找不到匿名槽会 createExternal。
      // 容器投影占位无手牌物理背书，维持回收到 outside。
      const recycleToHand = card.subZone === 'mark' && candidate.type !== 'container'
      if (recycleToHand) {
        placeholder.bindCandidates([record.sourceSeat], 'hand', null, { known: false })
      } else {
        placeholder.moveToPublicZone('outside')
      }
      trackerLogger.info('暗置标记确认后回收匿名占位', {
        reason,
        spellID: record.spellID,
        confirmedCardID: card.id,
        recycledPlaceholderEntityID: placeholder.entityID,
        recycledTo: recycleToHand ? 'sourceHand' : 'outside',
        sourceSeat: record.sourceSeat,
        targetSeat: record.targetSeat
      })
      changed = true
    }

    return changed
  }

  /** 实体 ID 被公共来源替换时，隐藏标记账本要继续指向新的暗占位实体 */
  replaceHiddenMarkPlaceholder(previousCard: Card, nextCard: Card): void {
    const state = this.room.skillState.get(HIDDEN_MARK_STATE_KEY) as HiddenMarkState | undefined
    if (!state?.records?.size) return

    state.records.forEach((record) => {
      if (record.placeholderCards?.delete(previousCard)) {
        record.placeholderCards.add(nextCard)
      }
    })
  }

  /**
   * 清理精确数量约束，但保留卡牌上的候选位置。
   * 弱推断仍然有展示价值，不能因为无法强收敛就删掉候选位置。
   */
  clearHiddenMarkProjection(record: HiddenMarkRecord): void {
    this.deleteConstraintGroupAndMarkDirty(record.groupID, 'hiddenMark:clearProjection')
  }

  /**
   * 将 Room.skillState 账本投影到卡牌与约束组。
   *
   * 弱记录：只给卡牌追加“可能在标记区”的完整位置候选。
   * 强约束：当 min/max 相等且候选全集只剩来源手牌/目标标记时，
   * 创建 expectedSlotsBySubZone，使 4 选 1、4 选 3 等 N 选 K 自动收敛。
   */
  applyHiddenMarkProjection(record: HiddenMarkRecord): boolean {
    const exactMarkCount = record.knownMarkMin
    const activeCards = Array.from(record.cards).filter(
      (card) =>
        card.location === 'player' &&
        card.isKnown === true &&
        !record.confirmedHandCards.has(card) &&
        !record.confirmedMarkCards.has(card)
    )

    if (activeCards.length === 0) return false

    let changed = false
    const canCreateExactConstraint = this.canCreateHiddenMarkSubZoneConstraint(record, activeCards)
    activeCards.forEach((card) => {
      card.confirmKnown()
      changed =
        card.setLocationCandidates(
          this.getHiddenMarkLocationCandidates(card, record),
          'hiddenMark:projection'
        ) || changed
    })

    // 暗置数量还只是范围时，只展示候选位置，不创建数量约束。
    if (record.knownMarkMin !== record.knownMarkMax) {
      this.clearHiddenMarkProjection(record)
      return changed
    }

    // 若还有其他角色/子区候选，数量约束会过强；等待既有约束继续收敛。
    if (!canCreateExactConstraint) {
      this.clearHiddenMarkProjection(record)
      return changed
    }

    const remainingMarkCount = Math.max(
      0,
      Math.min(activeCards.length, exactMarkCount - record.confirmedMarkCards.size)
    )
    const remainingHandCount = Math.max(0, activeCards.length - remainingMarkCount)
    const handCandidate: PlayerLocationCandidate = {
      type: 'player',
      seatID: record.sourceSeat,
      subZone: 'hand',
      spellID: null
    }
    const markCandidate = this.getHiddenMarkTargetLocationCandidate(record)
    const subZoneSlots = new Map<string, number>()
    const handSubZoneCandidate = toSubZoneCandidate(handCandidate)
    const handSubZoneKey = handSubZoneCandidate
      ? createSubZoneCandidateKey(handSubZoneCandidate)
      : ''
    const markSubZoneCandidate = toSubZoneCandidate(markCandidate)
    const markSubZoneKey = markSubZoneCandidate
      ? createSubZoneCandidateKey(markSubZoneCandidate)
      : ''

    if (handSubZoneKey) subZoneSlots.set(handSubZoneKey, remainingHandCount)
    // container 无法镜像成 subZone，只参与 expectedSlotsByLocation 精确约束。
    if (markSubZoneKey) subZoneSlots.set(markSubZoneKey, remainingMarkCount)

    // expectedSlotsBySubZone 是真正的 N 选 K 约束：
    // activeCards 中还应有 remainingHandCount 张在手牌，remainingMarkCount 张在标记区。
    this.room.createConstraintGroup({
      id: record.groupID,
      cards: activeCards,
      candidateSeats: Array.from(new Set([record.sourceSeat, record.targetSeat])),
      expectedSlotsByLocation: new Map([
        [createLocationCandidateKey(handCandidate), remainingHandCount],
        [createLocationCandidateKey(markCandidate), remainingMarkCount]
      ]),
      expectedSlotsBySubZone: subZoneSlots,
      known: true,
      sourceEvent: record.sourceEvent
    })

    return true
  }

  /**
   * 当候选明牌后续以明确来源移动时，反向确认它原先属于手牌或标记区。
   * 例如从标记区明置进弃牌，则确认该牌占用标记区名额。
   */
  /**
   * 整手完整揭示时，对来源手牌的木马/标记弱候选做局部反向收敛。
   *
   * 触发：一次移动来源是座位 S 手牌，且本次离场的都是明牌、数量等于 S 已观测手牌总数
   * （= 完整揭示了当前手牌全部内容）。此时任一「仍把 hand 作为候选、却不在揭示 ID 里」的
   * 候选明牌（如木马候选 141），逻辑上必在标记区 → 确认进 mark，并把被挤出的匿名占位
   * 挤回来源手牌（物理守恒），使随后的 known 物化能拿到正确数量的手牌匿名槽。
   *
   * 必须在 resolveKnownMoveCards 之前调用：否则匿名槽数量在物化时已错、明牌会被 createExternal。
   */
  resolveHiddenMarkCandidatesFromFullHandReveal(context: RoomMoveContext): boolean {
    const state = this.room.skillState.get(HIDDEN_MARK_STATE_KEY) as HiddenMarkState | undefined
    if (!state?.records?.size) return false

    const seat = context.sourceHandSeat
    if (seat === null || context.fromSubZone !== 'hand') return false

    // 完整揭示：全为明牌 && 数量 == 该座位已观测手牌总数
    const isFullHandReveal =
      context.sourceHandTotalObserved &&
      context.unknownCount === 0 &&
      context.knownIDs.length > 0 &&
      context.knownIDs.length === context.cardCount &&
      context.cardCount === context.sourceHandTotalBefore
    if (!isFullHandReveal) return false

    const revealedIDs = new Set(context.knownIDs.map((id) => Number(id)))
    let changed = false
    const records: HiddenMarkRecord[] = []
    state.records.forEach((record) => records.push(record))

    records.forEach((record) => {
      if (state.records.get(record.id) !== record) return
      if (Number(record.sourceSeat) !== Number(seat)) return
      if (record.confirmedMarkCards.size >= record.knownMarkMax) return

      const strandedCandidates = Array.from(record.cards).filter((card) => {
        if (!(card.id > 0)) return false
        if (revealedIDs.has(Number(card.id))) return false
        if (record.confirmedMarkCards.has(card)) return false
        if (card.location !== 'player' || !card.seats.has(Number(seat))) return false
        // 仍把 hand 作为可能位置的候选，才需要反向收敛到 mark。
        const handCandidates = this.getCardPlayerLocationCandidates(card)
        return (
          card.subZone === 'hand' ||
          handCandidates.some(
            (candidate) => Number(candidate.seatID) === Number(seat) && candidate.subZone === 'hand'
          )
        )
      })

      strandedCandidates.forEach((card) => {
        if (record.confirmedMarkCards.size >= record.knownMarkMax) return

        const candidate = this.getHiddenMarkTargetLocationCandidate(record)
        card.confirmKnown()
        // 解到标记区并移除 hand 分支：容器（木马 700）collapse 成单一容器候选，
        // player mark 直接 resolve 成 mark。此处已由完整揭示证明该牌不在手牌，可强收敛。
        if (candidate.type === 'container') {
          card.setLocationCandidates([candidate], 'hiddenMark:fullHandReveal')
        } else {
          card.resolveLocationCandidate(candidate, 'hiddenMark:fullHandReveal')
        }
        record.confirmedHandCards.delete(card)
        record.confirmedMarkCards.add(card)

        // 被正 ID 挤出的匿名占位，是当初留在来源手牌里的真实牌 → 挤回来源手牌，
        // 供随后的 known 物化取用；绝不丢 outside（否则来源手牌凭空少一张、明牌被 createExternal）。
        const placeholder = Array.from(record.placeholderCards ?? []).find(
          (ph) =>
            isAnonymousCard(ph) &&
            ph !== card &&
            ph.subZone === 'mark' &&
            Number(ph.spellID) === Number(record.spellID)
        )
        if (placeholder) {
          record.placeholderCards.delete(placeholder)
          this.removeHiddenMarkPlaceholder(placeholder)
          this.room.removeCardsFromConstraintGroups([placeholder])
          placeholder.bindCandidates([record.sourceSeat], 'hand', null, { known: false })
        }
        changed = true

        trackerLogger.info('整手完整揭示反向收敛木马候选', {
          spellID: record.spellID,
          sourceSeat: record.sourceSeat,
          targetSeat: record.targetSeat,
          cardID: card.id,
          revealedIDs: context.knownIDs,
          recycledPlaceholderEntityID: placeholder?.entityID ?? null,
          confirmedMarkCount: record.confirmedMarkCards.size,
          placeholderCount: record.placeholderCards.size
        })
      })

      if (record.confirmedHandCards.size + record.confirmedMarkCards.size >= record.cards.size) {
        state.records.delete(record.id)
      }
    })

    return changed
  }

  resolveHiddenMarkCandidateFromMove(card: Card, context: RoomMoveContext): boolean {
    const state = this.room.skillState.get(HIDDEN_MARK_STATE_KEY) as HiddenMarkState | undefined
    if (!state?.records?.size) return false

    let changed = false
    const records: HiddenMarkRecord[] = []

    state.records.forEach((record) => records.push(record))

    records.forEach((record) => {
      if (state.records.get(record.id) !== record) return
      if (!record.cards.has(card)) return

      record.targetLocationCandidate ??= this.createHiddenMarkTargetLocationCandidate(
        record.spellID,
        record.targetSeat
      )

      if (context.fromSubZone === 'mark') {
        const moveMarkSeat = Number.isFinite(context.fromSeat)
          ? context.fromSeat
          : record.targetSeat
        const moveSpellID =
          context.fromSpellID !== undefined ? context.fromSpellID : (context.spellID ?? null)

        // 同一张明牌可能同时是多个标记账本的候选，必须先匹配实际标记空间。
        if (moveSpellID !== record.spellID) return
        if (moveMarkSeat !== record.targetSeat) {
          if (!getEquipmentMarkContainerByMarkSpellID(record.spellID)) return
          this.retargetHiddenMarkRecord(record, moveMarkSeat)
        }

        const candidate = this.getHiddenMarkTargetLocationCandidate(record)

        // hand/mark 确认互斥
        record.confirmedHandCards.delete(card)
        record.confirmedMarkCards.add(card)
        changed =
          this.bindConfirmedMarkCardToMarkSpace(record, card, 'hiddenMark:confirmedMark') || changed
        if (candidate.type === 'container' && card.hasLocationCandidate?.(candidate)) {
          // 明确来自装备容器时只锁成容器候选；真正显示在哪个座位由装备当前位置决定。
          changed = card.setLocationCandidates([candidate], 'hiddenMark:confirmedMark') || changed
        } else if (card.hasLocationCandidate?.(candidate)) {
          changed = card.resolveLocationCandidate(candidate, 'hiddenMark:confirmedMark') || changed
        } else {
          const subZoneCandidate = toSubZoneCandidate(candidate)
          if (subZoneCandidate && card.hasSubZoneCandidate?.(subZoneCandidate)) {
            changed =
              card.resolveSubZoneCandidate(subZoneCandidate, 'hiddenMark:confirmedMark') || changed
          }
        }
        trackerLogger.info('手牌暗置标记区候选确认进标记', {
          spellID: record.spellID,
          sourceSeat: record.sourceSeat,
          targetSeat: record.targetSeat,
          cardID: card.id,
          fromSubZone: context.fromSubZone,
          fromSpellID: context.fromSpellID ?? context.spellID ?? null,
          confirmedMarkCount: record.confirmedMarkCards.size,
          confirmedHandCount: record.confirmedHandCards.size,
          placeholderCount: record.placeholderCards.size
        })
      } else if (context.fromSubZone === 'hand') {
        const moveHandSeat = Number.isFinite(context.fromSeat)
          ? context.fromSeat
          : record.sourceSeat
        if (moveHandSeat !== record.sourceSeat) return

        const candidate: PlayerLocationCandidate = {
          type: 'player',
          seatID: moveHandSeat,
          subZone: 'hand',
          spellID: null
        }

        // 从手牌离开 = 占用 hand 名额，不能同时算 mark
        record.confirmedMarkCards.delete(card)
        record.confirmedHandCards.add(card)

        if (card.hasLocationCandidate?.(candidate)) {
          changed = card.resolveLocationCandidate(candidate, 'hiddenMark:confirmedHand') || changed
        } else if (card.hasSubZoneCandidate?.(candidate)) {
          changed = card.resolveSubZoneCandidate(candidate, 'hiddenMark:confirmedHand') || changed
        }
        trackerLogger.info('手牌暗置标记区候选确认回手牌', {
          spellID: record.spellID,
          sourceSeat: record.sourceSeat,
          targetSeat: record.targetSeat,
          cardID: card.id,
          fromSubZone: context.fromSubZone,
          confirmedMarkCount: record.confirmedMarkCards.size,
          confirmedHandCount: record.confirmedHandCards.size,
          placeholderCount: record.placeholderCards.size
        })
      }

      if (record.confirmedHandCards.size + record.confirmedMarkCards.size >= record.cards.size) {
        trackerLogger.info('手牌暗置标记区候选账本结清', {
          spellID: record.spellID,
          sourceSeat: record.sourceSeat,
          targetSeat: record.targetSeat,
          confirmedMarkCardIDs: Array.from(record.confirmedMarkCards, (c) => c.id),
          confirmedHandCardIDs: Array.from(record.confirmedHandCards, (c) => c.id),
          remainingPlaceholderCount: record.placeholderCards.size
        })
        state.records.delete(record.id)
      }
    })

    return changed
  }

  getObservedEquipmentMarkSnapshot(context: RoomMoveContext): ObservedEquipmentMarkSnapshot | null {
    if (
      context.toZone !== 'player' ||
      context.fromSubZone !== 'mark' ||
      context.subZone !== 'mark' ||
      context.targetSeats.length !== 1 ||
      context.unknownCount !== 0 ||
      context.knownIDs.length !== context.cardCount
    ) {
      return null
    }

    const markSpellID = context.fromSpellID !== undefined ? context.fromSpellID : context.spellID
    const container = getEquipmentMarkContainerByMarkSpellID(markSpellID)
    if (!container) return null

    const observedSeat = Number(context.targetSeats[0])
    if (!Number.isFinite(observedSeat)) return null

    return {
      markSpellID,
      observedSeat
    }
  }

  /**
   * 装备容器标记区出现完整快照时，按可见结果收敛暗标记账本。
   */
  resolveHiddenMarkCandidatesFromObservedMarkSnapshot(context: RoomMoveContext): boolean {
    const state = this.room.skillState.get(HIDDEN_MARK_STATE_KEY) as HiddenMarkState | undefined
    if (!state?.records?.size) return false

    const snapshot = this.getObservedEquipmentMarkSnapshot(context)
    // knownIDs/cardCount 全明约束已在 getObservedEquipmentMarkSnapshot 内校验；
    // 这里只保留 snapshot 与 cardCount 边界。即使部分身份尚未物化，也按协议 ID 收敛弱候选。
    if (!snapshot || context.cardCount <= 0) {
      return false
    }

    const { markSpellID, observedSeat } = snapshot

    let changed = false
    const observedCards = new Set(context.knownCards)
    const observedCardIDs = new Set(context.knownIDs.map(Number))
    const resolvedHandCardIDs: CardID[] = []
    const clearedPlaceholderIDs: CardID[] = []
    const records = Array.from(state.records.values())

    records.forEach((record) => {
      if (state.records.get(record.id) !== record) return
      if (Number(record.spellID) !== markSpellID) return

      const targetCandidate = this.getHiddenMarkTargetLocationCandidate(record)
      if (targetCandidate.type !== 'container') return

      if (record.targetSeat !== observedSeat) {
        changed = this.retargetHiddenMarkRecord(record, observedSeat) || changed
      }

      const materialized = this.materializeUnlocatedIdentitiesOntoMarkPlaceholders(
        record,
        context.knownIDs,
        'hiddenMark:observedContainerSnapshot'
      )
      if (materialized.length > 0) {
        materialized.forEach(({ cardID }) => {
          const card = this.room.cardIndex.get(cardID)
          if (card) {
            observedCards.add(card)
            record.cards.add(card)
          }
        })
        changed = true
      }

      const clearedRecordPlaceholderIDs = this.clearHiddenMarkPlaceholdersForObservedSnapshot(
        record,
        observedCards
      )
      if (clearedRecordPlaceholderIDs.length > 0) {
        clearedPlaceholderIDs.push(...clearedRecordPlaceholderIDs)
        changed = true
      }

      context.knownIDs.forEach((cardID) => {
        const card = this.room.cardIndex.get(Number(cardID))
        if (!card) return
        if (
          !record.cards.has(card) &&
          !materialized.some((item) => item.cardID === Number(cardID))
        ) {
          return
        }
        record.cards.add(card)
        if (record.confirmedMarkCards.has(card)) return
        record.confirmedMarkCards.add(card)
        record.confirmedHandCards.delete(card)
        changed =
          this.bindConfirmedMarkCardToMarkSpace(
            record,
            card,
            'hiddenMark:observedContainerSnapshot:mark'
          ) || changed
      })

      record.cards.forEach((card) => {
        if (
          observedCards.has(card) ||
          observedCardIDs.has(Number(card.id)) ||
          record.confirmedMarkCards.has(card)
        ) {
          return
        }
        record.confirmedHandCards.add(card)

        if (card.hasLocationCandidate?.(targetCandidate)) {
          changed =
            card.removeLocationCandidate(targetCandidate, 'hiddenMark:observedContainerSnapshot') ||
            changed
          resolvedHandCardIDs.push(card.id)
        }
      })

      this.clearHiddenMarkProjection(record)
      changed = this.applyHiddenMarkProjection(record) || changed

      if (record.confirmedHandCards.size + record.confirmedMarkCards.size >= record.cards.size) {
        trackerLogger.info('手牌暗置标记区候选账本结清', {
          spellID: record.spellID,
          sourceSeat: record.sourceSeat,
          targetSeat: record.targetSeat,
          reason: 'observedContainerSnapshot',
          confirmedMarkCardIDs: Array.from(record.confirmedMarkCards, (c) => c.id),
          confirmedHandCardIDs: Array.from(record.confirmedHandCards, (c) => c.id),
          remainingPlaceholderCount: record.placeholderCards.size
        })
        state.records.delete(record.id)
      }
    })

    trackerLogger.info('手牌暗置标记区候选按可见装备容器快照收敛', {
      spellID: markSpellID,
      targetSeat: observedSeat,
      visibleCardIDs: context.knownIDs,
      resolvedHandCardIDs,
      clearedPlaceholderIDs,
      knownCardCount: context.knownCards.length,
      knownIDs: context.knownIDs
    })

    return changed
  }
}
