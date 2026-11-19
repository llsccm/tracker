import { afterEach, describe, expect, it, vi } from 'vitest'
import { POSITION_RANDOM, POSITION_TOP } from '@/tracker/candidate/cardPositions'
import {
  MOVE_TYPE,
  getMoveTypeLabel,
  getProtocolMoveSpecialLabel,
  normalizeMoveEvent
} from '@/tracker/protocol/MoveEventNormalizer'
import { summarizeMoveContext, summarizeMoveEvent } from '@/tracker/helper/moveSummary'
import { TrackerController } from '@/tracker/runtime/trackerController'
import { trackerLogger } from '@/utils/logger'
import { collectTraversalStats } from '@/tracker/traversalStats'
import type { RawMoveCardEvent, TrackerLogger } from '@/tracker/types'
import { createNoopGameState } from '../helpers/noopRuntime'
import { createReadyControllerHarness } from '../helpers/trackerController'

vi.mock(import('@/tracker/helper/moveSummary'), async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    summarizeMoveContext: vi.fn(actual.summarizeMoveContext),
    summarizeMoveEvent: vi.fn(actual.summarizeMoveEvent)
  }
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.clearAllMocks()
  vi.unstubAllEnvs()
})

const pileGainMove: RawMoveCardEvent = {
  CardIDs: [],
  CardCount: 2,
  FromZone: 1,
  FromID: 255,
  FromPosition: POSITION_RANDOM,
  FromZoneParam: 0,
  MoveType: MOVE_TYPE.GAIN,
  SpellID: 3644,
  ToZone: 5,
  ToID: 1,
  ToPosition: POSITION_TOP,
  ToZoneParam: 0
}

describe('移动事件日志', () => {
  it('日志开关关闭时不构造移动摘要，重新开启后同一控制器恢复日志', () => {
    let enabled = false
    vi.spyOn(trackerLogger, 'enabled', 'get').mockImplementation(() => enabled)
    const info = vi.fn()
    const debug = vi.fn()
    const warn = vi.fn()
    const { controller, room } = createReadyControllerHarness({
      cardIDs: [1, 2, 3, 4],
      logger: {
        get enabled() {
          return enabled
        },
        info,
        debug,
        warn
      }
    })
    controller.syncTrackerMove({ ...pileGainMove, CardCount: 1 })

    expect(room.getZone('pile').cards).toHaveLength(3)
    expect(summarizeMoveEvent).not.toHaveBeenCalled()
    expect(summarizeMoveContext).not.toHaveBeenCalled()
    expect(info).not.toHaveBeenCalled()
    expect(debug).not.toHaveBeenCalled()
    expect(warn).not.toHaveBeenCalled()

    enabled = true
    controller.syncTrackerMove({ ...pileGainMove, CardCount: 1 })

    expect(room.getZone('pile').cards).toHaveLength(2)
    expect(summarizeMoveEvent).toHaveBeenCalled()
    expect(summarizeMoveContext).toHaveBeenCalled()
    expect(info).toHaveBeenCalled()
    expect(debug).toHaveBeenCalled()
  })

  it('非 DEV 环境仍同步移动和异常告警，但不生成详细摘要或遍历统计', () => {
    vi.stubEnv('DEV', false)
    vi.spyOn(trackerLogger, 'enabled', 'get').mockReturnValue(true)
    const info = vi.fn()
    const debug = vi.fn()
    const warn = vi.fn()
    const { controller, room } = createReadyControllerHarness({
      cardIDs: [1, 2, 3, 4],
      logger: { enabled: true, info, debug, warn }
    })

    const { stats } = collectTraversalStats(() => {
      controller.syncTrackerMove({ ...pileGainMove, CardIDs: [1, 0] })
    })

    expect(room.getZone('pile').cards).toHaveLength(2)
    expect(stats.sites.size).toBe(0)
    expect(summarizeMoveEvent).not.toHaveBeenCalled()
    expect(summarizeMoveContext).not.toHaveBeenCalled()
    expect(info).not.toHaveBeenCalled()
    expect(debug).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalledWith('移动协议明暗牌混合，按暗牌处理', expect.any(Object))
  })

  it.each([
    { cardIDs: [29], expectedType: 'moveKnown' },
    { cardIDs: [], expectedType: 'moveUnknown' }
  ])('类型 27 表示主动交给，按实际 ID 可见性归一为 $expectedType', ({ cardIDs, expectedType }) => {
    const move: RawMoveCardEvent = {
      ...pileGainMove,
      CardIDs: cardIDs,
      CardCount: 1,
      FromZone: 5,
      FromID: 1,
      ToID: 4,
      MoveType: MOVE_TYPE.GIVE,
      SpellID: 0
    }
    const event = normalizeMoveEvent(move)

    expect(MOVE_TYPE.GIVE).toBe(27)
    expect(getMoveTypeLabel(move.MoveType)).toBe('主动交给')
    expect(event.type).toBe(expectedType)
    expect(event.cardIDs).toBe(cardIDs)
    expect(event).toMatchObject({
      from: { type: 'player', seatID: 1, subZone: 'hand' },
      to: { type: 'player', seatID: 4, subZone: 'hand' },
      moveType: MOVE_TYPE.GIVE
    })
    expect(summarizeMoveEvent(event, { includeEventCardCount: true })).toMatchObject({
      type: expectedType,
      cardIDs,
      cardCount: 1,
      moveType: MOVE_TYPE.GIVE
    })
  })

  it('记录 MoveType 并标记从牌堆获取牌', () => {
    const event = normalizeMoveEvent(pileGainMove)
    const summary = summarizeMoveEvent(event, {
      normalizeCardIDs: true,
      includeEventCardCount: true
    })

    expect(getProtocolMoveSpecialLabel(pileGainMove)).toBe('从牌堆获取牌')
    expect(getMoveTypeLabel(pileGainMove.MoveType)).toBe('获得')
    expect(event.moveType).toBe(MOVE_TYPE.GAIN)
    expect(event.options.moveType).toBe(MOVE_TYPE.GAIN)
    expect(event.options.sourceEvent?.label).toBe('从牌堆获取牌')
    expect(summary).toMatchObject({
      type: 'drawUnknown',
      cardIDs: [],
      moveType: MOVE_TYPE.GAIN,
      label: '从牌堆获取牌',
      from: { type: 'public', zone: 'pile', position: POSITION_RANDOM },
      to: { type: 'player', seatID: 1, subZone: 'hand' },
      cardCount: 2,
      options: {
        moveType: MOVE_TYPE.GAIN
      }
    })
  })

  it.each([
    { fromZone: 1, label: '从牌堆获取牌' },
    { fromZone: 2, label: '从弃牌堆获取牌' }
  ])('控制器对 $label 使用特殊日志标题并保留来源与目标位置', ({ fromZone, label }) => {
    const infoCalls: unknown[][] = []
    const logger: TrackerLogger = {
      debug() {},
      info(...args: unknown[]) {
        infoCalls.push(args)
      },
      warn() {}
    }
    const controller = new TrackerController({
      gameState: createNoopGameState(),
      logger
    })

    controller.initTrackerRoom()
    controller.registerTrackerPlayers(
      [{ SeatID: 1, seat_id: 1, user_temp_id: 100, ClientID: 100 }],
      100
    )
    controller.initTrackerDeck([1, 2])
    controller.syncTrackerMove({
      ...pileGainMove,
      FromZone: fromZone,
      FromPosition: POSITION_RANDOM,
      ToPosition: 2
    })

    const protocolInput = infoCalls.find(([title]) => title === label)
    expect(protocolInput?.[1]).toMatchObject({
      raw: { FromPosition: POSITION_RANDOM, ToPosition: 2 },
      patched: { FromPosition: POSITION_RANDOM, ToPosition: 2 }
    })
  })

  it('弃牌堆类型 18 的已知牌和暗牌都带从弃牌堆获取牌标签', () => {
    for (const CardIDs of [[], [29]]) {
      const event = normalizeMoveEvent({ ...pileGainMove, FromZone: 2, CardIDs })
      expect(event.options.sourceEvent?.label).toBe('从弃牌堆获取牌')
      expect(summarizeMoveEvent(event).label).toBe('从弃牌堆获取牌')
    }
    expect(
      getProtocolMoveSpecialLabel({ ...pileGainMove, FromZone: 2, MoveType: 15 })
    ).toBeUndefined()
  })
})
