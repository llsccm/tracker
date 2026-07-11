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

  function setupSourceHand(): Room {
    const { room } = createTestRoom({ cardIDs: allIDs, seatIDs: [2, 3] })
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

      // ★ 已知反例（④ 待办，见 report §6.2）：seat3 观测手牌已被 42/46/47 三张明牌占满，
      //   两张暗牌 130/131 物理上只可能位于 seat2；但局部约束组不做全局消除，
      //   它们仍保留不可能的 seat3 候选。这里锁定的是“当前行为”而非理想收敛——
      //   拆分 unknownCardCount / 收口身份置换后，此处应收敛为 seats=[2]。
      hiddenIDs.forEach((id) => expect(Array.from(getCard(room, id).seats)).toEqual([2, 3]))
      // 但计数层面已正确：seat2 持有全部 2 张暗牌，seat3 无未知槽。
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
                3,
              ],
            },
            "131": {
              "known": false,
              "location": "player",
              "seats": [
                2,
                3,
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
})
