import { trackerLogger } from '@/utils/logger'
import { isAnonymous } from '../Card'
import {
  createEquipmentContainerLocationCandidate,
  getEquipmentMarkContainerByMarkSpellID
} from '../candidate/equipmentMarkContainer'
import { isHiddenMarkMove } from '../candidate/hiddenMarkMove'
import {
  createLocationCandidateKey,
  fromSubZoneCandidate,
  getPlayerLocationCandidates,
  toSubZoneCandidate
} from '../candidate/locationCandidate'
import type { SpellIDInput } from '../candidate/markSpellID'
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
import {
  HIDDEN_MARK_STATE_KEY,
  type HiddenMarkRecord,
  type HiddenMarkState,
  type RoomMoveContext
} from './types'

interface ObservedEquipmentMarkSnapshot {
  markSpellID: SpellID
  observedSeat: SeatID
}

export abstract class RoomMovementHiddenMarkMethods {
  declare room: Room

  abstract takeUnknownCardsFromPlayer(
    seatID: SeatID,
    count: number,
    subZone?: SubZone,
    spellIDs?: SpellIDInput | SpellIDInput[]
  ): Card[]

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
   * 按标记空间推导目标候选，不在账本中重复缓存可派生状态。
   */
  getHiddenMarkTargetLocationCandidate(record: HiddenMarkRecord): LocationCandidate {
    return this.createHiddenMarkTargetLocationCandidate(record.spellID, record.targetSeat)
  }

  /** 以实际 mark700 协议更新空间座位；跨座位时接管内部牌迁移。 */
  handleMuniuMarkMove(context: RoomMoveContext): boolean {
    if (
      context.toZone !== 'player' ||
      context.subZone !== 'mark' ||
      context.targetSeats.length !== 1 ||
      context.cardCount <= 0 ||
      !getEquipmentMarkContainerByMarkSpellID(context.spellID)
    ) {
      return false
    }

    const targetSeat = context.targetSeats[0]
    const state = this.getHiddenMarkState()
    if (state.muniuMarkSeat !== targetSeat) {
      state.muniuMarkSeat = targetSeat
      this.room.markConstraintGroupsDirty('muniu:markSeat')
    }

    const sourceSpellID = context.fromSpellID ?? context.spellID
    if (
      context.fromSubZone !== 'mark' ||
      sourceSpellID !== context.spellID ||
      !Number.isFinite(context.fromSeat) ||
      context.fromSeat === targetSeat
    ) {
      return false
    }

    this.moveMuniuMarkSpace(context.spellID, context.fromSeat, targetSeat)
    // 同一容器换座不会改变牌面可见性或身份；不能再按普通暗牌移动搬一次。
    context.skipUnknownMovement = true
    return true
  }

  /**
   * 收到 mark700 跨座位协议后，迁移该空间的实体与候选账本。
   */
  private moveMuniuMarkSpace(spellID: SpellID, fromSeat: SeatID, targetSeat: SeatID): void {
    const records = Array.from(this.getHiddenMarkState().records.values()).filter(
      (record) => record.spellID === spellID && record.targetSeat === fromSeat
    )
    records.forEach((record) => this.retargetMuniuRecord(record, targetSeat))

    const movedMarkCardIDs: CardID[] = []
    this.room.cards.forEach((card) => {
      if (
        card.location !== 'player' ||
        card.subZone !== 'mark' ||
        card.spellID !== spellID ||
        !card.seats.has(fromSeat) ||
        card.hasLocationCandidates() ||
        card.hasSubZoneCandidates()
      ) {
        return
      }

      // 迁移空间不改变牌面可见性；已知牌与匿名占位都保留原实体。
      card.setSeats([targetSeat], 'moveMuniuMarkSpace')
      movedMarkCardIDs.push(card.id)
    })

    if (records.length > 0 || movedMarkCardIDs.length > 0) {
      trackerLogger.info('木牛流马内部牌按标记空间协议迁移', {
        spellID,
        fromSeat,
        targetSeat,
        movedMarkCardIDs,
        retargetedRecordIDs: records.map((record) => record.id)
      })
    }
  }

  /**
   * 更新木牛流马账本的承载座位，保留稳定的账本与约束组 ID。
   */
  private retargetMuniuRecord(record: HiddenMarkRecord, targetSeat: SeatID): boolean {
    if (!getEquipmentMarkContainerByMarkSpellID(record.spellID)) return false
    if (targetSeat === record.targetSeat) return false

    const previousTargetSeat = record.targetSeat
    // 只有木牛流马会迁座；账本和约束组身份固定，只更新承载座位与投影。
    record.targetSeat = targetSeat
    record.placeholderCards.forEach((card) => {
      if (
        card.location === 'player' &&
        card.subZone === 'mark' &&
        card.spellID === record.spellID
      ) {
        card.bindCandidates([targetSeat], 'mark', record.spellID, { known: false })
      }
    })
    // 完整容器位置 key 不变，但约束的 candidateSeats 仍需要同步。
    this.removeHiddenMarkConstraint(record)
    this.applyHiddenMarkProjection(record)
    trackerLogger.info('木牛流马暗标记账本更新承载座位', {
      recordID: record.id,
      sourceSeat: record.sourceSeat,
      previousTargetSeat,
      targetSeat,
      candidateCardIDs: Array.from(record.cards, (card) => card.id)
    })

    return true
  }

  /**
   * 获取手牌暗置到标记区的房间级候选账本。
   */
  getHiddenMarkState(): HiddenMarkState {
    return this.room.ensureSkillState(HIDDEN_MARK_STATE_KEY, () => {
      return { records: new Map<string, HiddenMarkRecord>(), muniuMarkSeat: null }
    })
  }

  /**
   * 判断本次移动是否是“协议全暗的手牌牌进入技能标记区”。
   * 这类移动不能按普通暗牌占位处理，因为来源手牌中可能已有明牌身份。
   */
  isHiddenMarkMove(context: RoomMoveContext): boolean {
    return isHiddenMarkMove(context)
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
   * 才能把暗置数量升级为精确完整位置约束。
   * 如果仍存在 B 手牌等其他候选位置，只记录候选，不做 N 选 K 强收敛。
   */
  private canCreateExactHiddenMarkConstraint(
    record: HiddenMarkRecord,
    candidateLists: LocationCandidate[][]
  ): boolean {
    const targetCandidateKey = createLocationCandidateKey(
      this.getHiddenMarkTargetLocationCandidate(record)
    )

    return candidateLists.every((candidates) =>
      candidates.every(
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
   * 2. 通过 Room API 写入 GameState 的 tracker 状态，保留本次技能/座位维度的候选关系。
   * 3. 接管默认暗牌移动，避免错误地只搬走未知占位牌。
   * 4. 尝试把账本投影成可见候选位置与可收敛约束。
   */
  handleHiddenMarkMove(context: RoomMoveContext): boolean {
    if (!this.isHiddenMarkMove(context)) return false

    const sourceSeat = context.sourceHandSeat
    const targetSeat = context.targetSeats[0]
    const candidateCards = this.getKnownHandCandidatesForHiddenMark(sourceSeat)
    // 没有可展示的明牌身份时，沿用普通暗牌移动。
    if (candidateCards.length === 0) return false

    const state = this.getHiddenMarkState()
    const spellID = context.spellID ?? null
    const muniu = getEquipmentMarkContainerByMarkSpellID(spellID)
    // 只有木牛流马的标记空间随装备迁座；不同来源手牌仍分别记账。
    const recordKey = muniu
      ? `${sourceSeat}:muniu:${muniu.equipmentCardID}`
      : [sourceSeat, targetSeat, spellID ?? 'none'].join(':')

    let record = state.records.get(recordKey)
    if (!record) {
      record = {
        id: recordKey,
        groupID: `hidden_mark_${recordKey}`,
        sourceSeat,
        targetSeat,
        spellID,
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
    this.retargetMuniuRecord(record, targetSeat)

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

  /** 来源牌已由调用方筛选；优先使用候选所属账本的占位，避免跨来源重复回收。 */
  protected findHiddenMarkSourcePlaceholder(card: Card, sourceCards: Card[]): Card | null {
    const state = this.room.readSkillState<HiddenMarkState>(HIDDEN_MARK_STATE_KEY)
    if (!state) return null

    for (const record of state.records.values()) {
      if (!record.cards.has(card)) continue
      const placeholder = sourceCards.find((sourceCard) => record.placeholderCards.has(sourceCard))
      if (placeholder) return placeholder
    }
    return null
  }

  // 某个暗标记占位被已知牌替换后，从旧账本中摘掉，避免后续重复迁移。
  removeHiddenMarkPlaceholder(card: Card): void {
    const state = this.room.readSkillState<HiddenMarkState>(HIDDEN_MARK_STATE_KEY)
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
      // 若占位带正 ID，该 ID 只是此前暗移动留下的内部绑定；先释放身份再删除物理槽，
      // 否则它会落入 outside/REMOVED 并从后续洗牌的身份差集中消失。
      this.room.removeCardsFromConstraintGroups([card])
      const placeholderCardID = card.id
      this.room.releaseUnknownPlaceholderToOutside(
        card,
        'clearHiddenMarkPlaceholdersForObservedSnapshot'
      )
      clearedPlaceholderIDs.push(placeholderCardID)
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
        isAnonymous(card) &&
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
      // 容器候选：身份确认后挂 container 候选；展示座位由 mark 空间观测决定。
      if (card.location === 'player' && !card.hasLocationCandidate?.(candidate)) {
        const next = [...(card.getLocationCandidates?.() ?? []), candidate]
        changed = card.setLocationCandidates(next, reason) || changed
      }
    } else if (candidate.type === 'player') {
      if (card.subZone !== 'mark' || Number(card.spellID) !== Number(record.spellID)) {
        changed = card.resolveLocationCandidate(candidate, reason) || changed
      }
    }

    // 确认后 mark 名额由正 ID 承担：溢出的匿名占位统一经守恒原语挤回来源手牌。
    changed = this.reconcileMarkSpace(record, reason) || changed

    return changed
  }

  /**
   * 判断账本引用是否仍是本记录的“存活匿名 mark 占位”。
   * 与 bindConfirmedMarkCardToMarkSpace / materialize / full-hand-reveal 的筛选谓词一致，
   * 避免误回收已回手、已物化或其它 spell 的实体。
   */
  private isLiveHiddenMarkPlaceholder(card: Card, record: HiddenMarkRecord): boolean {
    return (
      isAnonymous(card) &&
      card.location === 'player' &&
      card.subZone === 'mark' &&
      Number(card.spellID) === Number(record.spellID)
    )
  }

  /**
   * 按账本累计暗置额度回收溢出匿名占位。
   *
   * hiddenCount 是累计暗置数量，不是当前 mark 容量；确认集合也保留历史名额。
   * 仅当存活匿名占位 + 仍占 mark 名额的确认牌超过额度时回收占位。
   * 牌离开后允许不足，不在这里补造实体，也不承诺数量始终相等。
   *
   * 当正 ID 确认占住 mark 名额、令占位溢出时，把多余匿名占位挤回 **来源手牌**：
   * 这些占位经 moveHiddenMarkPlaceholders 从 sourceSeat 手牌取得，是真实物理牌；
   * 被挤出的其实是当初留在手牌里的那张，回收判据是“是否有来源手牌物理背书”，
   * 与目标是 player mark 还是 container（如木马 700）无关——绝不丢 outside，
   * 否则来源手牌凭空少一张、随后 known 物化找不到匿名槽会 createExternal。
   *
   * 注：纯容器投影 / 观察快照孤儿占位（无手牌背书）的 outside 回收由
   * clearHiddenMarkPlaceholdersForObservedSnapshot 单独负责，不走本原语。
   *
   * @returns 是否发生实体位置或账本变更
   */
  reconcileMarkSpace(record: HiddenMarkRecord, reason: string): boolean {
    const livePlaceholders = Array.from(record.placeholderCards ?? []).filter((card) =>
      this.isLiveHiddenMarkPlaceholder(card, record)
    )

    // confirmedMarkCards 中仍占物理 mark 名额的正 ID：每张占用一个 hiddenCount 名额。
    const confirmedMarkSlotUsers = Array.from(record.confirmedMarkCards).filter((card) =>
      this.occupiesHiddenMarkSlot(card, record)
    ).length

    const overflow = livePlaceholders.length + confirmedMarkSlotUsers - record.hiddenCount
    if (overflow <= 0) return false

    const recycledPlaceholderEntityIDs: number[] = []
    const evictCount = Math.min(overflow, livePlaceholders.length)
    if (evictCount <= 0) {
      // confirmedMarkSlotUsers 已超过 hiddenCount，但没有存活占位可回收——
      // 说明账本配额被上游突破，需要显式告警而不是假装发生了变更。
      trackerLogger.warn('mark 空间守恒溢出但无可回收占位', {
        reason,
        spellID: record.spellID,
        sourceSeat: record.sourceSeat,
        targetSeat: record.targetSeat,
        hiddenCount: record.hiddenCount,
        confirmedMarkSlotUsers,
        overflow
      })
      return false
    }
    for (let index = 0; index < evictCount; index += 1) {
      const placeholder = livePlaceholders[index]
      record.placeholderCards.delete(placeholder)
      this.removeHiddenMarkPlaceholder(placeholder)
      this.room.removeCardsFromConstraintGroups([placeholder])
      placeholder.bindCandidates([record.sourceSeat], 'hand', null, { known: false })
      recycledPlaceholderEntityIDs.push(placeholder.entityID)
    }

    trackerLogger.debug('mark 空间守恒回收溢出匿名占位', {
      reason,
      spellID: record.spellID,
      sourceSeat: record.sourceSeat,
      targetSeat: record.targetSeat,
      hiddenCount: record.hiddenCount,
      confirmedMarkSlotUsers,
      overflow,
      recycledPlaceholderEntityIDs,
      remainingPlaceholderCount: record.placeholderCards.size
    })

    return true
  }

  /**
   * 判断已确认正 ID 是否仍占用本记录的 mark 物理名额。
   * player mark 直接看 subZone/spellID；container（木马等）看容器候选或落在 mark 空间。
   */
  private occupiesHiddenMarkSlot(card: Card, record: HiddenMarkRecord): boolean {
    if (!(card.id > 0)) return false

    const inMarkSpace =
      card.location === 'player' &&
      card.subZone === 'mark' &&
      Number(card.spellID) === Number(record.spellID)
    if (inMarkSpace) return true

    const candidate = this.getHiddenMarkTargetLocationCandidate(record)
    return candidate.type === 'container' && card.hasLocationCandidate?.(candidate) === true
  }

  /** 实体 ID 被公共来源替换时，隐藏标记账本要继续指向新的暗占位实体 */
  replaceHiddenMarkPlaceholder(previousCard: Card, nextCard: Card): void {
    const state = this.room.readSkillState<HiddenMarkState>(HIDDEN_MARK_STATE_KEY)
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
  private removeHiddenMarkConstraint(record: HiddenMarkRecord): void {
    if (this.room.deleteConstraintGroup(record.groupID)) {
      this.room.markConstraintGroupsDirty('hiddenMark:removeConstraint')
    }
  }

  /**
   * 将当前一局的 tracker 状态账本投影到卡牌与约束组。
   *
   * 弱记录：只给卡牌追加“可能在标记区”的完整位置候选。
   * 强约束：当 min/max 相等且候选全集只剩来源手牌/目标标记时，
   * 创建 expectedSlotsBySubZone，使 4 选 1、4 选 3 等 N 选 K 自动收敛。
   */
  applyHiddenMarkProjection(record: HiddenMarkRecord): boolean {
    const activeCards = Array.from(record.cards).filter(
      (card) =>
        card.location === 'player' &&
        card.isKnown === true &&
        !record.confirmedHandCards.has(card) &&
        !record.confirmedMarkCards.has(card)
    )

    if (activeCards.length === 0) return false

    let changed = false
    const candidateLists = activeCards.map((card) =>
      this.getHiddenMarkLocationCandidates(card, record)
    )
    const canCreateExactConstraint = this.canCreateExactHiddenMarkConstraint(record, candidateLists)
    activeCards.forEach((card, index) => {
      card.confirmKnown()
      changed =
        card.setLocationCandidates(candidateLists[index], 'hiddenMark:projection') || changed
    })

    return this.syncHiddenMarkConstraint(record, activeCards, canCreateExactConstraint) || changed
  }

  /** 同步精确数量约束；范围或其他位置分支尚未收敛时，只保留候选投影。 */
  private syncHiddenMarkConstraint(
    record: HiddenMarkRecord,
    activeCards: Card[],
    canCreateExactConstraint: boolean
  ): boolean {
    if (record.knownMarkMin !== record.knownMarkMax || !canCreateExactConstraint) {
      this.removeHiddenMarkConstraint(record)
      return false
    }

    const remainingMarkCount = Math.max(
      0,
      Math.min(activeCards.length, record.knownMarkMin - record.confirmedMarkCards.size)
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

    // expectedSlotsByLocation 承载 N 选 K，subZone 只镜像可表达的位置：
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
    const state = this.room.readSkillState<HiddenMarkState>(HIDDEN_MARK_STATE_KEY)
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
        this.setHiddenMarkConfirmation(record, card, 'mark')
        changed = true

        trackerLogger.info('整手完整揭示反向收敛木马候选', {
          spellID: record.spellID,
          sourceSeat: record.sourceSeat,
          targetSeat: record.targetSeat,
          cardID: card.id,
          revealedIDs: context.knownIDs,
          confirmedMarkCount: record.confirmedMarkCards.size,
          placeholderCount: record.placeholderCards.size
        })
      })

      // 被正 ID 挤出的匿名占位由守恒原语统一挤回来源手牌，供随后 known 物化取用；
      // 绝不丢 outside（否则来源手牌凭空少一张、明牌被 createExternal）。
      if (strandedCandidates.length > 0) {
        changed = this.reconcileMarkSpace(record, 'hiddenMark:fullHandReveal') || changed
      }

      this.settleHiddenMarkRecord(record, 'fullHandReveal')
    })

    return changed
  }

  resolveHiddenMarkCandidateFromMove(card: Card, context: RoomMoveContext): boolean {
    const state = this.room.readSkillState<HiddenMarkState>(HIDDEN_MARK_STATE_KEY)
    if (!state?.records?.size) return false

    let changed = false
    const records: HiddenMarkRecord[] = []

    state.records.forEach((record) => records.push(record))

    records.forEach((record) => {
      if (state.records.get(record.id) !== record) return
      if (!record.cards.has(card)) return

      if (context.fromSubZone === 'mark') {
        const moveSpellID =
          context.fromSpellID !== undefined ? context.fromSpellID : (context.spellID ?? null)
        const movesMuniuSpace =
          context.toZone === 'player' &&
          context.subZone === 'mark' &&
          context.targetSeats.length === 1 &&
          context.spellID === moveSpellID &&
          getEquipmentMarkContainerByMarkSpellID(moveSpellID) !== null
        // mark700 迁座已在候选传播阶段完成；随后揭示身份不能按旧 FromID 把账本迁回去。
        const moveMarkSeat = movesMuniuSpace
          ? context.targetSeats[0]
          : Number.isFinite(context.fromSeat)
            ? context.fromSeat
            : record.targetSeat

        // 同一张明牌可能同时是多个标记账本的候选，必须先匹配实际标记空间。
        if (moveSpellID !== record.spellID) return
        if (moveMarkSeat !== record.targetSeat) {
          if (!getEquipmentMarkContainerByMarkSpellID(record.spellID)) return
          this.retargetMuniuRecord(record, moveMarkSeat)
        }

        const candidate = this.getHiddenMarkTargetLocationCandidate(record)

        // hand/mark 确认互斥
        this.setHiddenMarkConfirmation(record, card, 'mark')
        changed =
          this.bindConfirmedMarkCardToMarkSpace(record, card, 'hiddenMark:confirmedMark') || changed
        if (candidate.type === 'container' && card.hasLocationCandidate?.(candidate)) {
          // 明确来自装备容器时只锁成容器候选；显示座位由 mark 空间观测决定。
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
        this.setHiddenMarkConfirmation(record, card, 'hand')

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

      this.settleHiddenMarkRecord(record, 'move')
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
    const state = this.room.readSkillState<HiddenMarkState>(HIDDEN_MARK_STATE_KEY)
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
        changed = this.retargetMuniuRecord(record, observedSeat) || changed
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
        this.setHiddenMarkConfirmation(record, card, 'mark')
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
        this.setHiddenMarkConfirmation(record, card, 'hand')

        if (card.hasLocationCandidate?.(targetCandidate)) {
          changed =
            card.removeLocationCandidate(targetCandidate, 'hiddenMark:observedContainerSnapshot') ||
            changed
          resolvedHandCardIDs.push(card.id)
        }
      })

      this.removeHiddenMarkConstraint(record)
      changed = this.applyHiddenMarkProjection(record) || changed

      this.settleHiddenMarkRecord(record, 'observedContainerSnapshot')
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

  /** 确认的是账本历史名额；实际位置仍由各入口按证据强度绑定。 */
  private setHiddenMarkConfirmation(
    record: HiddenMarkRecord,
    card: Card,
    subZone: 'hand' | 'mark'
  ): void {
    const confirmed = subZone === 'hand' ? record.confirmedHandCards : record.confirmedMarkCards
    const opposite = subZone === 'hand' ? record.confirmedMarkCards : record.confirmedHandCards
    opposite.delete(card)
    confirmed.add(card)
  }

  private settleHiddenMarkRecord(record: HiddenMarkRecord, reason: string): void {
    if (record.confirmedHandCards.size + record.confirmedMarkCards.size < record.cards.size) return

    trackerLogger.info('手牌暗置标记区候选账本结清', {
      spellID: record.spellID,
      sourceSeat: record.sourceSeat,
      targetSeat: record.targetSeat,
      reason,
      confirmedMarkCardIDs: Array.from(record.confirmedMarkCards, (card) => card.id),
      confirmedHandCardIDs: Array.from(record.confirmedHandCards, (card) => card.id),
      remainingPlaceholderCount: record.placeholderCards.size
    })
    this.getHiddenMarkState().records.delete(record.id)
  }
}
