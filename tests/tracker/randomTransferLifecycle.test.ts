import { describe, expect, it, vi } from 'vitest'
import { trackerLogger } from '@/utils/logger'
import type { Room } from '@/tracker/Room'
import { createTestRoom, getCard } from './helpers/room'

// ⑤ 长链路端到端回归：随机转移 → 局部展示 → 打明牌 → 完整展示 → 收敛。
// 目的：在拆分 unknownCardCount / 收口身份置换之前，先锁定当前跨阶段行为，
// 防止后续重构在“单步测试都过、串起来却错”的组合路径上回归。
// 参见 plans/random-hand-transfer-and-anonymous-entity-implementation-report.md §6.2。
describe('随机手牌转移完整生命周期', () => {
  const knownIDs = [42, 46, 47, 59, 94, 118, 137]
  const hiddenIDs = [130, 131]
  const allIDs = [...knownIDs, ...hiddenIDs]

  function setupSourceHand(extraCardIDs: number[] = []): Room {
    const { room } = createTestRoom({ cardIDs: [...allIDs, ...extraCardIDs], seatIDs: [2, 3] })
    const sourceCards = allIDs.map((id) => getCard(room, id))

    room.clearCardsFromPublicZones(sourceCards)
    sourceCards.forEach((card) => {
      card.bindCandidates([2], 'hand', null, { known: knownIDs.includes(card.id) })
      if (hiddenIDs.includes(card.id)) {
        card.isKnown = false
        room.notifyCardChanged(card, { type: 'test:hidden-card' })
      }
    })
    room.getPlayer(2).syncObservedHandCount(9)
    room.getPlayer(3).syncObservedHandCount(0)
    return room
  }

  // 端到端状态快照：每张牌的座位候选 / 物理区域 / 是否已公开，加上两名玩家的观测与未知计数。
  // 座位排序保证快照稳定，便于以 inline snapshot 锁定最终收敛结果。
  function summarize(room: Room): unknown {
    const cards: Record<number, { seats: number[]; location: string; known: boolean }> = {}
    allIDs.forEach((id) => {
      const card = getCard(room, id)
      cards[id] = {
        seats: Array.from(card.seats)
          .map((seatID) => Number(seatID))
          .sort((a, b) => a - b),
        location: card.location,
        known: card.isKnown === true
      }
    })

    const playerState = (seatID: number) => {
      const player = room.getPlayer(seatID)
      return { observed: player.observedHandCount, unknown: player.unknownCardCount }
    }

    return { cards, seat2: playerState(2), seat3: playerState(3) }
  }

  it('转移→局部展示→打明牌→完整展示后明暗实体全部收敛', () => {
    const room = setupSourceHand()
    const warnSpy = vi.spyOn(trackerLogger, 'warn').mockImplementation(() => {})

    try {
      // 1. 随机转移 3 张暗牌 seat2 → seat3（协议只给数量，不给具体 ID）。
      room.moveCards([], 'player', {
        fromZone: null,
        fromSeatID: 2,
        fromSubZone: 'hand',
        seatID: 3,
        subZone: 'hand',
        cardCount: 3,
        sourceEvent: { type: 'e2e:random-transfer' }
      })

      const transferGroup = Array.from(room.constraintGroups.values()).find(
        (group) => (group.sourceEvent as { type?: string } | null)?.type === 'e2e:random-transfer'
      )
      expect(transferGroup?.expectedSlotsBySeat.get(2)).toBe(6)
      expect(transferGroup?.expectedSlotsBySeat.get(3)).toBe(3)
      expect(
        allIDs.every((id) => {
          const card = getCard(room, id)
          return card.seats.has(2) && card.seats.has(3)
        })
      ).toBe(true)
      expect(room.getPlayer(2).observedHandCount).toBe(6)
      expect(room.getPlayer(3).observedHandCount).toBe(3)
      // 目标候选 UI 只展示明牌，暗牌不泄露物理 ID。
      expect(room.getPlayer(3).candidateHandCards).toEqual(knownIDs.map((id) => getCard(room, id)))

      // 2. 局部展示：seat3 亮出其中一张明牌 42（完整展示前的部分收敛）。
      room.moveCards([42], 'player', {
        seatID: 3,
        fromSeatID: 3,
        fromZone: null,
        fromSubZone: 'hand',
        subZone: 'hand',
        cardCount: 1,
        sourceEvent: { type: 'e2e:partial-reveal' }
      })
      expect(getCard(room, 42).seats.has(3)).toBe(true)

      // 3. 打明牌：seat2 打出候选明牌 137 到处理区（不应缺来源占位）。
      room.moveCards([137], 'process', {
        fromZone: null,
        fromSeatID: 2,
        fromSubZone: 'hand',
        cardCount: 1,
        sourceEvent: { type: 'e2e:play-known' }
      })
      expect(getCard(room, 137).location).toBe('process')

      // 4. 完整展示：seat3 完整手牌 [42, 46, 47]，触发跨座位候选完全收敛。
      room.syncObservedPlayerHandCount(3, 3, { resolve: false })
      room.moveCards([42, 46, 47], 'player', {
        seatID: 3,
        fromSeatID: 3,
        fromZone: null,
        fromSubZone: 'hand',
        subZone: 'hand',
        cardCount: 3,
        sourceEvent: { type: 'e2e:full-reveal' }
      })

      // 5. 收敛后：seat3 手牌固定为 [42,46,47]，seat2 剩余明牌回到 seat2；暗牌仍未公开。
      ;[42, 46, 47].forEach((id) => expect(Array.from(getCard(room, id).seats)).toEqual([3]))
      ;[59, 94, 118].forEach((id) => expect(Array.from(getCard(room, id).seats)).toEqual([2]))
      hiddenIDs.forEach((id) => expect(getCard(room, id).isKnown).toBe(false))

      // ★ 已修复（④ 定向修复，见 report §6.2）：转移约束组补上 expectedSlotsByLocation 后，
      //   seat3 手牌槽被 42/46/47 占满使 seat3/hand 名额清零，位置层消除会剔除两张暗牌
      //   130/131 不可能的 seat3 候选，收敛为 seats=[2]（此前它们错误地保留 {2,3}）。
      hiddenIDs.forEach((id) => expect(Array.from(getCard(room, id).seats)).toEqual([2]))
      // 计数层面同样正确：seat2 持有全部 2 张暗牌，seat3 无未知槽。
      expect(room.getPlayer(2).unknownCardCount).toBe(2)
      expect(room.getPlayer(3).unknownCardCount).toBe(0)

      // 全程不得触发“来源占位缺失 / 公共区残留回补”警告。
      expect(warnSpy).not.toHaveBeenCalledWith(
        '玩家来源明牌未找到可立即置换的手牌占位',
        expect.anything()
      )
      expect(warnSpy).not.toHaveBeenCalledWith(
        '玩家来源明牌残留公共区，已尝试用来源占位回补旧公共区槽位',
        expect.anything()
      )

      // 锁定完整收敛终态（首次运行用 `vitest run -u` 生成，随后作为回归护栏）。
      expect(summarize(room)).toMatchInlineSnapshot(`
        {
          "cards": {
            "118": {
              "known": true,
              "location": "player",
              "seats": [
                2,
              ],
            },
            "130": {
              "known": false,
              "location": "player",
              "seats": [
                2,
              ],
            },
            "131": {
              "known": false,
              "location": "player",
              "seats": [
                2,
              ],
            },
            "137": {
              "known": true,
              "location": "process",
              "seats": [],
            },
            "42": {
              "known": true,
              "location": "player",
              "seats": [
                3,
              ],
            },
            "46": {
              "known": true,
              "location": "player",
              "seats": [
                3,
              ],
            },
            "47": {
              "known": true,
              "location": "player",
              "seats": [
                3,
              ],
            },
            "59": {
              "known": true,
              "location": "player",
              "seats": [
                2,
              ],
            },
            "94": {
              "known": true,
              "location": "player",
              "seats": [
                2,
              ],
            },
          },
          "seat2": {
            "observed": 5,
            "unknown": 2,
          },
          "seat3": {
            "observed": 3,
            "unknown": 0,
          },
        }
      `)
    } finally {
      warnSpy.mockRestore()
    }
  })

  it('来源使用一张暗牌后只扣除一个来源槽位，不提前锁定剩余候选', () => {
    const sourceKnownIDs = [59, 42, 46, 47, 137, 118, 94]
    const sourceHiddenIDs = [131, 132]
    const playedHiddenID = 160
    const targetDrawIDs = [107, 14, 135, 48, 39, 114]
    const sourceIDs = [...sourceKnownIDs, ...sourceHiddenIDs]
    const { room } = createTestRoom({
      cardIDs: [...sourceIDs, playedHiddenID, 130, ...targetDrawIDs],
      seatIDs: [2, 3]
    })

    const sourceCards = sourceIDs.map((id) => getCard(room, id))
    room.clearCardsFromPublicZones(sourceCards)
    sourceCards.forEach((card) => {
      card.bindCandidates([2], 'hand', null, { known: sourceKnownIDs.includes(card.id) })
      if (sourceHiddenIDs.includes(card.id)) {
        card.isKnown = false
        room.notifyCardChanged(card, { type: 'test:hidden-card' })
      }
    })
    room.getPlayer(2).syncObservedHandCount(9)
    room.getPlayer(3).syncObservedHandCount(0)

    room.moveCards([], 'player', {
      fromZone: null,
      fromSeatID: 2,
      fromSubZone: 'hand',
      seatID: 3,
      subZone: 'hand',
      cardCount: 3,
      sourceEvent: { type: 'regression:random-transfer' }
    })

    const transferGroup = Array.from(room.constraintGroups.values()).find(
      (group) =>
        (group.sourceEvent as { type?: string } | null)?.type === 'regression:random-transfer'
    )
    expect(transferGroup).toBeDefined()

    // 2 号位使用一张此前未公开、此时协议才给出具体 ID 的手牌。身份置换只能确认一个
    // 暗实体来自 2 号位，不能把另一张暗实体也锁给 2 号位。
    room.moveCards([playedHiddenID], 'process', {
      fromZone: null,
      fromSeatID: 2,
      fromSubZone: 'hand',
      cardCount: 1,
      sourceEvent: { type: 'regression:source-uses-hidden' }
    })

    expect(transferGroup?.cards.size).toBe(8)
    expect(transferGroup?.expectedSlotsBySeat.get(2)).toBe(5)
    expect(transferGroup?.expectedSlotsBySeat.get(3)).toBe(3)

    const remainingHiddenCard = sourceHiddenIDs
      .map((id) => getCard(room, id))
      .find((card) => card.location === 'player')
    expect(remainingHiddenCard).toBeDefined()
    expect(Array.from(remainingHiddenCard?.seats ?? []).sort()).toEqual([2, 3])

    // 后续 2 号位再打出三张明牌，原组只剩 2 号位 2 张、3 号位 3 张。
    room.moveCards([59, 47, 94], 'discard', {
      fromZone: null,
      fromSeatID: 2,
      fromSubZone: 'hand',
      cardCount: 3,
      sourceEvent: { type: 'regression:source-plays-known' }
    })
    expect(transferGroup?.expectedSlotsBySeat.get(2)).toBe(2)
    expect(transferGroup?.expectedSlotsBySeat.get(3)).toBe(3)

    // 130 酒是组外新摸到的确定明牌，此时 2 号位总手牌数为 3。
    room.moveCards([130], 'player', {
      fromZone: 'pile',
      seatID: 2,
      subZone: 'hand',
      cardCount: 1,
      sourceEvent: { type: 'regression:source-draws-130' }
    })
    expect(room.getPlayer(2).observedHandCount).toBe(3)
    expect(room.getPlayer(2).knownHandCards.map((card) => card.id)).toEqual([130])

    // 3 号位补到 9 张后弃 6 张，其中 137、42 来自最初的随机转移。
    room.moveCards(targetDrawIDs, 'player', {
      fromZone: 'pile',
      seatID: 3,
      subZone: 'hand',
      cardCount: targetDrawIDs.length,
      sourceEvent: { type: 'regression:target-draws' }
    })
    room.moveCards([107, 14, 137, 42, 135, 48], 'discard', {
      fromZone: null,
      fromSeatID: 3,
      fromSubZone: 'hand',
      cardCount: 6,
      sourceEvent: { type: 'regression:target-discards' }
    })

    expect(transferGroup?.cards.size).toBe(3)
    expect(transferGroup?.expectedSlotsBySeat.get(2)).toBe(2)
    expect(transferGroup?.expectedSlotsBySeat.get(3)).toBe(1)
    expect(Array.from(getCard(room, 46).seats).sort()).toEqual([2, 3])
    expect(Array.from(getCard(room, 118).seats).sort()).toEqual([2, 3])
    expect(Array.from(remainingHiddenCard?.seats ?? []).sort()).toEqual([2, 3])

    // 完整展示才足以确认 46 桃属于 3 号位，并反推出 2 号位为 130、118、暗牌。
    room.moveCards([39, 46, 114], 'player', {
      fromZone: null,
      fromSeatID: 3,
      fromSubZone: 'hand',
      seatID: 3,
      subZone: 'hand',
      cardCount: 3,
      sourceEvent: { type: 'regression:target-full-hand' }
    })
    expect(Array.from(getCard(room, 46).seats)).toEqual([3])
    expect(Array.from(getCard(room, 118).seats)).toEqual([2])
    expect(Array.from(remainingHiddenCard?.seats ?? [])).toEqual([2])
    expect(
      room
        .getPlayer(2)
        .knownHandCards.map((card) => card.id)
        .sort()
    ).toEqual([118, 130])
    expect(room.getPlayer(2).unknownCardCount).toBe(1)
  })
})
