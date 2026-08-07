import type { RecordedTrackerProtocol } from '@/tracker/runtime/protocolRecorder'

const RECORD_FIELDS = new Set(['seq', 'className', 'payload'])

export function parseTrackerProtocolJsonl(source: string): RecordedTrackerProtocol[] {
  if (typeof source !== 'string') throw new TypeError('协议回放输入必须是 JSONL 字符串')

  const records: RecordedTrackerProtocol[] = []
  const lines = source.replace(/^\uFEFF/, '').split(/\r?\n/)
  let expectedSeq = 1

  lines.forEach((line, index) => {
    if (line.trim() === '') return

    const lineNumber = index + 1
    const parsed = parseJsonLine(line, lineNumber)
    const record = validateRecord(parsed, lineNumber, expectedSeq)
    records.push(record)
    expectedSeq += 1
  })

  if (records.length === 0) throw new Error('协议回放文件为空')
  return records
}

function parseJsonLine(line: string, lineNumber: number): unknown {
  try {
    return JSON.parse(line)
  } catch (error) {
    throw new Error(`协议回放文件第 ${lineNumber} 行不是有效 JSON：${getErrorMessage(error)}`, {
      cause: error
    })
  }
}

function validateRecord(value: unknown, lineNumber: number, expectedSeq: number) {
  if (!isRecord(value)) throw new Error(`协议回放文件第 ${lineNumber} 行必须是 JSON 对象`)

  const extraFields = Object.keys(value).filter((field) => !RECORD_FIELDS.has(field))
  if (extraFields.length > 0) {
    throw new Error(
      `协议回放文件第 ${lineNumber} 行包含未支持字段：${extraFields.sort().join(', ')}`
    )
  }

  if (!Number.isInteger(value.seq) || Number(value.seq) <= 0) {
    throw new Error(`协议回放文件第 ${lineNumber} 行 seq 必须是正整数`)
  }

  if (Number(value.seq) !== expectedSeq) {
    throw new Error(
      `协议回放文件第 ${lineNumber} 行 seq 应为 ${expectedSeq}，实际为 ${String(value.seq)}`
    )
  }

  if (typeof value.className !== 'string' || value.className.trim() === '') {
    throw new Error(`协议回放文件第 ${lineNumber} 行 className 必须是非空字符串`)
  }

  if (!isRecord(value.payload)) {
    throw new Error(`协议回放文件第 ${lineNumber} 行 payload 必须是 JSON 对象`)
  }

  return {
    seq: Number(value.seq),
    className: value.className,
    payload: value.payload
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
