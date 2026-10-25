import {
  getMoveSeat,
  getMoveSubZone,
  getMoveZone,
  getMovePosition,
  getMoveMarkSpellID,
  getMoveTargetSeats
} from '@/tracker/helper/moveEndpoint'
import { trackerLogger } from '@/utils/logger'
import type { Card } from '@/tracker/model'
import { normalizePublicPosition } from '@/tracker/candidate/publicCandidate'
import type { Room } from '@/tracker/Room'
import type { CardID, PublicZoneName, SeatID } from '@/tracker/types'
import type { RoomMovementSources } from './sources'
import { getUnknownPlayerSourceCards, getUnknownStoredSourceCards } from './sourceQueries'
import type { KnownCardCreationReason, RoomMoveContext } from './types'

interface KnownMoveResolution {
  missingIDs: CardID[]
  createdCards: Card[]
  knownCardCreationReason: KnownCardCreationReason | null
  isExternalSource: boolean
}

/** 已知牌的三路来源解析与整批确认；只复用 Room 身份原语和来源查询，不保存跨移动状态。 */
export class RoomMovementKnownSources {
  constructor(
    private readonly room: Room,
    private readonly sources: RoomMovementSources
  ) {}

  resolve(context: RoomMoveContext): KnownMoveResolution {
    const { knownIDs } = context
    const fromSeat = getMoveSeat(context.from)
    const fromZone = getMoveZone(context.from)
    const sourceIsOutside = context.from.type === 'outside'
    // 12 区也可能暂存游戏外生成牌，但已有匿名槽仍须优先按公共端点物化。
    const isExternalSource = sourceIsOutside || fromZone === 'exile'
    if (sourceIsOutside) return this.resolveOutsideSource(context, isExternalSource)
    if (context.from.type === 'public') {
      return this.resolvePublicSource(context, context.from.zone, isExternalSource)
    }
    if (context.from.type === 'popup' || context.from.type === 'player') {
      return this.resolvePlayerSource(context, fromSeat, isExternalSource)
    }

    context.knownCards = this.room.findCardsByIDs(knownIDs)
    return {
      missingIDs: knownIDs.filter((id) => !this.room.cardIndex.has(id)),
      createdCards: [],
      knownCardCreationReason: isExternalSource ? 'external-source' : null,
      isExternalSource
    }
  }

  /** 所有来源解析结束后才统一恢复 suspended 并确认明牌，保留补建来源的诊断区别。 */
  confirm(context: RoomMoveContext, resolution: KnownMoveResolution): void {
    const { knownIDs } = context
    const fromZone = getMoveZone(context.from)
    const fromSeat = getMoveSeat(context.from)
    const sourceIsOutside = context.from.type === 'outside'
    const { missingIDs, createdCards, knownCardCreationReason, isExternalSource } = resolution
    const createdCardSet = new Set(createdCards)
    const resumedCardIDs: CardID[] = []
    const confirmedFromUnknownIDs: CardID[] = []
    context.knownCards.forEach((card) => {
      // 来源没有合法匿名槽时沿用 known 缺口补建语义；范围载体只在此刻成为物理实体。
      if (this.room.detachedKnownCards.delete(card)) {
        this.room.registerCardEntity(card)
        trackerLogger.warn('已知移动缺少匿名来源槽，范围身份转为物理实体', { cardID: card.id })
      }
      const wasSuspended = card.suspended === true || this.room.suspendedKnownCards.has(card)
      this.room.resumeSuspendedKnownCard(card)
      if (wasSuspended) resumedCardIDs.push(card.id)

      // knownIDs 路径的语义是“协议声明这些正 ID 已公开”。
      // 只有协议明确来自 outside/exile 时，补建正 ID 的暗态才是正常过渡；
      // known-fallback 即使调用同一个工厂，也必须保留缺失实体诊断。
      const isExpectedExternalCreation =
        knownCardCreationReason === 'external-source' && createdCardSet.has(card)
      if (card.id > 0 && card.isKnown !== true && !isExpectedExternalCreation) {
        confirmedFromUnknownIDs.push(card.id)
      }
      if (card.id > 0) card.confirmKnown()
    })

    if (confirmedFromUnknownIDs.length > 0) {
      trackerLogger.info('已知牌解析后补确认明牌', {
        knownIDs,
        confirmedFromUnknownIDs,
        createdCardIDs: createdCards.map((card) => card.id),
        missingIDs,
        fromZone,
        fromSeat,
        sourceIsOutside,
        isExternalSource,
        knownCardCreationReason
      })
    }

    trackerLogger.debug('已知牌解析完成', {
      knownIDs,
      resolvedCardIDs: context.knownCards.map((card) => card.id),
      knownCardStates: context.knownCards.map((card) => ({
        id: card.id,
        entityID: card.entityID,
        isKnown: card.isKnown === true,
        location: card.location
      })),
      missingIDs,
      createdCardIDs: createdCards.map((card) => card.id),
      resumedCardIDs,
      confirmedFromUnknownIDs,
      sourceIsOutside,
      isExternalSource,
      knownCardCreationReason
    })
  }

  private resolveOutsideSource(
    context: RoomMoveContext,
    isExternalSource: boolean
  ): KnownMoveResolution {
    const { knownIDs } = context
    let createdCards: Card[] = []
    const knownCardCreationReason: KnownCardCreationReason | null = isExternalSource
      ? 'external-source'
      : null
    const existingCards = this.room.findCardsByIDs(knownIDs)
    const existingIDs = new Set(existingCards.map((card) => card.id))
    const missingIDs = knownIDs.filter((id) => !existingIDs.has(id))
    if (missingIDs.length > 0) {
      createdCards = this.room.createExternalCards(missingIDs, missingIDs.length)
    }
    const cardMap = new Map<CardID, Card>()
    existingCards.forEach((card) => cardMap.set(card.id, card))
    createdCards.forEach((card) => cardMap.set(card.id, card))
    context.knownCards = knownIDs.map((id) => cardMap.get(id)).filter((card) => card !== undefined)
    return { missingIDs, createdCards, knownCardCreationReason, isExternalSource }
  }

  private resolvePublicSource(
    context: RoomMoveContext,
    fromZone: PublicZoneName,
    isExternalSource: boolean
  ): KnownMoveResolution {
    const { knownIDs } = context
    const fromPosition = getMovePosition(context.from)
    let missingIDs: CardID[]
    let createdCards: Card[] = []
    let knownCardCreationReason: KnownCardCreationReason | null = isExternalSource
      ? 'external-source'
      : null
    // 公共区来源按协议端点顺序物化，避免从别处搬运被提前占用的真实实体。
    const sourceZone = this.room.zones.get(fromZone)
    const endpointCount = Math.max(
      knownIDs.length,
      Math.max(0, Math.floor(Number(context.cardCount) || 0))
    )
    // 只检查本次协议移动覆盖的物理范围，不能为了寻找匿名槽扫描整副牌堆。
    // B13 等指定身份获取仍由 existingInSource 精确命中来源区中的同 ID 实体；只有身份尚未
    // 定位时，才需要在这段协议端点范围内分配匿名物理槽。
    // RANDOM 牌堆来源没有可观察的物理端点。此时从任意匿名槽中选择代表，避免牌顶
    // 已有公开明牌时误判来源实体缺失并 createExternal；其它公共区仍严格按端点解析。
    const endpointCards =
      fromZone === 'pile' && normalizePublicPosition(fromPosition) === 'random'
        ? (sourceZone?.cards ?? [])
            .filter((card) => card.isAnonymous)
            .slice(-endpointCount)
            .reverse()
        : this.room.getPublicEndpointCards(fromZone, endpointCount, fromPosition)
    // Phase 5 后公共 known 只有两种合法物理来源：来源区已经存在的同 ID 实体，或没有
    // 真实身份的匿名槽。TOP/BOTTOM 仍限于协议端点；RANDOM 没有端点事实，只枚举匿名代表。
    const availableTargets = endpointCards.filter((card) => card.isAnonymous)
    const anonymousTargetCountBefore = availableTargets.length
    const resolveAttempts: Record<string, unknown>[] = []

    context.knownCards = knownIDs
      .map((cardID) => {
        const existing = this.room.cardIndex.get(cardID)
        const existingInSource = Boolean(existing && sourceZone?.cards.includes(existing))
        const hadAnonymousTarget = !existingInSource && availableTargets.length > 0
        const target = existingInSource ? existing : availableTargets.shift()
        const ledgerBefore = {
          inCardIndex: this.room.cardIndex.has(cardID),
          inUnlocated: this.room.unlocatedIdentities.has(cardID),
          inDeckIdentities: this.room.deckIdentities.has(cardID),
          existingLocation: existing?.location ?? null,
          existingIsKnown: existing?.isKnown === true,
          existingInSource,
          tookAnonymousTarget: Boolean(target && target !== existing && target.isAnonymous),
          targetEntityID: target?.entityID ?? null,
          remainingAnonymousTargets: availableTargets.length
        }
        // 12 区中已经带正 ID 的暗实体仍由末尾统一确认并记录诊断；匿名槽则在这里物化。
        const materialized =
          isExternalSource && existingInSource
            ? existing
            : this.room.materialize(cardID, target ?? null)
        // 匿名端点按协议顺序一经分配就不回塞。正常情况下 materialize 必然成功；若身份
        // 分区异常导致失败，保留该名额可避免后续 CardID 错占前一张牌的物理端点。
        const resolved = materialized ?? existing
        resolveAttempts.push({
          cardID,
          ...ledgerBefore,
          hadAnonymousTarget,
          materializeOk: Boolean(resolved),
          afterInCardIndex: this.room.cardIndex.has(cardID)
        })
        return resolved
      })
      .filter((card): card is Card => Boolean(card))
    missingIDs = knownIDs.filter((id) => !this.room.cardIndex.has(id))

    // 端点无匿名槽可物化时，与 outside/exile 一致：按协议正 ID 补建外部实体，避免 knownCards 静默短少。
    if (missingIDs.length > 0) {
      trackerLogger.info('known 路径实体缺口，将 createExternal', {
        knownIDs,
        missingIDs,
        fromZone,
        fromPosition,
        anonymousTargetCountBefore,
        anonymousTargetCountAfter: availableTargets.length,
        sourceZoneCards: (sourceZone?.cards ?? []).map((card) => ({
          id: card.id,
          entityID: card.entityID,
          isKnown: card.isKnown === true,
          isAnonymous: card.isAnonymous
        })),
        endpointCards: endpointCards.map((card) => ({
          id: card.id,
          entityID: card.entityID,
          isKnown: card.isKnown === true,
          isAnonymous: card.isAnonymous
        })),
        resolveAttempts,
        knownIDLedgers: knownIDs.map((cardID) => ({
          cardID,
          inCardIndex: this.room.cardIndex.has(cardID),
          inUnlocated: this.room.unlocatedIdentities.has(cardID),
          inDeckIdentities: this.room.deckIdentities.has(cardID)
        }))
      })
      knownCardCreationReason = isExternalSource ? 'external-source' : 'known-fallback'
      createdCards = this.room.createExternalCards(missingIDs, missingIDs.length)
      const cardMap = new Map(context.knownCards.map((card) => [card.id, card]))
      createdCards.forEach((card) => cardMap.set(card.id, card))
      context.knownCards = knownIDs
        .map((id) => cardMap.get(id))
        .filter((card): card is Card => Boolean(card))
      missingIDs = knownIDs.filter((id) => !cardMap.has(id))
    }
    return { missingIDs, createdCards, knownCardCreationReason, isExternalSource }
  }

  private resolvePlayerSource(
    context: RoomMoveContext,
    fromSeat: SeatID | null,
    isExternalSource: boolean
  ): KnownMoveResolution {
    const { knownIDs, sourceCards } = context
    const fromSubZone = getMoveSubZone(context.from)
    let missingIDs: CardID[]
    let createdCards: Card[] = []
    let knownCardCreationReason: KnownCardCreationReason | null = isExternalSource
      ? 'external-source'
      : null
    // 玩家/mark 通用模型允许本机已知身份暂时保持暗状态，两类实体统一由 materialize 收口。
    // 手牌 known 禁止消费 mark:700 等占位；木马身份只在 mark 收敛/快照路径 materialize。
    const markSpellID = getMoveMarkSpellID(context.from)

    const explicitTargets = sourceCards?.filter((card) => card.isAnonymous) ?? []
    let sourceTargets =
      explicitTargets.length > 0
        ? explicitTargets
        : getUnknownStoredSourceCards(this.room, context)
            .filter((card) => card.isAnonymous)
            .slice(0, knownIDs.length)

    // 手牌路径只保留 hand 匿名，绝不纳入 mark 占位。
    if (getMoveZone(context.from) !== 'popup' && fromSubZone === 'hand') {
      sourceTargets = sourceTargets.filter((card) => card.subZone === 'hand')
    }

    const availableTargets = [...sourceTargets]
    const sourceAnonymousCountBefore = availableTargets.length

    // 木马等装备容器迁座后，协议 FromID 仍可能是旧座位，而暗占位已投影到目标座位。
    // 全明快照物化时需追加目标座位 mark 匿名槽，避免 knownCards 静默短少、弱候选无法收敛。
    const isFullKnownMarkSnapshot =
      fromSubZone === 'mark' &&
      getMoveSubZone(context.to) === 'mark' &&
      getMoveZone(context.to) === 'player' &&
      context.unknownCount === 0 &&
      knownIDs.length === context.cardCount &&
      knownIDs.length > 0
    if (isFullKnownMarkSnapshot && availableTargets.length < knownIDs.length) {
      const usedTargets = new Set(availableTargets)
      getMoveTargetSeats(context.to).forEach((targetSeat) => {
        if (Number(targetSeat) === Number(fromSeat)) return
        getUnknownPlayerSourceCards(this.room, targetSeat, fromSubZone, markSpellID)
          .filter((card) => card.isAnonymous)
          .forEach((card) => {
            if (usedTargets.has(card) || availableTargets.length >= knownIDs.length) return
            usedTargets.add(card)
            availableTargets.push(card)
          })
      })
    }

    const resolveAttempts: Record<string, unknown>[] = []
    context.knownCards = knownIDs
      .map((cardID) => {
        const existing = this.room.cardIndex.get(cardID)
        const existingInSource = Boolean(
          existing &&
          !this.room.detachedKnownCards.has(existing) &&
          this.sources.isCardInStoredSource(existing, context)
        )
        const target = existingInSource ? existing : availableTargets.shift()
        const ledgerBefore = {
          inCardIndex: this.room.cardIndex.has(cardID),
          inUnlocated: this.room.unlocatedIdentities.has(cardID),
          inDeckIdentities: this.room.deckIdentities.has(cardID),
          existingLocation: existing?.location ?? null,
          existingSubZone: existing?.subZone ?? null,
          existingIsKnown: existing?.isKnown === true,
          existingInSource,
          tookAnonymousTarget: Boolean(target && target.isAnonymous),
          targetSubZone: target?.subZone ?? null,
          remainingAnonymousTargets: availableTargets.length
        }
        const resolved = this.room.materialize(cardID, target ?? null) ?? existing
        resolveAttempts.push({
          cardID,
          ...ledgerBefore,
          materializeOk: Boolean(resolved),
          afterInCardIndex: this.room.cardIndex.has(cardID)
        })
        return resolved
      })
      .filter((card): card is Card => Boolean(card))
    missingIDs = knownIDs.filter((id) => !this.room.cardIndex.has(id))

    // 协议 known 声明的正 ID 必须落地实体：座位存在时也不能再静默丢牌。
    // 手牌缺口只 createExternal，绝不消费木马/标记匿名占位。
    if (missingIDs.length > 0) {
      trackerLogger.warn('玩家来源 known 路径实体缺口，将 createExternal', {
        knownIDs,
        missingIDs,
        fromSeat,
        fromSubZone,
        markSpellID,
        sourceAnonymousCountBefore,
        remainingAnonymousTargets: availableTargets.length,
        resolveAttempts,
        knownIDLedgers: knownIDs.map((cardID) => ({
          cardID,
          inCardIndex: this.room.cardIndex.has(cardID),
          inUnlocated: this.room.unlocatedIdentities.has(cardID),
          inDeckIdentities: this.room.deckIdentities.has(cardID)
        }))
      })
      knownCardCreationReason = 'known-fallback'
      createdCards = this.room.createExternalCards(missingIDs, missingIDs.length)
      const cardMap = new Map(context.knownCards.map((card) => [card.id, card]))
      createdCards.forEach((card) => cardMap.set(card.id, card))
      context.knownCards = knownIDs
        .map((id) => cardMap.get(id))
        .filter((card): card is Card => Boolean(card))
      missingIDs = knownIDs.filter((id) => !cardMap.has(id))
    }
    return { missingIDs, createdCards, knownCardCreationReason, isExternalSource }
  }
}
