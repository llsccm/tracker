import { describe, expect, it } from 'vitest'
import { POSITION_TOP } from '@/tracker/candidate/cardPositions'
import {
  expectCardIncludesSeatsAt,
  expectCardLocationCandidatesAt,
  expectCardSeatsAt,
  formatTrackerProtocolReplayReport,
  parseTrackerProtocolJsonl,
  TrackerProtocolReplayer,
  type RecordedTrackerProtocol
} from './helpers/protocolReplay'

describe('回放诊断：解析、指标、watch 与断言', () => {
  it('允许区间截取后的 JSONL 从非 1 的 seq 开始，但仍要求片段内连续', () => {
    const source = [
      JSON.stringify({ seq: 41, className: 'MsgGameRoundNtf', payload: { isPassed: false } }),
      JSON.stringify({ seq: 42, className: 'MsgGameOver', payload: {} })
    ].join('\n')

    expect(parseTrackerProtocolJsonl(source).map((record) => record.seq)).toEqual([41, 42])
    expect(() =>
      parseTrackerProtocolJsonl(
        [
          JSON.stringify({ seq: 41, className: 'MsgGameRoundNtf', payload: {} }),
          JSON.stringify({ seq: 43, className: 'MsgGameOver', payload: {} })
        ].join('\n')
      )
    ).toThrow('seq 应为 42')
  })

  it('报告阶段耗时与计数，无需打开调试器', () => {
    const report = new TrackerProtocolReplayer({ currentUserID: 101 }).replay(openingRecords())
    const { timings, counters } = report.diagnostics.metrics

    expect(counters.protocols).toBe(4)
    expect(counters.consistencyChecks).toBeGreaterThan(0)
    expect(counters.indexShadowRebuilds).toBeGreaterThan(0)
    expect(timings.apply).toBeGreaterThanOrEqual(0)
    expect(timings.wallClock).toBeGreaterThanOrEqual(0)
    expect(formatTrackerProtocolReplayReport(report)).toContain('耗时(ms)：')
  })

  it('fast 模式跳过影子索引重建并把降级写进 tainted 原因', () => {
    const deep = new TrackerProtocolReplayer({ currentUserID: 101, mode: 'deep' }).replay(
      drawRecords()
    )
    const fast = new TrackerProtocolReplayer({ currentUserID: 101, mode: 'fast' }).replay(
      drawRecords()
    )

    expect(fast.diagnostics.metrics.counters.indexShadowRebuilds).toBeLessThan(
      deep.diagnostics.metrics.counters.indexShadowRebuilds
    )
    expect(deep.diagnostics.tainted).toBe(false)
    expect(fast.diagnostics.tainted).toBe(true)
    expect(fast.diagnostics.taintReasons.join(' ')).toContain('影子索引检查')
    expect(JSON.stringify(fast.finalState)).toBe(JSON.stringify(deep.finalState))
  })

  it('开启 watch 只增加只读采集，不改变回放结果', () => {
    const plain = new TrackerProtocolReplayer({ currentUserID: 101 }).replay(drawRecords())
    const watched = new TrackerProtocolReplayer({
      currentUserID: 101,
      watchCardIDs: [1]
    }).replay(drawRecords())

    expect(JSON.stringify(watched.finalState)).toBe(JSON.stringify(plain.finalState))
    expect(plain.diagnostics.cardChanges).toEqual([])
    expect(watched.diagnostics.cardChanges.length).toBeGreaterThan(0)
    expect(watched.diagnostics.cardChanges.every((change) => change.cardID === 1)).toBe(true)
  })

  it('watch 记录候选增删与约束来源，且 seat watch 命中后持续跟踪', () => {
    const report = new TrackerProtocolReplayer({
      currentUserID: 101,
      watchSeatIDs: [1]
    }).replay(drawRecords())

    const change = report.diagnostics.cardChanges.find((item) => item.cardID === 1)
    expect(change).toBeDefined()
    expect(change?.next?.seats).toContain(1)
    expect(change?.reasons.length).toBeGreaterThan(0)
    expect(report.diagnostics.watchStats.watchedCards).toBeGreaterThan(0)
  })

  it('领域断言在 seq 与 final 两种时机都会被求值', () => {
    const passing = new TrackerProtocolReplayer({
      currentUserID: 101,
      assertions: [
        expectCardSeatsAt(5, 1, [1]),
        expectCardIncludesSeatsAt('final', 1, [1]),
        // 位置一旦收敛为确定值，locationCandidates 会被清空；断言必须描述这个语义而不是残留候选。
        expectCardLocationCandidatesAt('final', 1, [])
      ]
    }).replay(drawRecords())

    expect(passing.diagnostics.violations).toEqual([])
    expect(passing.success).toBe(true)
  })

  it('断言失败时停在首个违反的 seq 并输出因果闭包', () => {
    const report = new TrackerProtocolReplayer({
      currentUserID: 101,
      assertions: [expectCardSeatsAt(5, 1, [2])]
    }).replay(drawRecords())

    expect(report.success).toBe(false)
    expect(report.diagnostics.stoppedAtSeq).toBe(5)
    expect(report.diagnostics.violations[0]?.message).toContain('期望 seats=[2]')
    expect(report.diagnostics.causalClosure?.cardIDs).toEqual([1])
    expect(report.diagnostics.causalClosure?.protocols.map((item) => item.seq)).toContain(5)
    expect(formatTrackerProtocolReplayReport(report)).toContain('因果闭包')
  })

  it('定点断言对应的 seq 没有出现时视为违反，而不是静默通过', () => {
    const report = new TrackerProtocolReplayer({
      currentUserID: 101,
      assertions: [expectCardSeatsAt(999, 1, [1])]
    }).replay(drawRecords())

    expect(report.success).toBe(false)
    expect(report.diagnostics.violations[0]?.message).toContain('断言未被求值')
  })

  it('stopOn=never 时收集全部违反而不提前停止', () => {
    const report = new TrackerProtocolReplayer({
      currentUserID: 101,
      stopOn: 'never',
      assertions: [expectCardSeatsAt(5, 1, [2]), expectCardSeatsAt('final', 1, [3])]
    }).replay(drawRecords())

    expect(report.diagnostics.violations).toHaveLength(2)
    expect(report.diagnostics.stoppedAtSeq).toBe(5)
    expect(report.diagnostics.causalClosure).toBeNull()
  })

  it('未完整应用的协议归并为带原因的结构化记录', () => {
    const records = openingRecords().concat({
      seq: 5,
      className: 'PubGsCMoveCard',
      payload: movePayload({ CardIDs: [1], CardCount: 1, ToID: 1, isSend: 1 })
    })
    const report = new TrackerProtocolReplayer({ currentUserID: 101 }).replay(records)

    expect(report.nonApplied).toMatchObject([
      { status: 'ignored', className: 'PubGsCMoveCard', count: 1, seqs: [5] }
    ])
    expect(formatTrackerProtocolReplayReport(report)).toContain('未完整应用的协议：')
  })

  it('toSeq 截断不影响已回放范围的状态，只标记剩余未回放', () => {
    const records = openingRecords().concat({
      seq: 5,
      className: 'PubGsCMoveCard',
      payload: movePayload({ CardIDs: [1], CardCount: 1, ToID: 1 })
    })
    const truncated = new TrackerProtocolReplayer({ currentUserID: 101, toSeq: 4 }).replay(records)
    const sliced = new TrackerProtocolReplayer({ currentUserID: 101 }).replay(openingRecords())

    expect(JSON.stringify(truncated.finalState)).toBe(JSON.stringify(sliced.finalState))
    expect(truncated.diagnostics.stoppedAtSeq).toBe(4)
    expect(truncated.diagnostics.taintReasons.join(' ')).toContain('剩余 1 条协议未回放')
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
    { seq: 3, className: 'MsgGamePlayCardNtf', payload: { CardList: cardIDs } },
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
