import {
  getMoveMarkSpellID,
  getMoveSeat,
  getMoveSubZone,
  getMoveZone,
  getPopupSpaceID,
  getMovePosition
} from '@/tracker/helper/moveEndpoint'
import { POSITION_BOTTOM, POSITION_TOP } from '@/tracker/candidate/cardPositions'
import type { Card, Zone } from '@/tracker/model'
import { MOVE_TYPE } from '@/tracker/protocol/MoveEventNormalizer'
import type { Room } from '@/tracker/Room'
import type {
  PlayerLocationCandidate,
  PublicPosition,
  PublicZoneName,
  SeatID,
  SpellID,
  SubZone
} from '@/tracker/types'
import { trackerLogger } from '@/utils/logger'
import type { RoomMovementHiddenMarks } from './hiddenMarks'
import {
  getCardPlayerLocationCandidates,
  getUnknownStoredSourceCards,
  isExactUnknownPlayerSourceCard,
  takeUnknownCardsFromPlayer
} from './sourceQueries'
import type { RoomMoveContext, TakeSourceCardsOptions, TakeSpecificSourceFallback } from './types'
import { removePopupSpaceCards, takePopupSpaceCards } from './popupSpaces'

// 来源操作只依赖标记占位维护，不持有暗置标记组件的其它能力。
type HiddenMarkPlaceholderAccess = Pick<
  RoomMovementHiddenMarks,
  'findHiddenMarkSourcePlaceholder' | 'removeHiddenMarkPlaceholder' | 'replaceHiddenMarkPlaceholder'
>

/**
 * 解析协议来源、选择实体并执行占位置换，维护公共区顺序和观测手牌额度。
 * 标记占位维护仅依赖窄接口；来源优先级与精确来源判定集中保留，避免规则散落。
 */
export class RoomMovementSources {
  constructor(
    private readonly room: Room,
    private readonly hiddenMarks: HiddenMarkPlaceholderAccess
  ) {}

  /**
   * 按公共区物理端点摘除指定张数；未给来源/位置时沿用牌堆/顶部默认值。
   * 不筛选明暗身份，未知公共区返回空数组；特殊暗牌获取使用专门筛选路径。
   */
  private takeCardsFromPublicZone(
    count: number,
    zoneID: PublicZoneName | null | undefined = 'pile',
    position: PublicPosition = POSITION_TOP
  ): Card[] {
    const sourceZone = this.room.getPublicZone(zoneID as PublicZoneName | null | undefined)
    return sourceZone?.remove(count, position) ?? []
  }

  /**
   * 牌堆获得类协议未给 CardIDs 时只消费暗槽，不把已展示端点误当成被随机取得的牌。
   * 非牌堆公共区不能走这里，否则全明牌来源会遗留原实体并触发匿名 fallback。
   */
  private takeUnknownCardsFromPublicZone(
    count: number,
    zoneID: PublicZoneName | null | undefined = 'pile',
    position: PublicPosition = POSITION_TOP
  ): Card[] {
    const sourceZone = this.room.getPublicZone(zoneID as PublicZoneName | null | undefined)
    if (!sourceZone || count <= 0) return []

    const hiddenCards = sourceZone.cards.filter((card) => card.isKnown !== true)
    const selected =
      position === POSITION_BOTTOM
        ? hiddenCards.slice(0, count)
        : hiddenCards.slice(-count).reverse()
    selected.forEach((card) => sourceZone.removeCard(card))
    return selected
  }

  /**
   * 优先从显式来源牌中取牌，不足时再按来源公共区补足。
   * 用于协议已经修正出 sourceCards，但仍需要保持公共区有序关系一致的场景。
   */
  private takeSpecificSourceCards(
    cards: Card[] = [],
    count: number,
    fallback: TakeSpecificSourceFallback = {}
  ): Card[] {
    const uniqueCards = Array.from(new Set(cards)).filter(Boolean).slice(0, count)

    uniqueCards.forEach((card) => {
      this.room.zones.forEach((zone) => zone.removeCard(card))
    })
    // 显式 sourceCards 可能直接指向弹窗空间里的实体，取走后必须同步摘账本。
    removePopupSpaceCards(this.room, uniqueCards)

    if (uniqueCards.length >= count) return uniqueCards

    const selected = new Set(uniqueCards)
    const fallbackCards = fallback.anonymousFallback
      ? this.room.createExternalCards([], count - uniqueCards.length)
      : this.takeCardsFromPublicZone(
          count - uniqueCards.length,
          fallback.fromZone,
          fallback.fromPosition
        )

    return [...uniqueCards, ...fallbackCards.filter((card) => !selected.has(card))]
  }

  /**
   * 从玩家明确子区取出已经识别的实体牌。
   * 装备/判定/部分标记区本身可见，即使协议用暗牌移动，也不能丢掉已有明牌身份。
   */
  private takeKnownCardsFromPlayerSubZone(
    seatID: SeatID,
    count: number,
    subZone: SubZone = 'hand',
    spellID: SpellID | null | undefined
  ): Card[] {
    const playerCards: Card[] = []
    if (!(count > 0)) return playerCards
    const markSpellIDs = subZone === 'mark' && spellID != null ? [spellID] : []

    // 标记区到手牌的多选已由候选层接管；其余路径仍须按张数消费来源实体。
    for (const card of this.room.refreshPlayerSnapshot()) {
      if (
        card.subZone !== subZone ||
        card.seats.has(seatID) !== true ||
        card.isKnown !== true ||
        card.suspended === true ||
        card.hasSubZoneCandidates()
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
   * 玩家来源匹配优先使用 fromSpellID，再回退 spellID；空值表示没有来源标记限制。
   * 保留 0 等非空值，避免用目标标记 ID 覆盖已明确的来源标记。
   */
  private getSourceSpellID(context: RoomMoveContext): number | null {
    return getMoveMarkSpellID(context.from)
  }

  /**
   * 牌从玩家区移出时，如果它本来只是“可能在来源区”，先收敛来源候选。
   * 这样标记/手牌的数量约束能看到明确移出的那一张。
   * 须先确认来源再移出约束组，保证对应位置名额随实体离开而扣减；返回候选是否变化。
   */
  resolveStoredSourceCandidate(card: Card, context: RoomMoveContext): boolean {
    const fromSeat = getMoveSeat(context.from)
    const fromSubZone = getMoveSubZone(context.from)
    const sourceSpellID = this.getSourceSpellID(context)
    if (getMoveZone(context.from) === 'popup') {
      const candidate = { type: 'popup', spaceID: getPopupSpaceID(context.from) } as const
      if (card.hasLocationCandidate(candidate))
        return card.resolveLocationCandidate(candidate, 'move:sourcePopup')
      return false
    }
    if (fromSeat === null || fromSeat === undefined || Number.isNaN(fromSeat) || !fromSubZone) {
      return false
    }

    const candidate: PlayerLocationCandidate = {
      type: 'player',
      seatID: fromSeat,
      subZone: fromSubZone,
      spellID: fromSubZone === 'mark' ? sourceSpellID : null
    }

    if (card.hasLocationCandidate(candidate)) {
      return card.resolveLocationCandidate(candidate, 'move:sourcePlayerCandidate')
    }

    return false
  }

  /**
   * 判断明牌实体是否已经处在协议声明的玩家来源区。
   * 按当前投影核对来源席位、子区和标记 ID，不把模糊候选当作已落区。
   */
  isCardInStoredSource(card: Card, context: RoomMoveContext): boolean {
    const fromSeat = getMoveSeat(context.from)
    const fromSubZone = getMoveSubZone(context.from)
    const sourceSpellID = this.getSourceSpellID(context)
    if (getMoveZone(context.from) === 'popup') {
      return card
        .getPossibleLocations()
        .some(
          (candidate) =>
            candidate.type === 'popup' && candidate.spaceID === getPopupSpaceID(context.from)
        )
    }
    if (fromSeat === null || fromSeat === undefined || Number.isNaN(fromSeat) || !fromSubZone) {
      return false
    }

    // 逐个完整位置匹配来源。代表子区和 seats 不能交叉组合成不存在的玩家位置；
    // “0 号标记 / 3 号手牌”既能承接 3 号手牌揭示，也不会冒充 3 号标记来源。
    return (
      card.location === 'player' &&
      getCardPlayerLocationCandidates(card).some(
        (candidate) =>
          candidate.seatID === fromSeat &&
          candidate.subZone === fromSubZone &&
          (fromSubZone !== 'mark' ||
            sourceSpellID === null ||
            sourceSpellID === undefined ||
            candidate.spellID === sourceSpellID)
      )
    )
  }

  /**
   * 核对实体是否实际存在于协议来源公共区的有序容器中，不只检查 location 投影。
   * 避免玩家暗占位因残留公共区位置而被误当成可从牌堆取出的实体。
   */
  isCardInPublicSource(card: Card, context: RoomMoveContext): boolean {
    const fromZone = getMoveZone(context.from)
    const sourceZone = typeof fromZone === 'string' ? this.room.zones.get(fromZone) : undefined
    return sourceZone?.cards.includes(card) === true
  }

  /**
   * 从协议声明的玩家来源区寻找可被明牌置换的暗占位。
   */
  private findUnknownStoredSourcePlaceholder(
    context: RoomMoveContext,
    excludeCard: Card | null = null
  ): Card | null {
    const fromSeat = getMoveSeat(context.from)
    const fromSubZone = getMoveSubZone(context.from)
    if (
      getMoveZone(context.from) !== 'popup' &&
      (fromSeat === null || fromSeat === undefined || Number.isNaN(fromSeat) || !fromSubZone)
    ) {
      return null
    }

    const excludedCards = [excludeCard, ...context.knownCards].filter((card): card is Card =>
      Boolean(card)
    )
    const sourceCards = getUnknownStoredSourceCards(this.room, context, excludedCards)
    if (fromSubZone === 'mark' && excludeCard) {
      const placeholder = this.hiddenMarks.findHiddenMarkSourcePlaceholder(excludeCard, sourceCards)
      if (placeholder) return placeholder
    }
    return sourceCards[0] ?? null
  }

  /**
   * 在协议来源子区查找位置已确定的暗占位；排除当前牌和同批已知移动牌。
   * 模糊候选不能作为精确占位，以免把尚未确定的身份过早落定。
   */
  findExactUnknownStoredSourcePlaceholder(
    context: RoomMoveContext,
    excludeCard: Card | null = null
  ): Card | null {
    const fromSeat = getMoveSeat(context.from)
    const fromSubZone = getMoveSubZone(context.from)
    if (
      getMoveZone(context.from) !== 'popup' &&
      (fromSeat === null || fromSeat === undefined || Number.isNaN(fromSeat) || !fromSubZone)
    ) {
      return null
    }

    const excludedCards = [excludeCard, ...context.knownCards].filter((card): card is Card =>
      Boolean(card)
    )
    return (
      getUnknownStoredSourceCards(this.room, context, excludedCards).find((card) =>
        getMoveZone(context.from) === 'popup'
          ? !card.hasLocationCandidates()
          : isExactUnknownPlayerSourceCard(card, fromSeat)
      ) ?? null
    )
  }

  /**
   * 明牌替换来源占位后，挑选一个非来源候选位置留给被换出的暗牌。
   * 只查询、不写入状态；没有可继承的非来源玩家候选时返回 null。
   */
  getSourcePlaceholderReplacementCandidate(
    card: Card,
    context: RoomMoveContext
  ): PlayerLocationCandidate | null {
    const fromSeat = getMoveSeat(context.from)
    const fromSubZone = getMoveSubZone(context.from)
    const sourceSpellID = this.getSourceSpellID(context)
    const candidates = getCardPlayerLocationCandidates(card)

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
   * 创建一个临时玩家手牌暗占位，让后续继续走统一的玩家来源身份置换流程。
   * 此兜底适用于任意位置的正 ID 明牌，不要求该牌处于 suspended 状态。
   */
  createPlayerSourcePlaceholderForKnownCard(card: Card, context: RoomMoveContext): Card | null {
    const { sourceEvent } = context
    const fromSeat = getMoveSeat(context.from)
    const fromSubZone = getMoveSubZone(context.from)
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
   * 可见子区（标记/装备/判定）中的明牌被协议声明为来自另一个位置的玩家区时，直接迁移投影。
   *
   * 这些子区没有暗牌数量对账，明牌就是区域内唯一的物理实体；若继续走占位置换，替身占位
   * 会继承旧的标记/装备位置，成为等洗牌才会消失的幽灵暗位。手牌来源仍保留原置换语义，
   * 因为手牌数量由 reconcileAnonymousHandCards 之外的槽位守恒链路依赖。
   * @returns 是否已就地对齐；true 时调用方不应再做置换。
   */
  alignVisibleSubZoneTransfer(card: Card, context: RoomMoveContext): boolean {
    const fromSeat = getMoveSeat(context.from)
    const fromSubZone = getMoveSubZone(context.from)
    if (fromSeat === null || fromSeat === undefined || Number.isNaN(fromSeat) || !fromSubZone) {
      return false
    }

    const sourceSubZone = card.subZone
    if (
      card.location !== 'player' ||
      card.isKnown !== true ||
      card.seats.size !== 1 ||
      sourceSubZone === null ||
      sourceSubZone === 'hand' ||
      card.hasLocationCandidates()
    ) {
      return false
    }

    if (card.seats.has(fromSeat) && sourceSubZone === fromSubZone) return false

    card.subZone = fromSubZone
    card.spellID = fromSubZone === 'mark' ? this.getSourceSpellID(context) : null
    card.setSeats([fromSeat], 'alignVisibleSubZoneTransfer')
    this.room.markCounterDirty(card)
    this.room.notifyCardChanged(card, {
      type: 'card-bound',
      subZone: fromSubZone,
      spellID: card.spellID
    })
    trackerLogger.info('可见子区明牌已就地对齐到协议来源', {
      reason: 'alignVisibleSubZoneTransfer',
      cardID: card.id,
      entityID: card.entityID,
      fromSubZone: sourceSubZone,
      toSeat: fromSeat,
      toSubZone: fromSubZone,
      spellID: card.spellID,
      sourceEvent: context.sourceEvent
    })

    return true
  }

  /**
   * 协议声明明牌来自玩家区，但本地实体还在别处时，用该玩家的暗占位替回原位置。
   * 这保持了“牌的公开身份”和“玩家暗牌数量”同时正确。
   * 返回被置换的占位实体；没有可用来源占位时返回 null。
   */
  swapKnownCardWithPlayerSourcePlaceholder(card: Card, context: RoomMoveContext): Card | null {
    const placeholder = this.findUnknownStoredSourcePlaceholder(context, card)
    if (!placeholder) return null

    const fromSeat = getMoveSeat(context.from)
    const fromSubZone = getMoveSubZone(context.from)
    const sourceSpellID = this.getSourceSpellID(context)
    const replacementCandidate = this.getSourcePlaceholderReplacementCandidate(card, context)
    const oldLocation = card.location
    const oldSubZone = card.subZone
    const oldSeats = new Set(Array.from(card.seats, Number))
    const oldSpellID = card.spellID
    const oldPopupSpaceID = card.popupSpaceID
    const oldLocationCandidates = card.locationCandidates
    const keepPlaceholderAtPreviousPublicPosition = this.hasPublicCandidateAt(card, oldLocation)
    const preserveAmbiguousIdentity =
      card.isKnown !== true &&
      oldLocationCandidates.length > 1 &&
      isExactUnknownPlayerSourceCard(placeholder, fromSeat)

    // 协议已经证明被替换的暗实体来自该玩家区。必须先确认来源位置，再移出约束组，
    // 否则多席位暗实体仍是未解析状态，组内对应位置名额不会随实体离开而扣减。
    this.resolveStoredSourceCandidate(placeholder, context)
    this.room.removeCardsFromConstraintGroups([placeholder])
    if (preserveAmbiguousIdentity) {
      this.room.constraints.replaceCardInConstraintGroups(card, placeholder)
    }

    if (getMoveZone(context.from) === 'popup') {
      card.resolveLocationCandidate({ type: 'popup', spaceID: getPopupSpaceID(context.from) })
      card.confirmKnown()
    } else {
      card.bindCandidates([fromSeat], fromSubZone, fromSubZone === 'mark' ? sourceSpellID : null, {
        known: true
      })
    }

    if (preserveAmbiguousIdentity) {
      placeholder.bindCandidates(oldSeats, oldSubZone, oldSpellID)
      placeholder.setLocationCandidates(
        oldLocationCandidates,
        'swapKnownCardWithPlayerSourcePlaceholder:preserveAmbiguousIdentity'
      )
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
    } else if (oldLocation === 'popup') {
      placeholder.resolveLocationCandidate({ type: 'popup', spaceID: oldPopupSpaceID })
    } else if (oldLocation === 'player') {
      placeholder.bindCandidates(oldSeats, oldSubZone, oldSpellID)
    } else {
      this.restoreUnknownPlaceholderToPreviousPublicLocation(
        card,
        placeholder,
        oldLocation,
        keepPlaceholderAtPreviousPublicPosition
      )
    }

    this.hiddenMarks.removeHiddenMarkPlaceholder(placeholder)
    return placeholder
  }

  /**
   * 把被置换出的暗占位放回明牌原来的公共区槽位，保持 Zone 顺序和数量。
   */
  private restoreUnknownPlaceholderToPreviousPublicLocation(
    card: Card,
    placeholder: Card,
    oldLocation: PublicZoneName | 'suspended',
    keepPreviousPosition = false
  ): void {
    const zone = this.room.zones.get(oldLocation as PublicZoneName)
    const oldZoneCardCount = zone?.cards.length ?? null
    const oldZoneHasKnownCard = zone?.cards.includes(card) ?? false

    if (oldLocation === 'suspended') {
      // suspended 身份没有可回填的物理区域，因此来源占位必须退出玩家区。
      // 但正 ID 暗占位的身份仍可能对应牌堆/其它暗手牌，需先退回未定位身份池。
      const placeholderCardID = placeholder.id
      const releasedIdentityID = this.room.releaseUnknownPlaceholderToOutside(
        placeholder,
        'restoreUnknownPlaceholderToPreviousPublicLocation:suspended'
      )
      trackerLogger.debug('暂停追踪来源占位置换后移出占位', {
        knownCardID: card.id,
        placeholderCardID,
        releasedIdentityID,
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

    // 找不到旧公共区同样意味着占位失去位置职责；统一走身份释放入口，
    // 避免正 ID 暗占位变成 cardIndex 中永久不可见的 outside 身份。
    const placeholderCardID = placeholder.id
    const releasedIdentityID = this.room.releaseUnknownPlaceholderToOutside(
      placeholder,
      'restoreUnknownPlaceholderToPreviousPublicLocation:missingZone'
    )
    trackerLogger.warn('占位置换未回补公共区，已将占位移出追踪区', {
      knownCardID: card.id,
      placeholderCardID,
      releasedIdentityID,
      oldLocation,
      keepPreviousPosition,
      oldZoneCardCount,
      oldZoneCardCountAfter: null,
      oldZoneHasKnownCard
    })
  }

  /**
   * 判断卡牌是否仍带有指定公共区候选，用于决定占位是否要保留原槽。
   */
  hasPublicCandidateAt(card: Card, zoneID: PublicZoneName | 'suspended'): boolean {
    if (!this.room.zones.has(zoneID as PublicZoneName)) return false

    return card.locationCandidates.some(
      (candidate) => candidate.type === 'public' && candidate.zone === zoneID
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
    const fromZone = getMoveZone(context.from)
    const fromPosition = getMovePosition(context.from)
    const sourceZone = typeof fromZone === 'string' ? this.room.zones.get(fromZone) : undefined
    if (!sourceZone || sourceZone.cards.includes(card) || card.suspended === true) return null

    const previousPublicZoneEntry = Array.from(this.room.zones.entries()).find(([, zone]) => {
      return zone.cards.includes(card)
    })
    const isPlayerResidue = card.location === 'player' || card.location === 'popup'
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
    const oldSpellID = card.spellID

    replacement.isKnown = false
    replacement.bindCandidates(Array.from(oldSeats), oldSubZone, oldSpellID, { known: false })
    if (card.popupSpaceID !== null)
      replacement.resolveLocationCandidate({ type: 'popup', spaceID: card.popupSpaceID })

    this.hiddenMarks.replaceHiddenMarkPlaceholder(card, replacement)

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
   * 公共区取牌会摘除对应物理槽位；来源缺口按协议策略补位，不在此执行整局收敛。
   */
  takeSourceCards(count: number, options: TakeSourceCardsOptions): Card[] {
    const { from, to, sourceCards, sourceEvent } = options
    const moveType = sourceEvent?.moveType ?? sourceEvent?.raw?.MoveType ?? options.moveType
    const isDiscardGain =
      from.type === 'public' &&
      from.zone === 'discard' &&
      (moveType === MOVE_TYPE.GAIN ||
        (moveType === MOVE_TYPE.MOVE && (to.type === 'player' || to.type === 'playerCandidates')))

    if (sourceCards?.length) {
      if (from.type === 'player') {
        const explicitCards = [...new Set(sourceCards)].slice(0, count)
        removePopupSpaceCards(this.room, explicitCards)
        return explicitCards
      }
      return this.takeSpecificSourceCards(sourceCards, count, {
        fromZone: from.type === 'public' ? from.zone : null,
        fromPosition: getMovePosition(from),
        anonymousFallback: isDiscardGain
      })
    }
    if (from.type === 'outside') {
      const externalCards = this.room.createExternalCards([], count)
      if (externalCards.length > 0) {
        trackerLogger.warn('游戏外来源创建匿名暗占位', {
          reason: 'takeSourceCards:sourceOutside',
          requestedCount: count,
          placeholderCardIDs: externalCards.map((card) => card.id),
          from,
          to,
          sourceEvent
        })
      }
      return externalCards
    }
    if (isDiscardGain) return this.room.createExternalCards([], count)
    if (from.type === 'popup') return takePopupSpaceCards(this.room, count, from.spaceID)
    if (from.type === 'player') {
      const markSpellID = getMoveMarkSpellID(from)
      const unknownCards = takeUnknownCardsFromPlayer(
        this.room,
        from.seatID,
        count,
        from.subZone,
        markSpellID
      )
      removePopupSpaceCards(this.room, unknownCards)
      if (unknownCards.length >= count || from.subZone === 'hand')
        return unknownCards.slice(0, count)
      const selected = new Set(unknownCards)
      const knownCards = this.takeKnownCardsFromPlayerSubZone(
        from.seatID,
        count - unknownCards.length,
        from.subZone,
        markSpellID
      ).filter((card) => !selected.has(card))
      return [...unknownCards, ...knownCards]
    }
    // 未定位来源的暗牌沿用历史公共查询降级；已知牌不走此分支，也不授予 outside 语义。
    if (from.type === 'unresolved')
      return this.takeCardsFromPublicZone(count, 'pile', from.position)
    if (from.zone !== 'pile' || moveType === MOVE_TYPE.DRAW) {
      return this.takeCardsFromPublicZone(count, from.zone, from.position)
    }
    return this.takeUnknownCardsFromPublicZone(count, from.zone, from.position)
  }

  /**
   * 按移动包张数直接更新来源和目标的观测手牌额度，保持先减后加的顺序。
   * 同席位或非正张数不更新；缺失席位和未注册玩家跳过，不创建玩家。
   */
  applyHandTotalDelta(sourceSeat: SeatID | null, targetSeat: SeatID | null, count: number): void {
    if (!(count > 0) || sourceSeat === targetSeat) return

    if (sourceSeat !== null && sourceSeat !== undefined) {
      this.room.getPlayer(sourceSeat)?.applyObservedHandCountDelta(-count)
    }
    if (targetSeat !== null && targetSeat !== undefined) {
      this.room.getPlayer(targetSeat)?.applyObservedHandCountDelta(count)
    }
  }
}
