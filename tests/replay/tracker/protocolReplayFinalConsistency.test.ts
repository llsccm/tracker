import { describe, expect, it, vi } from 'vitest'
import { POSITION_TOP } from '@/tracker/candidate/cardPositions'
import type * as SnapshotModule from './helpers/protocolReplay/snapshot'
import { TrackerProtocolReplayer, type RecordedTrackerProtocol } from './helpers/protocolReplay'

vi.mock('./helpers/protocolReplay/snapshot', async (importOriginal) => {
  const actual = await importOriginal<typeof SnapshotModule>()
  const consistency = actual.assertTrackerReplayConsistency

  return {
    ...actual,
    assertTrackerReplayConsistency: vi.fn(
      (
        room: Parameters<typeof consistency>[0],
        context: Parameters<typeof consistency>[1],
        options: Parameters<typeof consistency>[2]
      ) => {
        if (context.startsWith('final:')) throw new Error('模拟收尾索引核对失败')
        return consistency(room, context, options)
      }
    )
  }
})

describe('回放诊断：收尾索引核对失败', () => {
  it('fast 模式收尾索引核对失败时回放结果必须为失败', () => {
    const report = new TrackerProtocolReplayer({ currentUserID: 101, mode: 'fast' }).replay(
      drawRecords()
    )

    expect(report.success).toBe(false)
    expect(report.diagnostics.taintReasons.join(' ')).toContain('收尾索引核对失败')
  })
})

function openingRecords(): RecordedTrackerProtocol[] {
  return [
    {
      seq: 1,
      className: 'decodeGameRecordInitInfo',
      payload: { ProtoObj: { matchName: '标准身份' } }
    },
    {
      seq: 2,
      className: 'decodeGsClientUserSeatFlagNtf',
      payload: {
        data: {
          protoObj: {
            seatinfo: [
              { SeatID: 1, ClientID: 101 },
              { SeatID: 2, ClientID: 202 }
            ]
          }
        }
      }
    },
    { seq: 3, className: 'MsgGamePlayCardNtf', payload: { CardList: [1, 2, 3, 4] } },
    { seq: 4, className: 'GsCFirstPhaseRole', payload: { SeatID: 1 } }
  ]
}

function drawRecords(): RecordedTrackerProtocol[] {
  return openingRecords().concat({
    seq: 5,
    className: 'PubGsCMoveCard',
    payload: movePayload({ CardIDs: [1], CardCount: 1, ToID: 1 })
  })
}

function movePayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    CardIDs: [0],
    CardCount: 1,
    FromID: 255,
    FromZone: 1,
    FromZoneParam: 0,
    FromPosition: POSITION_TOP,
    ToID: 1,
    ToZone: 5,
    ToZoneParam: 0,
    ToPosition: POSITION_TOP,
    MoveType: 1,
    SpellID: 0,
    ...overrides
  }
}
