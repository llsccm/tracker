import { describe, expect, it } from 'vitest'
import {
  MOVE_TYPE,
  getMoveTypeLabel,
  getProtocolMoveSpecialLabel,
  normalizeMoveEvent
} from '@/tracker/MoveEventNormalizer'
import { summarizeMoveEvent } from '@/tracker/helper/moveSummary'
import { TrackerController } from '@/tracker/runtime/trackerController'
import type { RawMoveCardEvent, TrackerLogger } from '@/tracker/types'
import { createNoopGameState } from './helpers/noopRuntime'

const pileGainMove: RawMoveCardEvent = {
  CardIDs: [],
  CardCount: 2,
  FromZone: 1,
  FromID: 255,
  FromZoneParam: 0,
  MoveType: MOVE_TYPE.GAIN,
  SpellID: 3644,
  ToZone: 5,
  ToID: 1,
  ToZoneParam: 0
}

describe('移动事件日志', () => {
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
      toZone: 'player',
      cardCount: 2,
      options: {
        fromZone: 'pile',
        moveType: MOVE_TYPE.GAIN
      }
    })
  })

  it('控制器对牌堆 MoveType 18 使用特殊日志标题并保留 ToPosition', () => {
    const infoCalls: unknown[][] = []
    const logger: TrackerLogger = {
      debug() {},
      info(...args: unknown[]) {
        infoCalls.push(args)
      },
      warn() {}
    }
    const gameState = createNoopGameState()
    const controller = new TrackerController({
      gameState,
      runtime: gameState,
      logger
    })

    controller.initTrackerRoom()
    controller.registerTrackerPlayers(
      [{ SeatID: 1, seat_id: 1, user_temp_id: 100, ClientID: 100 }],
      100
    )
    controller.initTrackerDeck([1, 2])
    controller.syncTrackerMove({ ...pileGainMove, ToPosition: 2 })

    const protocolInput = infoCalls.find(([label]) => label === '从牌堆获取牌')
    expect(protocolInput?.[1]).toMatchObject({
      raw: { ToPosition: 2 },
      patched: { ToPosition: 2 }
    })
  })
})
