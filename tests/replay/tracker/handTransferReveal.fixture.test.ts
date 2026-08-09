import { describe, expect, it } from 'vitest'
// 用 Vite 的 `?raw` 读取 fixture，避免在被 tsconfig.replay.json 类型检查的测试里引入 node 内置模块。
import fixtureSource from './fixtures/hand-transfer-reveal-retransfer.jsonl?raw'
import {
  expectCardSeatsAt,
  formatTrackerProtocolReplayReport,
  parseTrackerProtocolJsonl,
  TrackerProtocolReplayer
} from './helpers/protocolReplay'

/**
 * 真实脱敏回放：整手随机转移 → 中途明牌揭示 → 再次整手随机转移。
 *
 * 该组合路径曾经让旧约束组在收敛时误删卡牌 10 的 7 号位候选，
 * 单测没有覆盖完整事件序列，所以这里用最小真实录制 + 领域断言守住。
 */
const WATCHED_CARDS = [10, 129]
const EXPECTED_SEATS = [2, 7]

describe('真实录制回放：连续整手转移 + 中途揭示', () => {
  it('两张候选牌在再次转移后同时保留 2、7 号位候选', () => {
    const report = new TrackerProtocolReplayer({
      mode: 'watch',
      watchCardIDs: WATCHED_CARDS,
      assertions: WATCHED_CARDS.map((cardID) => expectCardSeatsAt('final', cardID, EXPECTED_SEATS))
    }).replay(readFixture())

    if (!report.success) throw new Error(formatTrackerProtocolReplayReport(report))
    expect(report.diagnostics.violations).toEqual([])
    expect(report.diagnostics.stoppedAtSeq).toBe(111)
  })

  it('watch 报告只输出相关卡牌的因果链而不展开整局牌池', () => {
    const report = new TrackerProtocolReplayer({
      mode: 'watch',
      watchCardIDs: WATCHED_CARDS
    }).replay(readFixture())

    expect(report.success).toBe(true)
    const output = formatTrackerProtocolReplayReport(report, { includeFinalState: false })
    expect(output).toContain('card=10')
    expect(output.length).toBeLessThan(32 * 1024)
    expect(
      report.diagnostics.cardChanges.every((change) => WATCHED_CARDS.includes(change.cardID))
    ).toBe(true)
  })

  it('断言违反时停在首个错误 seq 并给出因果闭包', () => {
    const report = new TrackerProtocolReplayer({
      mode: 'watch',
      // 故意断言一个错误的期望，验证断言真的会失败而不是“没抛异常就算过”。
      assertions: [expectCardSeatsAt('final', 10, [2])]
    }).replay(readFixture())

    expect(report.success).toBe(false)
    expect(report.diagnostics.violations).toHaveLength(1)
    const closure = report.diagnostics.causalClosure
    expect(closure?.cardIDs).toEqual([10])
    expect(closure?.changes.length).toBeGreaterThan(0)
    expect(closure?.protocols.length).toBeGreaterThan(0)
  })

  it('fast / watch / deep 三档的最终状态一致', () => {
    const finals = (['fast', 'watch', 'deep'] as const).map((mode) => {
      const report = new TrackerProtocolReplayer({ mode }).replay(readFixture())
      expect(report.success).toBe(true)
      return JSON.stringify(report.finalState)
    })
    expect(finals[1]).toBe(finals[0])
    expect(finals[2]).toBe(finals[0])
  })

  it('toSeq 截断后的状态与同范围完整回放一致，并标记为不完整', () => {
    const records = readFixture()
    const truncated = new TrackerProtocolReplayer({ mode: 'fast', toSeq: 60 }).replay(records)
    const sliced = new TrackerProtocolReplayer({ mode: 'fast' }).replay(
      records.filter((record) => record.seq <= 60)
    )

    expect(JSON.stringify(truncated.finalState)).toBe(JSON.stringify(sliced.finalState))
    expect(truncated.diagnostics.tainted).toBe(true)
    expect(truncated.diagnostics.taintReasons.some((reason) => reason.includes('toSeq=60'))).toBe(
      true
    )
  })
})

function readFixture() {
  return parseTrackerProtocolJsonl(fixtureSource)
}
