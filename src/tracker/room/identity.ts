import { Card, hasRealIdentity, isAnonymous } from '../Card'
import type { Room } from '../Room'
import type { Zone } from '../Zone'
import type { CardID, PublicPosition, PublicZoneName } from '../types'
import { trackerLogger } from '@/utils/logger'

export interface AnonymizeLocatedIdentityOptions {
  preservePlacement?: boolean
}

/** 身份绑定与解绑的阶段实现；实体、身份分区及索引仍由 Room 唯一持有。 */
export class RoomIdentity {
  constructor(private readonly room: Room) {}

  /**
   * 把手气卡回牌堆等路径上的已定位正 ID 槽真正匿名化：
   * 实体保留在牌堆位置，身份回到 unlocatedIdentities，供后续揭示时再物化。
   *
   * 这是「解绑身份」的唯一原语。releaseUnknownPlaceholderToOutside、手气卡匿名化与
   * 洗牌路径全部经由此处，因此身份分区守恒
   * （一个 deckIdentity 必须恰好处于 cardIndex 或 unlocatedIdentities 之一）
   * 由 Room 的公开入口在成功解绑后统一断言一次。
   *
   * 返回 `null` 表示**未发生任何变更**：入参不是已定位的正 ID 实体，或 cardIndex
   * 与实体不一致。调用方必须处理该情况，不能假定身份已被释放——否则会出现
   * “实体已移出、身份仍被 cardIndex 认为已定位”的漏出（历史上 147 号身份即由此丢失）。
   */
  anonymizeLocatedIdentity(
    card: Card,
    reason = 'anonymizeLocatedIdentity',
    options: AnonymizeLocatedIdentityOptions = {}
  ): CardID | null {
    const room = this.room
    if (!card || !hasRealIdentity(card) || card.id <= 0) return null
    if (room.cardIndex.get(card.id) !== card) return null

    const { preservePlacement = false } = options
    const previousCardID = card.id
    const previousEntityID = card.entityID

    room.cardIndex.delete(previousCardID)
    room.unlocatedIdentities.add(previousCardID)
    room.deckIdentities.add(previousCardID)

    const nextEntityID = room.allocateAnonymousEntityID()
    card.entityID = nextEntityID
    card.setCardInfo(nextEntityID)
    card.isKnown = false
    card.suspended = false
    if (!preservePlacement) {
      card.combinationID = null
      card.spellID = null
      // 必须走候选写路径：直接清空 locationCandidates 不会同步 clear owner，
      // seats 在 location 仍为 player 时会回退到旧座位投影。
      card.setLocationCandidates([], `${reason}:candidates`)
      card.clearSeats(`${reason}:seats`)
      card.subZone = null
    }
    room.suspendedKnownCards.delete(card)

    room.notifyCardChanged(card, {
      type: 'card-identity-anonymized',
      previousCardID,
      previousEntityID,
      entityID: nextEntityID,
      reason,
      preservePlacement
    })

    if (room.counter) {
      room.counter.releaseLocatedIdentityToUnknown(card, previousCardID)
      if (preservePlacement) room.counter.markDirty(card)
    } else {
      room.markCounterDirty(card)
    }

    return previousCardID
  }

  /**
   * 移除不再承担位置数量的暗占位，同时保住它携带的真实身份。
   *
   * 玩家手牌或 mark 中的正 ID 暗实体只表示本机掌握身份，并不表示其具体位置已经公开。
   * 若直接把它移到 outside，cardIndex 仍会认为该身份已定位，但 CardCounter 会把它归为
   * REMOVED，下一次洗牌便无法从“未定位身份”或“暗位置身份”中重新找到它。
   * 因此先把身份退回 unlocatedIdentities，再移出已经多余的匿名物理槽。
   */
  releaseUnknownPlaceholderToOutside(card: Card, reason: string): CardID | null {
    const room = this.room
    const previousCardID = card.id
    if (previousCardID > 0 && card.isKnown === true) {
      trackerLogger.warn('拒绝将已知正 ID 卡牌按暗占位移出追踪区', {
        reason,
        cardID: previousCardID,
        entityID: card.entityID,
        location: card.location
      })
      return null
    }

    const shouldReleaseIdentity = previousCardID > 0 && card.isKnown !== true
    const releasedIdentityID = shouldReleaseIdentity
      ? room.anonymizeLocatedIdentity(card, `${reason}:releaseIdentity`)
      : null

    if (shouldReleaseIdentity && releasedIdentityID === null) {
      // 索引已经异常时宁可保留一个 suspended 身份，也不能继续移出并永久漏掉该 ID。
      trackerLogger.warn('正 ID 暗占位移出追踪区前释放身份失败，改为暂停身份', {
        reason,
        cardID: previousCardID,
        entityID: card.entityID,
        indexedCardID: room.cardIndex.get(previousCardID)?.id ?? null
      })
      card.confirmKnown()
      room.constraints.suspendKnownCard(card, `${reason}:releaseIdentityFailed`)
      return null
    }

    card.moveToPublicZone('outside')
    if (releasedIdentityID !== null) {
      trackerLogger.info('正 ID 暗占位移出追踪区前已释放身份', {
        reason,
        releasedIdentityID,
        replacementEntityID: card.entityID
      })
    }
    return releasedIdentityID
  }

  private findPublicZoneEntry(card: Card): [PublicZoneName, Zone] | null {
    const room = this.room
    const zoneID = card.location
    const zone = room.zones.get(zoneID)
    if (!zone || !zone.cards.includes(card)) return null
    return [zoneID, zone]
  }

  /**
   * 只读预测 materialize() 会返回的实体，不确认牌面，也不修改身份账本或物理位置。
   *
   * 返回已有实体表示本次调用会命中已定位身份；返回 target 表示新身份可占用该匿名槽。
   * 技能可据此先验证完整协议批次，再统一提交，避免失败校验留下半物化状态。
   */
  probeMaterialize(cardID: CardID, target: Card | null = null): Card | null {
    const room = this.room
    const normalizedCardID = Number(cardID)
    if (!(normalizedCardID > 0)) return null

    const existing = room.cardIndex.get(normalizedCardID)
    if (existing) return existing
    if (!target || !isAnonymous(target)) return null

    const wasDeckIdentity = room.deckIdentities.has(normalizedCardID)
    if (wasDeckIdentity && !room.unlocatedIdentities.has(normalizedCardID)) return null
    return target
  }

  /**
   * 将真实身份绑定到匿名物理槽，并同步身份守恒账本与查询索引。
   *
   * 公共区正 ID 实体只能证明它自身的身份，不能作为其它 CardID 的可替换物理代表。
   * 已定位身份命中玩家暗槽时，仍保留旧式暗手牌/mark interop；outside 或 suspended
   * 身份则可占用匿名公共槽重新进入物理区域。
   */
  materialize(cardID: CardID, target: Card | null = null): Card | null {
    const room = this.room
    const probedCard = room.probeMaterialize(cardID, target)
    if (!probedCard) return null

    const existing = room.cardIndex.get(cardID)
    if (existing) {
      // target 只有在匿名时才可承接已有身份。若 target 是其它正 ID，即使其牌面未公开，
      // 也不能用本次揭示覆盖该身份；调用方应保留原端点并走诊断/兜底路径。
      if (target && target !== existing && isAnonymous(target)) {
        this.materializeExistingIdentityAtTarget(existing, target)
      }

      existing.confirmKnown()
      // moveCards 会在 known 批次末尾再次调用恢复，直接公共揭示则不会；在物化原语内
      // 收口可确保 suspended 集合不会残留已重新出现的身份，重复恢复是幂等的。
      room.resumeSuspendedKnownCard(existing)
      return existing
    }

    // 未定位身份只能物化到没有真实身份的物理槽。正 ID 暗公共实体已不再是牌堆身份权威，
    // 但也不能被另一个身份覆盖；这条门槛把 Phase 4 的匿名洗牌结果固化为通用 known 契约。
    const wasDeckIdentity = room.deckIdentities.has(cardID)
    // 游戏外首次出现的合法正 ID 不在初始牌组中，发现时扩展身份全集。
    if (!wasDeckIdentity) {
      room.deckIdentities.add(cardID)
      room.unlocatedIdentities.add(cardID)
    }

    probedCard.materializeIdentity(cardID)
    probedCard.confirmKnown()
    room.cardIndex.set(cardID, probedCard)
    room.unlocatedIdentities.delete(cardID)
    room.counter?.addCard(probedCard)

    room.notifyCardChanged(probedCard, {
      type: 'card-identity-materialized',
      cardID: cardID
    })

    return probedCard
  }

  /**
   * 依次把公开身份物化到公共区端点的匿名槽，保持协议给出的展示顺序。
   */
  materializeAtPublicEndpoint(
    cardIDs: CardID[],
    zoneID: PublicZoneName,
    position: PublicPosition
  ): Card[] {
    const room = this.room
    const targets = room.getPublicEndpointCards(zoneID, cardIDs.length, position)
    // 端点中的同 ID 实体由 existing 分支直接确认；其它身份只能占用匿名槽。
    // 不跳过正 ID 暗端点去拿更深处匿名槽，否则会把协议端点顺序改写成本地选择。
    const availableTargets = targets.filter(isAnonymous)

    return cardIDs
      .map((cardID) => {
        const existing = room.cardIndex.get(cardID)
        const target = existing && targets.includes(existing) ? existing : availableTargets.shift()
        return room.materialize(cardID, target ?? null)
      })
      .filter((card): card is Card => Boolean(card))
  }

  /**
   * 将已有真实身份迁入匿名公共槽。
   *
   * 玩家暗手牌/mark 仍保留旧式正 ID interop：真实身份进入公共端点，匿名槽接管原玩家
   * 位置、候选与 mark 账本引用。outside/suspended 身份则直接替换匿名端点，匿名槽退出
   * 物理区域；这里不再支持任何正 ID 暗公共实体的 displaced/suspended 名额转交。
   */
  private materializeExistingIdentityAtTarget(existing: Card, target: Card): void {
    const room = this.room
    if (!isAnonymous(target)) return

    if (existing.location === 'player' && existing.isKnown !== true) {
      const oldSubZone = existing.subZone ?? 'hand'
      const oldSeats = Array.from(existing.seats, Number)
      const oldSpellID = existing.spellID
      const oldCombinationID = existing.combinationID
      const oldLocationCandidates = existing.getLocationCandidates()
      const targetZoneEntry = this.findPublicZoneEntry(target)

      if (!targetZoneEntry) return

      const [targetZoneID, targetZone] = targetZoneEntry
      room.removeCardsFromConstraintGroups([target])
      room.constraints.replaceCardInConstraintGroups(existing, target)
      existing.setLocationCandidates([], 'materialize:interop:known')
      existing.combinationID = null
      existing.moveToPublicZone(targetZoneID)
      targetZone.replaceCard(target, existing)

      if (oldLocationCandidates.length > 0) {
        target.location = 'player'
        target.subZone = oldSubZone
        target.spellID = oldSpellID
        target.suspended = false
        target.setLocationCandidates(oldLocationCandidates, 'materialize:interop:placeholder')
        target.setSeats(oldSeats, 'materialize:interop:placeholder')
        target.combinationID = oldCombinationID
        room.markCounterDirty(target)
        room.notifyCardChanged(target, {
          type: 'card-bound',
          subZone: oldSubZone,
          spellID: oldSpellID
        })
      } else {
        target.bindCandidates(oldSeats, oldSubZone, oldSpellID, { known: false })
        target.combinationID = oldCombinationID
      }

      room.movement.hiddenMarks.replaceHiddenMarkPlaceholder(existing, target)
      return
    }

    // 已知玩家实体或其它仍有确定物理位置的身份不能被公共揭示强行搬走；调用方按协议
    // 顺序保留本次匿名端点名额，后续 known 移动负责用来源占位修正陈旧位置。
    if (existing.location !== 'outside' && existing.location !== 'suspended') return

    const targetZoneEntry = this.findPublicZoneEntry(target)
    if (!targetZoneEntry) return

    const [targetZoneID, targetZone] = targetZoneEntry
    // existing 接管匿名槽的物理位置；target 没有真实身份，也不需要继承 suspended 角色。
    // materialize() 随后恢复 existing 的 suspended 集合状态，使身份与物理槽同时收敛。
    existing.moveToPublicZone(targetZoneID)
    targetZone.replaceCard(target, existing)
    target.moveToPublicZone('outside')
  }

  /**
   * 从游戏外补建实体：正 ID 身份牌和/或匿名占位。
   *
   * 调用场景（节选）：
   * - known 路径物化失败后的缺口补齐（process/pile 等公共区端点没有可 materialize 的匿名槽，
   *   且 cardIndex 尚无该正 ID 时，resolveKnownMoveCards 会 createExternalCards(missingIDs)）
   * - outside/exile 来源的新出现正 ID
   * - 匿名手牌对账、来源占位、洗牌替身等数量守恒兜底
   *
   * 重要语义：
   * - 新建 Card 默认 isKnown=false。正 ID 只表示“牌面身份实体已存在”，不等于“已对玩家公开”。
   * - 若协议路径是 knownIDs / discardKnown，调用方必须在落区前 confirmKnown()；
   *   RoomMovement.resolveKnownMoveCards 尾部已对 knownCards 统一确认，避免正 ID 暗实体进弃牌/处理区；
   *   其中 outside/exile 来源的新正 ID 初始暗状态属于正常过渡；
   *   其它来源的缺口补建虽复用本方法，仍需由 known-fallback 语义单独诊断。
   * - 匿名占位（id/entityID 为负）本就应保持 isKnown=false。
   */
  createExternalCards(cardIDs: CardID[] = [], count = cardIDs.length): Card[] {
    const room = this.room
    const ids = cardIDs.filter((id) => id > 0)
    const unknownCount = Math.max(0, Number(count) || 0, cardIDs.length) - ids.length

    const cards = [
      ...ids.map((id) => {
        const card = new Card(id, room)
        room.registerCardEntity(card)
        room.deckIdentities.add(card.id)
        room.cardIndex.set(card.id, card)
        room.unlocatedIdentities.delete(card.id)
        return card
      }),
      ...Array.from({ length: unknownCount }, () => {
        const card = new Card(0, room)
        room.registerCardEntity(card)
        return card
      })
    ]

    // 增量索引必须按 room.cards 的创建顺序登记新实体；否则实体首次进入手牌的事件顺序
    // 会成为排序依据，第二次洗牌后的增量桶顺序便可能与全量 rebuild 不同。
    cards.forEach((card) => card.moveToPublicZone('outside'))
    cards.forEach((card) => room.counter?.addCard(card))
    return cards
  }
}
