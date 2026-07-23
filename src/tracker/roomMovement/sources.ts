import { trackerLogger } from '@/utils/logger'
import { POSITION_TOP } from '../candidate/cardPositions'
import { getCompatibleMarkSpellIDs, type SpellIDInput } from '../candidate/markSpellID'
import { isAnonymous, type Card } from '../Card'
import type { Zone } from '../Zone'
import type {
  PlayerLocationCandidate,
  PublicPosition,
  PublicZoneName,
  SeatID,
  SubZone
} from '../types'
import { RoomMovementHiddenMarkMethods } from './hiddenMarks'
import type {
  RoomMoveContext,
  SourceZoneInput,
  TakeSourceCardsOptions,
  TakeSpecificSourceFallback
} from './types'

export class RoomMovementSourceMethods extends RoomMovementHiddenMarkMethods {
  takeCardsFromPublicZone(
    count: number,
    zoneID: SourceZoneInput = 'pile',
    position: PublicPosition = POSITION_TOP
  ): Card[] {
    const sourceZone = this.room.getPublicZone(zoneID as PublicZoneName | null | undefined)
    return sourceZone?.remove(count, position) ?? []
  }

  /**
   * 优先从显式来源牌中取牌，不足时再按来源公共区补足。
   * 用于协议已经修正出 sourceCards，但仍需要保持公共区有序关系一致的场景。
   */
  takeSpecificSourceCards(
    cards: Card[] = [],
    count: number,
    fallback: TakeSpecificSourceFallback = {}
  ): Card[] {
    const uniqueCards = Array.from(new Set(cards)).filter(Boolean).slice(0, count)

    uniqueCards.forEach((card) => {
      this.room.zones.forEach((zone) => zone.removeCard(card))
    })
    // 显式 sourceCards 可能直接指向无席位 mark 空间里的实体，取走后必须同步摘账本。
    this.removeUnassignedMarkSpaceCards(uniqueCards)

    if (uniqueCards.length >= count) return uniqueCards

    const selected = new Set(uniqueCards)
    const fallbackCards = this.takeCardsFromPublicZone(
      count - uniqueCards.length,
      fallback.fromZone,
      fallback.fromPosition
    ).filter((card) => !selected.has(card))

    return [...uniqueCards, ...fallbackCards]
  }

  /**
   * 收集某玩家指定子区的暗牌来源，并把位置已确定的实体排在跨位置候选之前。
   * 协议只证明“某张暗牌来自该玩家”时，应优先消耗确定来源实体，不能因 Room.cards
   * 的物理顺序碰巧先命中跨座位候选，就提前收敛随机转移约束。
   */
  getUnknownPlayerSourceCards(
    seatID: SeatID,
    subZone: SubZone = 'hand',
    spellIDs: SpellIDInput | SpellIDInput[] = [],
    excludedCards: Iterable<Card> = []
  ): Card[] {
    const exactCards: Card[] = []
    const candidateCards: Card[] = []
    const excluded = new Set(excludedCards)
    const sourceSpellIDs = Array.isArray(spellIDs) ? spellIDs : [spellIDs]
    const markSpellIDs =
      subZone === 'mark'
        ? Array.from(
            new Set(sourceSpellIDs.flatMap((spellID) => getCompatibleMarkSpellIDs(spellID)))
          )
        : []
    const matchesSpellID = (spellID: PlayerLocationCandidate['spellID']): boolean =>
      subZone !== 'mark' ||
      markSpellIDs.length === 0 ||
      (spellID !== null && markSpellIDs.includes(spellID))

    for (const card of this.room.cards) {
      if (excluded.has(card)) continue

      if (card.isKnown === true || card.suspended === true) continue

      const hasSourceProjection =
        card.location === 'player' &&
        card.subZone === subZone &&
        card.seats.has(seatID) === true &&
        matchesSpellID(card.spellID)
      const hasSourceCandidate = this.getCardPlayerLocationCandidates(card).some(
        (candidate) =>
          Number(candidate.seatID) === Number(seatID) &&
          candidate.subZone === subZone &&
          matchesSpellID(candidate.spellID)
      )

      if (!hasSourceProjection && !hasSourceCandidate) continue

      const isExactSource = this.isExactUnknownPlayerSourceCard(card, seatID)
      if (isExactSource) exactCards.push(card)
      else candidateCards.push(card)
    }

    return [...exactCards, ...candidateCards]
  }

  isExactUnknownPlayerSourceCard(card: Card, seatID: SeatID): boolean {
    return (
      card.location === 'player' &&
      card.isKnown !== true &&
      card.suspended !== true &&
      card.resolvedSeat === Number(seatID) &&
      card.seats.size === 1 &&
      !card.hasLocationCandidates?.() &&
      !card.hasSubZoneCandidates?.()
    )
  }

  /**
   * 从某玩家指定子区取出暗牌占位实体。
   */
  takeUnknownCardsFromPlayer(
    seatID: SeatID,
    count: number,
    subZone: SubZone = 'hand',
    spellIDs: SpellIDInput | SpellIDInput[] = []
  ): Card[] {
    if (!(count > 0)) return []
    return this.getUnknownPlayerSourceCards(seatID, subZone, spellIDs).slice(0, count)
  }

  /**
   * 从玩家明确子区取出已经识别的实体牌。
   * 装备/判定/部分标记区本身可见，即使协议用暗牌移动，也不能丢掉已有明牌身份。
   */
  takeKnownCardsFromPlayerSubZone(
    seatID: SeatID,
    count: number,
    subZone: SubZone = 'hand',
    spellID: SpellIDInput = null
  ): Card[] {
    const playerCards: Card[] = []
    if (!(count > 0)) return playerCards
    const markSpellIDs = subZone === 'mark' ? getCompatibleMarkSpellIDs(spellID) : []

    for (const card of this.room.cards) {
      if (
        card.location !== 'player' ||
        card.subZone !== subZone ||
        card.seats.has(seatID) !== true ||
        card.isKnown !== true ||
        card.suspended === true ||
        card.hasSubZoneCandidates?.()
      ) {
        continue
      }

      if (subZone === 'mark' && markSpellIDs.length > 0) {
        if (card.spellID === null || !markSpellIDs.includes(card.spellID)) continue
      }

      playerCards.push(card)
      if (playerCards.length >= count) break
    }

    return playerCards
  }

  /**
   * 收集某座位当前仍在手牌区的实体牌，包含明牌、暗牌和候选明牌。
   */
  getPlayerHandCardsBySeat(seatID: SeatID): Card[] {
    return this.room.cards.filter(
      (card) => card.location === 'player' && card.subZone === 'hand' && card.seats.has(seatID)
    )
  }

  /**
   * 收集某座位当前手牌中的已知实体，用于随机获得/回牌堆时传播明牌候选。
   */
  getKnownHandCardsBySeat(seatID: SeatID): Card[] {
    return this.getPlayerHandCardsBySeat(seatID).filter((card) => card.isKnown === true)
  }

  getSourceSpellID(context: RoomMoveContext): RoomMoveContext['spellID'] {
    return context.fromSpellID ?? context.spellID ?? null
  }

  /**
   * 牌从玩家区移出时，如果它本来只是“可能在来源区”，先收敛来源候选。
   * 这样标记/手牌的数量约束能看到明确移出的那一张。
   */
  resolveSourcePlayerCandidate(card: Card, context: RoomMoveContext): boolean {
    const { fromSeat, fromSubZone } = context
    const sourceSpellID = this.getSourceSpellID(context)
    if (fromSeat === null || fromSeat === undefined || Number.isNaN(fromSeat) || !fromSubZone) {
      return false
    }

    const candidate: PlayerLocationCandidate = {
      type: 'player',
      seatID: fromSeat,
      subZone: fromSubZone,
      spellID: fromSubZone === 'mark' ? sourceSpellID : null
    }

    if (card.hasLocationCandidate?.(candidate)) {
      return card.resolveLocationCandidate(candidate, 'move:sourcePlayerCandidate')
    }

    if (card.hasSubZoneCandidate?.(candidate)) {
      return card.resolveSubZoneCandidate(candidate, 'move:sourcePlayerCandidate')
    }

    return false
  }

  /**
   * 判断明牌实体是否已经处在协议声明的玩家来源区。
   */
  isCardInPlayerSource(card: Card, context: RoomMoveContext): boolean {
    const { fromSeat, fromSubZone } = context
    const sourceSpellID = this.getSourceSpellID(context)
    if (fromSeat === null || fromSeat === undefined || Number.isNaN(fromSeat) || !fromSubZone) {
      return false
    }

    // 手牌来源只认 hand；同座 mark（木马）不是 hand 来源。
    // 若协议声明 hand 却把 mark 实体当 hand，会把木马槽误当成出牌实体。
    return (
      card.location === 'player' &&
      card.subZone === fromSubZone &&
      card.seats.has(fromSeat) &&
      (fromSubZone !== 'mark' ||
        sourceSpellID === null ||
        sourceSpellID === undefined ||
        card.spellID === sourceSpellID)
    )
  }

  // 公共区移动必须校验有序 Zone，而不能只看 card.location，避免玩家暗占位伪装成牌堆实体。
  isCardInPublicSource(card: Card, context: RoomMoveContext): boolean {
    const { fromZone } = context
    const sourceZone = typeof fromZone === 'string' ? this.room.zones.get(fromZone) : undefined
    return sourceZone?.cards.includes(card) === true
  }

  /**
   * 从协议声明的玩家来源区寻找可被明牌置换的暗占位。
   */
  findUnknownPlayerSourcePlaceholder(
    context: RoomMoveContext,
    excludeCard: Card | null = null
  ): Card | null {
    const { fromSeat, fromSubZone } = context
    const sourceSpellID = this.getSourceSpellID(context)
    if (fromSeat === null || fromSeat === undefined || Number.isNaN(fromSeat) || !fromSubZone) {
      return null
    }

    const excludedCards = [excludeCard, ...context.knownCards].filter((card): card is Card =>
      Boolean(card)
    )
    return (
      this.getUnknownPlayerSourceCards(fromSeat, fromSubZone, sourceSpellID, excludedCards)[0] ??
      null
    )
  }

  findExactUnknownPlayerSourcePlaceholder(
    context: RoomMoveContext,
    excludeCard: Card | null = null
  ): Card | null {
    const { fromSeat, fromSubZone } = context
    const sourceSpellID = this.getSourceSpellID(context)
    if (fromSeat === null || fromSeat === undefined || Number.isNaN(fromSeat) || !fromSubZone) {
      return null
    }

    const excludedCards = [excludeCard, ...context.knownCards].filter((card): card is Card =>
      Boolean(card)
    )
    return (
      this.getUnknownPlayerSourceCards(fromSeat, fromSubZone, sourceSpellID, excludedCards).find(
        (card) => this.isExactUnknownPlayerSourceCard(card, fromSeat)
      ) ?? null
    )
  }

  /**
   * 明牌替换来源占位后，挑选一个非来源候选位置留给被换出的暗牌。
   */
  getSourcePlaceholderReplacementCandidate(
    card: Card,
    context: RoomMoveContext
  ): PlayerLocationCandidate | null {
    const { fromSeat, fromSubZone } = context
    const sourceSpellID = this.getSourceSpellID(context)
    const candidates = this.getCardPlayerLocationCandidates(card)

    return (
      candidates.find((candidate) => {
        const isSource =
          Number(candidate.seatID) === Number(fromSeat) &&
          candidate.subZone === fromSubZone &&
          (fromSubZone !== 'mark' || candidate.spellID === sourceSpellID)

        return !isSource
      }) ?? null
    )
  }

  /**
   * 协议确认某张正 ID 明牌来自玩家手牌，但本地缺少可置换的来源实体时，
   * 创建一个临时玩家手牌暗占位，让后续 swapCardWithUnknown() 继续走统一的身份置换流程。
   * 此兜底适用于任意位置的正 ID 明牌，不要求该牌处于 suspended 状态。
   */
  createPlayerSourcePlaceholderForKnownCard(card: Card, context: RoomMoveContext): Card | null {
    const { fromSeat, fromSubZone, sourceEvent } = context
    if (fromSeat === null || fromSeat === undefined || Number.isNaN(fromSeat)) return null
    if (fromSubZone !== 'hand') return null
    if (card.id <= 0) return null

    const placeholder = this.room.createExternalCards([], 1)[0]
    if (!placeholder) return null

    placeholder.bindCandidates([fromSeat], 'hand', null, { known: false })
    trackerLogger.info('玩家来源明牌缺少可置换实体，已创建瞬时匿名占位', {
      reason: 'moveKnownCardsForContext:knownSourcePlaceholderFallback',
      knownCardID: card.id,
      placeholderCardID: placeholder.id,
      placeholderEntityID: placeholder.entityID,
      knownCardLocation: card.location,
      fromSeat,
      fromSubZone,
      sourceEvent
    })

    return placeholder
  }

  /**
   * 协议声明明牌来自玩家区，但本地实体还在别处时，用该玩家的暗占位替回原位置。
   * 这保持了“牌的公开身份”和“玩家暗牌数量”同时正确。
   */
  swapKnownCardWithPlayerSourcePlaceholder(card: Card, context: RoomMoveContext): Card | null {
    const placeholder = this.findUnknownPlayerSourcePlaceholder(context, card)
    if (!placeholder) return null

    const { fromSeat, fromSubZone } = context
    const sourceSpellID = this.getSourceSpellID(context)
    const replacementCandidate = this.getSourcePlaceholderReplacementCandidate(card, context)
    const oldLocation = card.location
    const oldSubZone = card.subZone
    const oldSeats = new Set(Array.from(card.seats, Number))
    const oldCombinationID = card.combinationID
    const oldSpellID = card.spellID
    const oldLocationCandidates = card.getLocationCandidates()
    const oldSuspended = card.suspended
    const keepPlaceholderAtPreviousPublicPosition = this.hasPublicCandidateAt(card, oldLocation)
    const preserveAmbiguousIdentity =
      card.isKnown !== true &&
      oldLocationCandidates.length > 1 &&
      this.isExactUnknownPlayerSourceCard(placeholder, fromSeat)

    // 协议已经证明被替换的暗实体来自该玩家区。必须先确认来源位置，再移出约束组，
    // 否则多席位暗实体仍是未解析状态，组内对应位置名额不会随实体离开而扣减。
    this.resolveSourcePlayerCandidate(placeholder, context)
    this.room.removeCardsFromConstraintGroups([placeholder])
    // 后续是否恢复旧标签必须依据实际迁移结果，不能只看是否进入身份保留分支。
    const migratedConstraintGroups =
      preserveAmbiguousIdentity &&
      this.room.constraints.replaceCardInConstraintGroups(card, placeholder)

    card.location = 'player'
    card.subZone = fromSubZone
    card.spellID = fromSubZone === 'mark' ? sourceSpellID : null
    card.setLocationCandidates([], 'swapKnownCardWithPlayerSourcePlaceholder:knownCard:candidates')
    card.suspended = false
    card.confirmKnown()
    card.setSeats([fromSeat], 'swapKnownCardWithPlayerSourcePlaceholder:knownCard')
    card.combinationID = null
    this.room.markCounterDirty(card)

    if (preserveAmbiguousIdentity) {
      placeholder.location = oldLocation
      placeholder.subZone = oldSubZone
      placeholder.spellID = oldSpellID
      placeholder.suspended = oldSuspended
      placeholder.setLocationCandidates(
        oldLocationCandidates,
        'swapKnownCardWithPlayerSourcePlaceholder:preserveAmbiguousIdentity'
      )
      // 迁移成功时 replaceCardInConstraintGroups 已写入新组标签，不能再被旧单值标签覆盖。
      if (!migratedConstraintGroups) placeholder.combinationID = oldCombinationID
      this.room.markCounterDirty(placeholder)
    } else if (replacementCandidate) {
      const oldPublicZone = this.room.zones.get(oldLocation as PublicZoneName)
      if (oldPublicZone) {
        trackerLogger.warn('来源占位置换跳过公共区回补，占位改为继承其它候选', {
          knownCardID: card.id,
          placeholderCardID: placeholder.id,
          oldLocation,
          oldPublicZoneCardCount: oldPublicZone.cards.length,
          oldPublicZoneHasKnownCard: oldPublicZone.cards.includes(card),
          fromSeat,
          fromSubZone,
          spellID: sourceSpellID,
          replacementCandidate,
          sourceEvent: context.sourceEvent
        })
      }

      placeholder.bindCandidates(
        [replacementCandidate.seatID],
        replacementCandidate.subZone,
        replacementCandidate.spellID,
        { known: false }
      )
    } else if (oldLocation === 'player') {
      placeholder.location = 'player'
      placeholder.subZone = oldSubZone
      placeholder.spellID = oldSpellID
      placeholder.setLocationCandidates(
        [],
        'swapKnownCardWithPlayerSourcePlaceholder:placeholder:candidates'
      )
      placeholder.suspended = false
      placeholder.setSeats(oldSeats, 'swapKnownCardWithPlayerSourcePlaceholder:placeholder')
      placeholder.combinationID = oldCombinationID
      this.room.markCounterDirty(placeholder)
    } else {
      this.restoreUnknownPlaceholderToPreviousPublicLocation(
        card,
        placeholder,
        oldLocation,
        keepPlaceholderAtPreviousPublicPosition
      )
    }

    this.removeHiddenMarkPlaceholder(placeholder)
    return placeholder
  }

  /**
   * 把被置换出的暗占位放回明牌原来的公共区槽位，保持 Zone 顺序和数量。
   */
  restoreUnknownPlaceholderToPreviousPublicLocation(
    card: Card,
    placeholder: Card,
    oldLocation: PublicZoneName | 'suspended',
    keepPreviousPosition = false
  ): void {
    const zone = this.room.zones.get(oldLocation as PublicZoneName)
    const oldZoneCardCount = zone?.cards.length ?? null
    const oldZoneHasKnownCard = zone?.cards.includes(card) ?? false

    if (oldLocation === 'suspended') {
      placeholder.moveToPublicZone('outside')
      trackerLogger.debug('暂停追踪来源占位置换后移出占位', {
        knownCardID: card.id,
        placeholderCardID: placeholder.id,
        oldLocation,
        keepPreviousPosition
      })
      return
    }

    if (zone) {
      // 公共候选槽本来就是不确定位置，可以由占位继续承载；确定明牌槽则不能被占位污染。
      if (keepPreviousPosition) {
        placeholder.moveToPublicZone(oldLocation as PublicZoneName)
        zone.replaceCard(card, placeholder)
        return
      }

      zone.removeCard(card)
      // 确定明牌槽不能被占位污染；若牌堆顶已是连续明牌（如观虚刚展示的牌顶），
      // 占位必须插到该明牌段下方，否则会盖住端点明牌并制造“N 暗 + 牌顶明牌”的假象。
      if (oldLocation === 'pile') {
        this.insertUnknownPlaceholderIntoPile(zone, placeholder)
      } else {
        zone.add(placeholder, POSITION_TOP)
      }
      return
    }

    zone?.removeCard(card)
    placeholder.moveToPublicZone('outside')
    trackerLogger.warn('占位置换未回补公共区，已将占位移出追踪区', {
      knownCardID: card.id,
      placeholderCardID: placeholder.id,
      oldLocation,
      keepPreviousPosition,
      oldZoneCardCount,
      oldZoneCardCountAfter: zone?.cards.length ?? null,
      oldZoneHasKnownCard
    })
  }

  /**
   * 判断卡牌是否仍带有指定公共区候选，用于决定占位是否要保留原槽。
   */
  hasPublicCandidateAt(card: Card, zoneID: PublicZoneName | 'suspended'): boolean {
    if (!this.room.zones.has(zoneID as PublicZoneName)) return false

    return (
      card.publicCandidates?.some((candidate) => candidate.zone === zoneID) ||
      card
        .getLocationCandidates()
        .some((candidate) => candidate.type === 'public' && candidate.zone === zoneID)
    )
  }

  /**
   * 把无公共候选的暗占位放回牌堆时，避免盖住已确认的牌堆顶明牌段。
   * 全是明牌时保持旧语义：占位落到牌顶。
   */
  insertUnknownPlaceholderIntoPile(zone: Zone, placeholder: Card): void {
    const pileCards = zone.cards
    let knownTopCount = 0
    for (let i = pileCards.length - 1; i >= 0; i -= 1) {
      if (pileCards[i]?.isKnown === true) knownTopCount += 1
      else break
    }

    // 没有牌顶明牌段，或整堆都是明牌时，沿用牌顶回补，兼容既有单牌置换回归。
    if (knownTopCount === 0 || knownTopCount === pileCards.length) {
      zone.add(placeholder, POSITION_TOP)
      return
    }

    // remove(TOP) 返回顶 -> 内；add(TOP) 按数组顺序 push，末张成为新牌顶。
    const knownTopCards = zone.remove(knownTopCount, POSITION_TOP)
    zone.add(placeholder, POSITION_TOP)
    zone.add([...knownTopCards].reverse(), POSITION_TOP)
  }

  /**
   * 从牌堆摸到明牌时，CardID 可能正被其他座位的暗手牌占位实体占用。
   * 此时不能直接把该实体搬到当前玩家手里，而要先从牌堆取一张未知实体替回原暗位。
   */
  swapKnownCardWithPublicSourcePlaceholder(card: Card, context: RoomMoveContext): Card | null {
    const { fromZone, fromPosition } = context
    const sourceZone = typeof fromZone === 'string' ? this.room.zones.get(fromZone) : undefined
    if (!sourceZone || sourceZone.cards.includes(card) || card.suspended === true) return null

    const previousPublicZoneEntry = Array.from(this.room.zones.entries()).find(([, zone]) => {
      return zone.cards.includes(card)
    })
    const isPlayerResidue = card.location === 'player'
    // 已知身份既不在玩家区，也不在其它公共区时，没有可由来源占位回补的旧位置。
    if (!isPlayerResidue && !previousPublicZoneEntry) return null

    const replacement = this.takeCardsFromPublicZone(1, fromZone, fromPosition)[0]
    if (!replacement) return null

    this.room.removeCardsFromConstraintGroups([replacement])

    if (previousPublicZoneEntry) {
      const [previousZoneID, previousZone] = previousPublicZoneEntry
      // 真实身份原先仍停在牌堆/弃牌等公共区时，把 exchange 中的暗实体放回它的旧槽位；
      // 随后 known 路径会把真实身份移入目标手牌，从而保持两边实体数量守恒。
      // 来源端点可能已经是确认明牌；换回旧公共槽位只迁移位置，不能抹掉身份。
      replacement.setLocationCandidates(
        [],
        'swapKnownCardWithPublicSourcePlaceholder:publicCandidates'
      )
      replacement.suspended = false
      replacement.moveToPublicZone(previousZoneID)
      previousZone.replaceCard(card, replacement)

      trackerLogger.debug('公共区已知牌命中其它公共区实体，使用来源占位回填旧槽位', {
        cardID: card.id,
        replacementCardID: replacement.id,
        fromZone,
        fromPosition,
        previousZoneID
      })

      return replacement
    }

    // 协议已明确牌来自公共区；即使本地把该实体标成明牌，玩家位置也只是陈旧状态。
    // 必须取一个公共区实体回补原玩家槽位，保持手牌实体与公共区数量守恒。

    const oldSubZone = card.subZone
    const oldSeats = new Set(Array.from(card.seats, Number))
    const oldCombinationID = card.combinationID
    const oldSpellID = card.spellID

    replacement.isKnown = false
    replacement.setLocationCandidates([], 'swapKnownCardWithPublicSourcePlaceholder:candidates')
    replacement.suspended = false
    replacement.bindCandidates(Array.from(oldSeats), oldSubZone, oldSpellID, { known: false })
    replacement.combinationID = oldCombinationID

    this.replaceHiddenMarkPlaceholder(card, replacement)

    trackerLogger.debug('公共区已知牌命中本地玩家实体，使用公共来源实体替回', {
      cardID: card.id,
      replacementCardID: replacement.id,
      fromZone,
      fromPosition,
      oldSubZone,
      oldSeats: Array.from(oldSeats)
    })

    return replacement
  }

  /**
   * 根据来源信息取出暗牌占位；来源可能是游戏外、玩家区或公共区。
   */
  takeSourceCards(count: number, options: TakeSourceCardsOptions = {}): Card[] {
    const {
      sourceIsOutside,
      fromSeat,
      fromSubZone,
      subZone,
      spellID,
      fromZone,
      fromPosition,
      fromSpellID,
      sourceCards,
      sourceEvent
    } = options

    if (sourceCards?.length) {
      if (fromSeat !== null && !Number.isNaN(fromSeat)) {
        const explicitCards = Array.from(new Set(sourceCards)).filter(Boolean).slice(0, count)
        // 显式 sourceCards 也可能指向无席位 mark 空间实体，不能绕过账本清理。
        this.removeUnassignedMarkSpaceCards(explicitCards)
        return explicitCards
      }

      return this.takeSpecificSourceCards(sourceCards, count, { fromZone, fromPosition })
    }

    if (sourceIsOutside) {
      const externalCards = this.room.createExternalCards([], count)
      const placeholderCards = externalCards.filter(isAnonymous)
      if (placeholderCards.length > 0) {
        trackerLogger.warn('游戏外来源创建匿名暗占位', {
          reason: 'takeSourceCards:sourceOutside',
          requestedCount: count,
          createdPlaceholderCount: placeholderCards.length,
          placeholderCardIDs: placeholderCards.map((card) => card.id),
          fromSeat,
          fromSubZone,
          subZone,
          spellID,
          fromSpellID,
          fromZone,
          fromPosition,
          sourceEvent
        })
      }

      return externalCards
    }

    if (fromSeat !== null && !Number.isNaN(fromSeat)) {
      const sourceSubZone = fromSubZone ?? subZone ?? 'hand'
      const inferredSourceSpellID =
        sourceSubZone === 'mark' ? this.getUnassignedMarkSpaceSpellIDFromProtocolID(fromSeat) : null
      const sourceSpellID =
        sourceSubZone === 'mark' ? (fromSpellID ?? spellID ?? inferredSourceSpellID) : spellID
      const unknownCards = this.takeUnknownCardsFromPlayer(
        fromSeat,
        count,
        sourceSubZone,
        sourceSpellID
      )

      // 弹窗 mark 回牌堆时 FromID 可能是技能空间 ID，不一定能按座位取到实体。
      // 先从 spellID 对应的无席位 mark 空间补足，避免误创建匿名 fallback。
      const unassignedUnknownCards =
        sourceSubZone === 'mark' && unknownCards.length < count
          ? this.takeUnassignedMarkSpaceCards(count - unknownCards.length, sourceSpellID)
          : []

      if (unassignedUnknownCards.length > 0) {
        trackerLogger.debug('使用无席位标记暗占位补足来源', {
          requestedCount: count,
          takenBySeatCount: unknownCards.length,
          takenUnassignedCount: unassignedUnknownCards.length,
          fromSeat,
          sourceSubZone,
          sourceSpellID,
          cardIDs: unassignedUnknownCards.map((card) => card.id)
        })
      }

      const selectedUnknownCards = [...unknownCards, ...unassignedUnknownCards]

      if (selectedUnknownCards.length >= count || sourceSubZone === 'hand') {
        return selectedUnknownCards.slice(0, count)
      }

      const selected = new Set(selectedUnknownCards)
      const knownCards = this.takeKnownCardsFromPlayerSubZone(
        fromSeat,
        count - selectedUnknownCards.length,
        sourceSubZone,
        sourceSpellID
      ).filter((card) => !selected.has(card))

      return [...selectedUnknownCards, ...knownCards]
    }

    return this.takeCardsFromPublicZone(count, fromZone, fromPosition)
  }

  /**
   * 调整玩家总手牌数，所有摸牌/弃牌/转移都通过这里维护手牌额度。
   */
  adjustPlayerHandTotal(seatID: SeatID | null | undefined, delta: number): void {
    if (seatID === null || seatID === undefined || delta === 0) return
    this.room.getPlayer(seatID)?.applyObservedHandCountDelta(delta)
  }

  /**
   * 当检测到某张已知物理牌 card 实际上正从移动上下文指定的手牌区移出，
   * 但客户端当前记录其处于其他区域（如牌堆）时，执行位置与状态交换。
   * @param card - 已知卡牌
   * @param context - 包含来源玩家位置的移动上下文
   * @param excludeCards - 本次移动中不能作为暗占位的卡牌
   */
  swapCardWithUnknown(
    card: Card,
    context: RoomMoveContext,
    excludeCards: Card[] = []
  ): Card | null {
    const { fromSeat } = context
    if (fromSeat === null || fromSeat === undefined || Number.isNaN(fromSeat)) return null

    const excludedCards = new Set(excludeCards)
    // 1. 查找该玩家手牌中当前未知的卡牌
    excludedCards.add(card)
    const unknownCard = this.getUnknownPlayerSourceCards(fromSeat, 'hand', [], excludedCards)[0]

    if (!unknownCard) return null

    // 2. 交换物理位置和状态
    const oldLocation = card.location
    const oldSubZone = card.subZone
    const oldSeats = new Set(Array.from(card.seats, Number))
    const oldCombinationID = card.combinationID
    const oldSpellID = card.spellID
    const keepPlaceholderAtPreviousPublicPosition = this.hasPublicCandidateAt(card, oldLocation)

    this.resolveSourcePlayerCandidate(unknownCard, context)
    this.room.removeCardsFromConstraintGroups([unknownCard])
    // 暗占位继承明牌原玩家位置时，不应继续携带来源手牌的位置候选。
    if (oldLocation === 'player') {
      unknownCard.setLocationCandidates([], 'swapCardWithUnknown:unknownCard:candidates')
    }

    // 将 card 绑定到 fromSeat 的手牌区，并设为明牌
    card.location = 'player'
    card.subZone = 'hand'
    card.isKnown = true
    card.setSeats([fromSeat], 'swapCardWithUnknown:knownCard')
    card.combinationID = null
    card.spellID = null
    this.room.markCounterDirty(card)

    // 将 unknownCard 移至 card 原本所在的区域
    unknownCard.location = oldLocation
    unknownCard.subZone = oldSubZone
    unknownCard.setSeats(oldSeats, 'swapCardWithUnknown:unknownCard')
    unknownCard.combinationID = oldCombinationID
    unknownCard.spellID = oldSpellID
    this.room.markCounterDirty(unknownCard)

    // 3. 更新公共区域（Zone）的有序关系引用
    if (oldLocation !== 'player') {
      this.restoreUnknownPlaceholderToPreviousPublicLocation(
        card,
        unknownCard,
        oldLocation,
        keepPlaceholderAtPreviousPublicPosition
      )
    }

    return unknownCard
  }
}
