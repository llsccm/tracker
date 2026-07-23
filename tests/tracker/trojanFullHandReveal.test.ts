import { describe, expect, it, vi } from 'vitest'
import { createLocationCandidateKey } from '@/tracker/candidate/locationCandidate'
import { trackerLogger } from '@/utils/logger'
import { createTestRoom } from './helpers/room'
import { equipmentContainer } from './helpers/locationCandidates'

const TROJAN_SPELL_ID = 700

function dealKnownHand(room, cardIDs, seatID) {
  room.moveCards(cardIDs, 'player', {
    seatID,
    subZone: 'hand',
    fromZone: 'pile',
    cardCount: cardIDs.length,
    sourceEvent: { type: 'test:known-hand' }
  })
}

function dealHiddenHand(room, count, seatID) {
  room.moveCards(Array(count).fill(0), 'player', {
    seatID,
    subZone: 'hand',
    fromZone: 'pile',
    cardCount: count,
    sourceEvent: { type: 'test:hidden-hand' }
  })
}

function hiddenHandToTrojan(room, { seatID, count, spellID }) {
  room.moveCards(Array(count).fill(0), 'player', {
    seatID,
    fromSeatID: seatID,
    fromZone: 5,
    fromSubZone: 'hand',
    subZone: 'mark',
    spellID,
    cardCount: count,
    sourceEvent: { type: 'test:hidden-trojan' }
  })
}

function handToProcess(room, cardIDs, seatID) {
  room.moveCards(cardIDs, 'process', {
    fromSeatID: seatID,
    fromZone: 5,
    fromSubZone: 'hand',
    cardCount: cardIDs.length,
    sourceEvent: { type: 'test:hand-to-process' }
  })
}

describe('木马弱候选 + 整手完整揭示', () => {
  it('整手离场揭示 [29,50,113] 时应收敛 141 进木马且不产生实体缺口', () => {
    const seatID = 3
    const room = createTestRoom({
      cardIDs: [141, 29, 50, 113, 900, 901, 902, 903, 904, 905],
      seatIDs: [1, 2, 3],
      materializeDeckIdentities: false
    }).room

    // 3 号位：141(明) + 2 暗牌
    dealKnownHand(room, [141], seatID)
    dealHiddenHand(room, 2, seatID)

    // 暗置一张进木马(mark:700)：形成 141 hand/mark 弱候选
    hiddenHandToTrojan(room, { seatID, count: 1, spellID: TROJAN_SPELL_ID })

    // 之后又拿到明牌 113 + 一张暗牌，最终手牌 = 113(明) + 2 暗
    dealKnownHand(room, [113], seatID)

    const card141 = room.cardIndex.get(141)
    expect(card141, '141 应仍是实体').toBeTruthy()

    const warnSpy = vi.spyOn(trackerLogger, 'warn')

    // 整手完整离场进处理区，揭示为 [29, 50, 113]，141 不在其中
    handToProcess(room, [29, 50, 113], seatID)

    // 断言 1：不应出现实体缺口 / 置换失败告警
    expect(warnSpy).not.toHaveBeenCalledWith(
      '玩家来源 known 路径实体缺口，将 createExternal',
      expect.anything()
    )
    expect(warnSpy).not.toHaveBeenCalledWith(
      '玩家来源明牌未找到可立即置换的手牌占位',
      expect.anything()
    )

    // 断言 2：29/50/113 都进了处理区
    const processIDs = room.zones
      .get('process')!
      .cards.map((c) => c.id)
      .sort((a, b) => a - b)
    expect(processIDs).toEqual([29, 50, 113])

    // 断言 3：141 收敛进木马容器(mark:700)，不再是任何座位的普通手牌
    const settled141 = room.cardIndex.get(141)!
    expect(settled141.location).toBe('player')
    expect(settled141.getLocationCandidates().map((c) => createLocationCandidateKey(c))).toEqual([
      createLocationCandidateKey(equipmentContainer(161, TROJAN_SPELL_ID))
    ])
    // 已被木马容器候选收敛，不再拥有 hand 归属座位
    expect(Array.from(settled141.seats)).toEqual([])
    // 141 不应出现在处理区
    expect(room.zones.get('process')!.cards.map((c) => c.id)).not.toContain(141)

    // 3 号位手牌应清空（整手已离场）
    const handOfSeat3 = room.cards.filter(
      (c) => c.location === 'player' && c.subZone === 'hand' && c.seats.has(seatID)
    )
    expect(handOfSeat3.map((c) => c.id)).toEqual([])

    warnSpy.mockRestore()
  })
})
