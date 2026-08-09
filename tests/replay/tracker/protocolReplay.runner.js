import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { env, stdout } from 'node:process'
import { describe, it } from 'vitest'
import {
  formatTrackerProtocolReplayReport,
  parseTrackerProtocolJsonl,
  TrackerProtocolReplayer
} from './helpers/protocolReplay'

const MODES = new Set(['fast', 'watch', 'deep'])

describe('tracker protocol replay runner', () => {
  it('从 JSONL 重建记牌器状态', async () => {
    const absolutePath = resolve(env.DXC_TRACKER_PROTOCOL_FILE ?? 'replays/tracker-protocols.jsonl')
    const source = await readReplayFile(absolutePath)
    // TRACE 是历史入口，映射为显式的 deep + 完整快照，不再作为推荐的日常诊断方式。
    const trace = env.DXC_TRACKER_REPLAY_TRACE === '1'
    const replayer = new TrackerProtocolReplayer({
      currentUserID: readOptionalInteger('DXC_TRACKER_CURRENT_USER_ID'),
      mode: trace ? 'deep' : readMode(),
      toSeq: readOptionalInteger('DXC_TRACKER_REPLAY_TO_SEQ'),
      watchCardIDs: readOptionalIntegerList('DXC_TRACKER_REPLAY_WATCH_CARDS'),
      watchSeatIDs: readOptionalIntegerList('DXC_TRACKER_REPLAY_WATCH_SEATS'),
      captureFullSnapshots: trace
    })
    const records = replayer.metrics.time('parse', () => parseTrackerProtocolJsonl(source))
    const report = replayer.replay(records)
    const formatted = formatTrackerProtocolReplayReport(report)

    stdout.write(`${formatted}\n`)
    if (!report.success) throw new Error(formatFailureSummary(report))
  })
})

function formatFailureSummary(report) {
  if (report.failure) {
    const { seq, className, message } = report.failure
    return `记牌器协议回放失败：seq=${seq} className=${className} 原因=${message}`
  }
  const violation = report.diagnostics.violations[0]
  if (violation) {
    return `记牌器协议回放语义断言失败：seq=${violation.seq} ${violation.label} ${violation.message}`
  }
  return '记牌器协议回放失败'
}

async function readReplayFile(filePath) {
  try {
    return await readFile(filePath, 'utf8')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`无法读取协议回放文件 ${filePath}：${message}`, { cause: error })
  }
}

function readMode() {
  const value = env.DXC_TRACKER_REPLAY_MODE
  if (value === undefined || value.trim() === '') return 'watch'
  if (!MODES.has(value)) {
    throw new Error(`DXC_TRACKER_REPLAY_MODE 必须是 ${Array.from(MODES).join(' / ')} 之一`)
  }
  return value
}

function readOptionalInteger(name) {
  const value = env[name]
  if (value === undefined || value.trim() === '') return undefined

  const parsed = Number(value)
  if (!Number.isInteger(parsed)) throw new Error(`${name} 必须是整数`)
  return parsed
}

function readOptionalIntegerList(name) {
  const value = env[name]
  if (value === undefined || value.trim() === '') return undefined

  return value.split(',').map((item) => {
    const parsed = Number(item.trim())
    if (!Number.isInteger(parsed)) throw new Error(`${name} 必须是逗号分隔的整数列表`)
    return parsed
  })
}
