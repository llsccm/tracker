import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { env, stdout } from 'node:process'
import { describe, it } from 'vitest'
import {
  formatTrackerProtocolReplayReport,
  parseTrackerProtocolJsonl,
  TrackerProtocolReplayer
} from './helpers/protocolReplay'

describe('tracker protocol replay runner', () => {
  it('从 JSONL 重建记牌器状态', async () => {
    const absolutePath = resolve(env.DXC_TRACKER_PROTOCOL_FILE ?? 'replays/tracker-protocols.jsonl')
    const source = await readReplayFile(absolutePath)
    const currentUserID = readOptionalInteger('DXC_TRACKER_CURRENT_USER_ID')
    const replayer = new TrackerProtocolReplayer({
      currentUserID,
      captureStepStates: env.DXC_TRACKER_REPLAY_TRACE === '1'
    })
    const report = replayer.replay(parseTrackerProtocolJsonl(source))
    const formatted = formatTrackerProtocolReplayReport(report)

    stdout.write(`${formatted}\n`)
    if (!report.success) throw new Error(formatFailureSummary(report.failure))
  })
})

function formatFailureSummary(failure) {
  if (!failure) return '记牌器协议回放失败'
  return `记牌器协议回放失败：seq=${failure.seq} className=${failure.className} 原因=${failure.message}`
}

async function readReplayFile(filePath) {
  try {
    return await readFile(filePath, 'utf8')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`无法读取协议回放文件 ${filePath}：${message}`, { cause: error })
  }
}

function readOptionalInteger(name) {
  const value = env[name]
  if (value === undefined || value.trim() === '') return undefined

  const parsed = Number(value)
  if (!Number.isInteger(parsed)) throw new Error(`${name} 必须是整数`)
  return parsed
}
