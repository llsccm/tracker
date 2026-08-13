import { describe, expect, it } from 'vitest'
import { POSITION_TOP } from '@/tracker/candidate/cardPositions'
import { getDuoQiState } from '@/tracker/skill/DuoQi'
// import { normalizeTrackerMovePosition } from '@/tracker/runtime/protocolRules'
import {
  formatTrackerProtocolReplayReport,
  parseTrackerProtocolJsonl,
  TrackerProtocolReplayer,
  type RecordedTrackerProtocol
} from './helpers/protocolReplay'
import { assertTrackerReplayConsistency } from './helpers/protocolReplay/snapshot'

describe('tracker protocol replay', () => {
  it('解析严格 JSONL 且拒绝时间等录制 schema 外字段', () => {
    const source = [
      JSON.stringify({ seq: 1, className: 'MsgGameRoundNtf', payload: { isPassed: false } }),
      JSON.stringify({ seq: 2, className: 'MsgGameOver', payload: {} })
    ].join('\n')

    expect(parseTrackerProtocolJsonl(source)).toEqual([
      { seq: 1, className: 'MsgGameRoundNtf', payload: { isPassed: false } },
      { seq: 2, className: 'MsgGameOver', payload: {} }
    ])
    expect(() =>
      parseTrackerProtocolJsonl(
        JSON.stringify({ seq: 1, className: 'MsgGameOver', payload: {}, timestamp: 123 })
      )
    ).toThrow('包含未支持字段：timestamp')
  })

  it('报告 JSONL 的四类结构错误', () => {
    expect(() => parseTrackerProtocolJsonl('{')).toThrow('不是有效 JSON')
    expect(() => parseTrackerProtocolJsonl('[]')).toThrow('必须是 JSON 对象')
    expect(() =>
      parseTrackerProtocolJsonl(
        [
          JSON.stringify({ seq: 1, className: 'MsgGameRoundNtf', payload: {} }),
          JSON.stringify({ seq: 3, className: 'MsgGameOver', payload: {} })
        ].join('\n')
      )
    ).toThrow('seq 应为 2')
    expect(() =>
      parseTrackerProtocolJsonl(JSON.stringify({ seq: 1, className: 'MsgGameOver', payload: [] }))
    ).toThrow('payload 必须是 JSON 对象')
  })

  it('在隔离 GameState 和 TrackerController 中重建牌堆与玩家手牌', () => {
    const records = openingRecords().concat({
      seq: 5,
      className: 'PubGsCMoveCard',
      payload: movePayload({ CardIDs: [1], CardCount: 1, ToID: 1 })
    })
    const replayer = new TrackerProtocolReplayer({ currentUserID: 101 })
    const report = replayer.replay(records)

    expect(report.success).toBe(true)
    expect(report).toMatchObject({ applied: 5, ignored: 0, partial: 0 })
    expect(report.finalState.room).toMatchObject({
      deckReady: true,
      mySeatID: 1,
      firstSeatID: 1,
      zones: { pile: { count: 3 } }
    })
    expect(
      replayer.controller
        .getReadyTrackerRoom()
        ?.getPlayer(1)
        ?.knownHandCards.map((card) => card.id)
    ).toEqual([1])
  })

  it('重放看牌协议并保留牌堆顶顺序供逻辑推断检查', () => {
    const records = openingRecords().concat({
      seq: 5,
      className: 'CGsRoleSpellOptRep',
      payload: { SpellID: 7009, Type: 30, SeatID: 1, Datas: [2, 3] }
    })
    const report = new TrackerProtocolReplayer({ currentUserID: 101 }).replay(records)

    expect(report.success).toBe(true)
    expect(report.finalState.room?.zones.pile.cardIDsBottomToTop.slice(-2).reverse()).toEqual([
      2, 3
    ])
  })

  it('3730 只由 DataID=8 记录目标，PubGsCUseSpell 不提前写入', () => {
    const records = openingRecords().concat(
      {
        seq: 5,
        className: 'CGsRoleSpellOptRep',
        payload: { SpellID: 0, Type: 72, SeatID: 1, Datas: [1, 2, 3, 4] }
      },
      {
        seq: 6,
        className: 'PubGsCUseSpell',
        payload: {
          SpellID: 3730,
          EffectIndex: 1,
          SeatID: 1,
          SkillOwerSeatID: 1,
          DestSeatIDs: [3],
          CardIDs: []
        }
      },
      {
        seq: 7,
        className: 'GsCUpdateRoleDataExNtf',
        payload: { DataID: 8, Datas: [3730, 1], SeatID: 2 }
      }
    )
    const replayer = new TrackerProtocolReplayer({ currentUserID: 101 })
    const report = replayer.replay(records)

    expect(report.success).toBe(true)
    expect(getDuoQiState(replayer.gameState)?.activations.get(3730)).toMatchObject({
      ownerSeatID: 1,
      targetSeatID: 2
    })
  })

  it('录制开始过晚时停在首条无法重建的协议并报告前置状态', () => {
    const record: RecordedTrackerProtocol = {
      seq: 1,
      className: 'PubGsCMoveCard',
      payload: movePayload({ CardIDs: [1], CardCount: 1, ToID: 1 })
    }
    const report = new TrackerProtocolReplayer({ captureFullSnapshots: true }).replay([record])

    expect(report.success).toBe(false)
    expect(report.failure).toMatchObject({
      seq: 1,
      className: 'PubGsCMoveCard',
      context: [record],
      stateBefore: { room: null }
    })
    expect(report.failure?.message).toContain('录制可能开始过晚')
  })

  it('默认不为失败点重复回放前缀，只有开启完整快照才给出失败前状态', () => {
    const records = openingRecords([1, 1]).slice(0, 3)
    const lean = new TrackerProtocolReplayer({ currentUserID: 101 }).replay(records)
    expect(lean.success).toBe(false)
    expect(lean.failure?.stateBefore).toBeNull()

    const detailed = new TrackerProtocolReplayer({
      currentUserID: 101,
      captureFullSnapshots: true
    }).replay(records)
    expect(detailed.failure?.stateBefore?.room?.deckReady).toBe(false)
  })

  it('每条协议后运行一致性检查并停在首个身份账本错误', () => {
    const records = openingRecords([1, 1]).slice(0, 3)
    const report = new TrackerProtocolReplayer({ currentUserID: 101 }).replay(records)

    expect(report.success).toBe(false)
    expect(report.failure).toMatchObject({ seq: 3, className: 'MsgGamePlayCardNtf' })
    expect(report.failure?.message).toContain('回放一致性检查失败')
    expect(report.failure?.stateAfter.room?.deckReady).toBe(true)
  })

  it('SpellID=713 的剔除下标越界时停止回放', () => {
    const records = openingRecords().concat({
      seq: 5,
      className: 'PubGsCMoveCard',
      payload: movePayload({
        CardIDs: [99, 0, 0],
        CardCount: 1,
        MoveType: 21,
        SpellID: 713
      })
    })
    const report = new TrackerProtocolReplayer({ currentUserID: 101 }).replay(records)

    expect(report.success).toBe(false)
    expect(report.failure?.message).toContain('SpellID=713 移动协议剔除下标 99 越界')
  })

  // it('回魂牌回牌堆时按原始牌顶位置过滤牌面', () => {
  //   const normalized = normalizeTrackerMovePosition({
  //     CardIDs: [4400, 7],
  //     CardCount: 2,
  //     FromID: 4,
  //     FromZone: 5,
  //     FromPosition: POSITION_TOP,
  //     ToID: 255,
  //     ToZone: 1,
  //     ToPosition: POSITION_TOP,
  //     MoveType: 19,
  //     SpellID: 0,
  //     isGuoZhan: false
  //   })

  //   expect(normalized.CardIDs).toEqual([7])
  //   expect(normalized.ToPosition).toBe(POSITION_RANDOM)
  // })

  it('一致性检查读取玩家快照而不推进快照游标', () => {
    const replayer = new TrackerProtocolReplayer({ currentUserID: 101 })
    const report = replayer.replay(openingRecords())
    expect(report.success).toBe(true)

    const room = replayer.controller.getReadyTrackerRoom()
    if (!room) throw new Error('测试预期 Room 已完成重建')
    const snapshotSeq = room.playerSnapshotSeq
    assertTrackerReplayConsistency(room, 'readonly-player-snapshot', { checkIndexes: false })
    expect(room.playerSnapshotSeq).toBe(snapshotSeq)
  })

  it('保留 isSend 后与生产处理器一致跳过发送侧移动', () => {
    const records = openingRecords([1, 2, 3])
      .slice(0, 3)
      .concat({
        seq: 4,
        className: 'PubGsCMoveCard',
        payload: movePayload({ CardIDs: [1], CardCount: 1, ToID: 1, isSend: 1 })
      })
    const report = new TrackerProtocolReplayer({ currentUserID: 101 }).replay(records)

    expect(report.success).toBe(true)
    expect(report).toMatchObject({ applied: 3, ignored: 1, partial: 0 })
    expect(report.finalState.room?.zones.pile.count).toBe(3)
  })

  it('默认只保留最终快照，按需开启时才保留逐条快照', () => {
    const report = new TrackerProtocolReplayer({ currentUserID: 101 }).replay(openingRecords())
    expect(report.steps.every((step) => step.state === undefined)).toBe(true)
    expect(report.finalState.room).not.toBeNull()

    const tracedReport = new TrackerProtocolReplayer({
      currentUserID: 101,
      captureStepStates: true
    }).replay(openingRecords())
    expect(tracedReport.steps.every((step) => step.state !== undefined)).toBe(true)
  })

  it('逐条状态只输出带快照的步骤并使用共享条数上限', () => {
    const report = new TrackerProtocolReplayer({
      currentUserID: 101,
      captureFullSnapshots: true
    }).replay(openingRecords())
    const mixedReport = {
      ...report,
      steps: report.steps.map((step, index) =>
        index === report.steps.length - 1 ? { ...step, state: undefined } : step
      )
    }

    const output = formatTrackerProtocolReplayReport(mixedReport, {
      includeFinalState: false,
      maxCardChanges: 2
    })
    const stateSection = output.slice(output.indexOf('逐条状态：'))

    expect(stateSection.match(/"seq":/g)).toHaveLength(2)
    expect(stateSection).toContain('"seq": 2')
    expect(stateSection).toContain('"seq": 3')
    expect(stateSection).not.toContain('"seq": 1')
    expect(stateSection).not.toContain('"seq": 4')
  })

  it('成功报告只汇总身份候选数量而不展开完整卡牌列表', () => {
    const report = new TrackerProtocolReplayer({ currentUserID: 101 }).replay(openingRecords())
    expect(report.success).toBe(true)
    const output = formatTrackerProtocolReplayReport(report)
    expect(output).toContain('"candidateCount": 4')
    expect(output).not.toContain('"cardIDs":')
  })
})

function openingRecords(cardIDs = [1, 2, 3, 4]): RecordedTrackerProtocol[] {
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
    {
      seq: 3,
      className: 'MsgGamePlayCardNtf',
      payload: { CardList: cardIDs }
    },
    {
      seq: 4,
      className: 'GsCFirstPhaseRole',
      payload: { SeatID: 1 }
    }
  ]
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
