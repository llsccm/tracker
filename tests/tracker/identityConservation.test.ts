import { describe, expect, it, vi } from 'vitest'
import { isAnonymous } from '@/tracker/Card'
import type { Room } from '@/tracker/Room'
import type { CardID } from '@/tracker/types'
import { trackerLogger } from '@/utils/logger'
import { createTestRoom } from './helpers/room'

/**
 * 身份账本守恒回归。
 *
 * `Room.assertConservation()` 已经能识别 `identity-missing`（身份既不在 cardIDex 也不在
 * unlocatedIdentities），但它只写 warn 日志。历史上 147 号身份就是这样从可枚举集合里
 * 永久漏出的：cardIndex 仍认为它已定位，CardCounter 却已把实体归为移出，
 * 于是后续洗牌既找不到它，也不会把它分类为活动 suspended。
 *
 * 本文件把该 warn 提升为断言，覆盖会释放/置换身份的几条真实路径。
 * 这些断言与是否推进牌堆匿名化重构无关，属于独立的安全网。
 */

/** 捕获一次守恒观测中的问题列表；房间健康时返回空数组。 */
function captureConservationIssues(room: Room, context: string): Record<string, unknown>[] {
  const warnSpy = vi.spyOn(trackerLogger, 'warn').mockImplementation(() => {})

  try {
    room.assertConservation(context)

    const warning = warnSpy.mock.calls.find(
      ([message]) => message === 'Room 身份/槽位守恒观测发现不一致'
    )
    const payload = warning?.[1] as { issues?: Record<string, unknown>[] } | undefined
    return payload?.issues ?? []
  } finally {
    warnSpy.mockRestore()
  }
}

function expectConservationClean(room: Room, context: string): void {
  expect(captureConservationIssues(room, context)).toEqual([])
}

/**
 * 身份全集的可枚举性：deckIdentities 中每个 ID 必须恰好处于
 * “已绑定实体” 或 “未定位” 之一。这正是 147 号身份丢失时被违反的不变量。
 */
function enumerateIdentityPartition(room: Room): {
  located: CardID[]
  unlocated: CardID[]
  missing: CardID[]
  duplicated: CardID[]
} {
  const located: CardID[] = []
  const unlocated: CardID[] = []
  const missing: CardID[] = []
  const duplicated: CardID[] = []

  room.deckIdentities.forEach((cardID) => {
    const isLocated = room.cardIndex.has(cardID)
    const isUnlocated = room.unlocatedIdentities.has(cardID)

    if (isLocated && isUnlocated) duplicated.push(cardID)
    else if (isLocated) located.push(cardID)
    else if (isUnlocated) unlocated.push(cardID)
    else missing.push(cardID)
  })

  return { located, unlocated, missing, duplicated }
}

function expectIdentityLedgerIntact(room: Room, expectedIdentityIDs: CardID[]): void {
  const partition = enumerateIdentityPartition(room)

  expect(partition.missing).toEqual([])
  expect(partition.duplicated).toEqual([])
  expect([...partition.located, ...partition.unlocated].sort((a, b) => a - b)).toEqual(
    [...expectedIdentityIDs].sort((a, b) => a - b)
  )
}

describe('身份账本守恒', () => {
  it('洗牌后身份全集仍可完整枚举', () => {
    const { room } = createTestRoom({
      cardIDs: [1, 2, 3, 4, 5, 6],
      seatIDs: [1],
      materializeDeckIdentities: false
    })

    room.moveCards([], 'player', {
      seatID: 1,
      fromZone: 'pile',
      cardCount: 2,
      sourceEvent: { type: 'conservation:draw-unknown' }
    })
    room.moveCards([1, 2, 3], 'discard', {
      fromZone: 'pile',
      cardCount: 3,
      sourceEvent: { type: 'conservation:discard' }
    })

    room.shufflePile({ cardCount: 4 })

    expectIdentityLedgerIntact(room, [1, 2, 3, 4, 5, 6])
    expectConservationClean(room, 'test:shuffle')
  })

  it('连续两次洗牌不丢失任何身份', () => {
    const { room } = createTestRoom({
      cardIDs: [1, 2, 3, 4, 5, 6],
      seatIDs: [1],
      materializeDeckIdentities: false
    })
    const pile = room.zones.get('pile')!
    const discard = room.zones.get('discard')!

    room.moveCards([], 'player', {
      seatID: 1,
      fromZone: 'pile',
      cardCount: 2,
      sourceEvent: { type: 'conservation:draw-unknown' }
    })
    room.moveCards([1, 2, 3], 'discard', {
      fromZone: 'pile',
      cardCount: 3,
      sourceEvent: { type: 'conservation:discard' }
    })
    room.shufflePile({ cardCount: 4 })

    expectIdentityLedgerIntact(room, [1, 2, 3, 4, 5, 6])

    // 第二次洗牌前再制造一次弃牌，让沿用 suspended 与本轮新增混合。
    room.moveCards([4], 'discard', {
      fromZone: 'pile',
      cardCount: 1,
      sourceEvent: { type: 'conservation:discard-second-round' }
    })
    room.shufflePile({ cardCount: pile.cards.length + discard.cards.length })

    expectIdentityLedgerIntact(room, [1, 2, 3, 4, 5, 6])
    expectConservationClean(room, 'test:shuffle-twice')
  })

  it('正 ID 暗占位移出追踪区时把身份退回未定位池', () => {
    const { room } = createTestRoom({
      cardIDs: [1, 2, 3, 4],
      seatIDs: [1],
      materializeDeckIdentities: false
    })
    const pile = room.zones.get('pile')!

    // 让一张牌以正 ID 暗槽形态留在牌堆：物化身份后再隐藏牌面。
    const target = pile.cards.find(isAnonymous)!
    const placeholder = room.materialize(1, target)!
    placeholder.isKnown = false

    expect(placeholder.id).toBe(1)
    expect(room.cardIndex.has(1)).toBe(true)
    expect(room.unlocatedIdentities.has(1)).toBe(false)

    // moveToPublicZone 只改 location，不会把实体移出旧区域数组；
    // 生产调用点都先摘除公共区引用，这里同样保持槽位账本一致。
    pile.removeCard(placeholder)
    const releasedIdentityID = room.releaseUnknownPlaceholderToOutside(placeholder, 'test:release')

    expect(releasedIdentityID).toBe(1)
    expect(room.cardIndex.has(1)).toBe(false)
    expect(room.unlocatedIdentities.has(1)).toBe(true)
    expect(room.deckIdentities.has(1)).toBe(true)
    expect(placeholder.location).toBe('outside')
    expect(placeholder).toSatisfy(isAnonymous)

    expectIdentityLedgerIntact(room, [1, 2, 3, 4])
    expectConservationClean(room, 'test:release-placeholder')
  })

  it('已知正 ID 不按暗占位移出追踪区', () => {
    const { room } = createTestRoom({
      cardIDs: [1, 2, 3, 4],
      seatIDs: [1],
      materializeDeckIdentities: false
    })
    const pile = room.zones.get('pile')!
    const card = room.materialize(1, pile.cards.find(isAnonymous)!)!
    const warnSpy = vi.spyOn(trackerLogger, 'warn').mockImplementation(() => {})

    try {
      expect(room.releaseUnknownPlaceholderToOutside(card, 'test:known-guard')).toBeNull()
      expect(card.location).toBe('pile')
      expect(card.isKnown).toBe(true)
      expect(room.cardIndex.get(1)).toBe(card)
      expect(room.unlocatedIdentities.has(1)).toBe(false)
    } finally {
      warnSpy.mockRestore()
    }
  })

  it('暗占位解绑失败时返回 null 并保持暂停身份', () => {
    const { room } = createTestRoom({
      cardIDs: [1, 2, 3, 4],
      seatIDs: [1],
      materializeDeckIdentities: false
    })
    const pile = room.zones.get('pile')!
    const card = room.materialize(1, pile.cards.find(isAnonymous)!)!
    card.isKnown = false
    const anonymizeSpy = vi.spyOn(room, 'anonymizeLocatedIdentity').mockReturnValue(null)
    const warnSpy = vi.spyOn(trackerLogger, 'warn').mockImplementation(() => {})

    try {
      expect(room.releaseUnknownPlaceholderToOutside(card, 'test:release-failed')).toBeNull()
      expect(card.location).toBe('suspended')
      expect(card.isKnown).toBe(true)
      expect(room.suspendedKnownCards.has(card)).toBe(true)
      expect(room.cardIndex.get(1)).toBe(card)
      expect(room.unlocatedIdentities.has(1)).toBe(false)
    } finally {
      anonymizeSpy.mockRestore()
      warnSpy.mockRestore()
    }
  })

  it('anonymizeLocatedIdentity 是唯一解绑原语，成功时保证分区守恒', () => {
    const { room } = createTestRoom({
      cardIDs: [1, 2, 3, 4],
      seatIDs: [1],
      materializeDeckIdentities: false
    })
    const pile = room.zones.get('pile')!
    const warnSpy = vi.spyOn(trackerLogger, 'warn').mockImplementation(() => {})

    try {
      const target = pile.cards.find(isAnonymous)!
      const card = room.materialize(1, target)!

      const released = room.anonymizeLocatedIdentity(card, 'test:primitive')

      expect(released).toBe(1)
      // 原语内置的分区守恒断言不应告警。
      expect(
        warnSpy.mock.calls.filter(([message]) => message === '身份解绑后分区守恒被破坏')
      ).toEqual([])
      expect(room.cardIndex.has(1)).toBe(false)
      expect(room.unlocatedIdentities.has(1)).toBe(true)
      expect(room.deckIdentities.has(1)).toBe(true)
      expect(card).toSatisfy(isAnonymous)

      expectIdentityLedgerIntact(room, [1, 2, 3, 4])
    } finally {
      warnSpy.mockRestore()
    }
  })

  it('anonymizeLocatedIdentity 前置条件不满足时返回 null 且不改变任何状态', () => {
    const { room } = createTestRoom({
      cardIDs: [1, 2, 3, 4],
      seatIDs: [1],
      materializeDeckIdentities: false
    })
    const pile = room.zones.get('pile')!

    // 匿名槽本就没有真实身份可解绑。
    const anonymousSlot = pile.cards.find(isAnonymous)!
    const before = {
      cardIndexSize: room.cardIndex.size,
      unlocated: Array.from(room.unlocatedIdentities).sort((a, b) => a - b),
      entityID: anonymousSlot.entityID
    }

    expect(room.anonymizeLocatedIdentity(anonymousSlot, 'test:no-identity')).toBeNull()

    expect(room.cardIndex.size).toBe(before.cardIndexSize)
    expect(Array.from(room.unlocatedIdentities).sort((a, b) => a - b)).toEqual(before.unlocated)
    expect(anonymousSlot.entityID).toBe(before.entityID)
    expectIdentityLedgerIntact(room, [1, 2, 3, 4])
  })

  it('身份被移出追踪区而未退回账本时守恒观测会报告 identity-missing', () => {
    const { room } = createTestRoom({
      cardIDs: [1, 2, 3, 4],
      seatIDs: [1],
      materializeDeckIdentities: false
    })
    const pile = room.zones.get('pile')!

    const target = pile.cards.find(isAnonymous)!
    const placeholder = room.materialize(1, target)!
    placeholder.isKnown = false

    // 这是修复前的旧行为：直接移出，既不解绑 cardIndex 也不退回 unlocatedIdentities。
    // 该断言锁定“漏出可被观测到”，避免守恒探针本身退化成静默通过。
    pile.removeCard(placeholder)
    room.cardIndex.delete(1)
    placeholder.moveToPublicZone('outside')

    const partition = enumerateIdentityPartition(room)
    expect(partition.missing).toEqual([1])

    const issues = captureConservationIssues(room, 'test:leaked-identity')
    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ domain: 'identity', type: 'identity-missing', cardID: 1 })
      ])
    )
  })

  it('未定位身份复用正 ID 暗牌堆槽后账本仍然守恒', () => {
    const { room } = createTestRoom({
      cardIDs: [1, 2, 3, 4, 5, 6],
      seatIDs: [1],
      materializeDeckIdentities: false
    })
    const pile = room.zones.get('pile')!

    room.moveCards([], 'player', {
      seatID: 1,
      fromZone: 'pile',
      cardCount: 2,
      sourceEvent: { type: 'conservation:draw-unknown' }
    })
    room.moveCards([1, 2, 3], 'discard', {
      fromZone: 'pile',
      cardCount: 3,
      sourceEvent: { type: 'conservation:discard' }
    })
    room.shufflePile({ cardCount: 4 })

    // 洗牌后牌堆里存在 reset() 留下的正 ID 暗槽；明摸另一个未定位身份应复用该物理槽。
    const hiddenSlot = pile.cards.find((card) => card.id > 0 && card.isKnown !== true)
    expect(hiddenSlot).toBeDefined()

    const pileCountBefore = pile.cards.length
    room.moveCards([4], 'player', {
      seatID: 1,
      fromZone: 'pile',
      cardCount: 1,
      sourceEvent: { type: 'conservation:draw-known-onto-hidden-slot' }
    })

    // 物理槽守恒：身份绑定成功与否都必须消费恰好一个牌堆槽。
    expect(pile.cards).toHaveLength(pileCountBefore - 1)
    expectIdentityLedgerIntact(room, [1, 2, 3, 4, 5, 6])
    expectConservationClean(room, 'test:reuse-hidden-slot')
  })

  it('12 区外部牌进入牌组后只扩展一次身份全集', () => {
    const { room } = createTestRoom({
      cardIDs: [1, 2, 3],
      seatIDs: [1],
      materializeDeckIdentities: false
    })
    const externalID = 60461

    expect(room.deckIdentities.has(externalID)).toBe(false)

    room.moveCards([externalID], 'player', {
      seatID: 1,
      fromZone: 'outside',
      cardCount: 1,
      sourceEvent: { type: 'conservation:external-zone-12' }
    })

    expect(room.deckIdentities.has(externalID)).toBe(true)
    expectIdentityLedgerIntact(room, [1, 2, 3, externalID])

    // 该外部牌进入弃牌堆并参与洗牌后，身份全集不应再次增长。
    room.moveCards([externalID], 'discard', {
      seatID: 1,
      fromZone: 'player',
      cardCount: 1,
      sourceEvent: { type: 'conservation:external-discard' }
    })
    room.shufflePile({ cardCount: room.zones.get('pile')!.cards.length + 1 })

    expect(room.deckIdentities.size).toBe(4)
    expectIdentityLedgerIntact(room, [1, 2, 3, externalID])
    expectConservationClean(room, 'test:external-card-shuffle')
  })
})
