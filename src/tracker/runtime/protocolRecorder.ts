import {
  projectTrackerProtocol,
  shouldRecordTrackerProtocol,
  type TrackerProtocolRecordingContext
} from './protocolRecordingRules'

export interface RecordedTrackerProtocol {
  seq: number
  className: string
  payload: Record<string, unknown>
}

export interface ProtocolRecordingStatus {
  active: boolean
  count: number
  limitReached: boolean
}

type StatusListener = (status: ProtocolRecordingStatus) => void

const DATABASE_NAME = 'dxc-tracker-protocol-recording'
const DATABASE_VERSION = 1
const RECORD_STORE_NAME = 'records'
const DOWNLOAD_FILE_NAME = 'tracker-protocols.jsonl'
export const MAX_PROTOCOL_RECORDS = 10_000

let active = false
let sequence = 0
let limitReached = false
let records: RecordedTrackerProtocol[] = []
let pendingRecords: RecordedTrackerProtocol[] = []
let flushScheduled = false
let loadGeneration = 0
let databasePromise: Promise<IDBDatabase | null> | null = null
let storageQueue = Promise.resolve()
let statusNotificationScheduled = false

const statusListeners = new Set<StatusListener>()

export function startProtocolRecording(): ProtocolRecordingStatus {
  loadGeneration++
  active = true
  sequence = 0
  limitReached = false
  records = []
  pendingRecords = []
  flushScheduled = false
  enqueueStorage(clearStoredRecords)
  notifyStatusListeners()
  return getProtocolRecordingStatus()
}

export async function stopProtocolRecording(): Promise<ProtocolRecordingStatus> {
  active = false
  flushPendingRecords()
  notifyStatusListeners()
  await storageQueue
  return getProtocolRecordingStatus()
}

export async function clearProtocolRecording(): Promise<ProtocolRecordingStatus> {
  loadGeneration++
  active = false
  sequence = 0
  limitReached = false
  records = []
  pendingRecords = []
  flushScheduled = false
  const clearOperation = enqueueStorage(clearStoredRecords)
  notifyStatusListeners()
  await clearOperation
  return getProtocolRecordingStatus()
}

export async function initializeProtocolRecording(): Promise<ProtocolRecordingStatus> {
  const expectedGeneration = loadGeneration
  await storageQueue
  const storedRecords = await readStoredRecordsSafely()

  if (expectedGeneration !== loadGeneration || active || records.length > 0) {
    return getProtocolRecordingStatus()
  }

  records = storedRecords.slice(0, MAX_PROTOCOL_RECORDS)
  sequence = records[records.length - 1]?.seq ?? 0
  limitReached = storedRecords.length >= MAX_PROTOCOL_RECORDS
  notifyStatusListeners()
  return getProtocolRecordingStatus()
}

export function recordTrackerProtocol(
  message: unknown,
  context: TrackerProtocolRecordingContext = {}
): void {
  if (!active || !shouldRecordTrackerProtocol(message, context)) return

  try {
    const projected = projectTrackerProtocol(message)
    if (!projected) return

    const record: RecordedTrackerProtocol = {
      seq: ++sequence,
      ...projected
    }

    records.push(record)
    pendingRecords.push(record)
    if (records.length >= MAX_PROTOCOL_RECORDS) {
      active = false
      limitReached = true
      flushPendingRecords()
    } else {
      schedulePendingRecordFlush()
    }
    notifyStatusListeners()
  } catch (error) {
    console.warn('[protocol-recorder] 协议录制失败，已跳过当前消息', error)
  }
}

export async function exportProtocolRecording(): Promise<boolean> {
  flushPendingRecords()
  await storageQueue

  const exportRecords = records.length > 0 ? records : await readStoredRecordsSafely()
  if (exportRecords.length === 0) return false

  const content = serializeProtocolRecording(exportRecords)
  downloadRecording(content)
  return true
}

export function serializeProtocolRecording(recording: RecordedTrackerProtocol[]): string {
  if (recording.length === 0) return ''
  return recording.map((record) => JSON.stringify(record)).join('\n') + '\n'
}

export function getProtocolRecordingStatus(): ProtocolRecordingStatus {
  return { active, count: records.length, limitReached }
}

export function getProtocolRecordingSnapshot(): RecordedTrackerProtocol[] {
  return [...records]
}

export function subscribeProtocolRecordingStatus(listener: StatusListener): () => void {
  statusListeners.add(listener)
  listener(getProtocolRecordingStatus())
  return () => statusListeners.delete(listener)
}

function schedulePendingRecordFlush(): void {
  if (flushScheduled) return
  flushScheduled = true
  queueMicrotask(flushPendingRecords)
}

function flushPendingRecords(): void {
  flushScheduled = false
  if (pendingRecords.length === 0) return

  const batch = pendingRecords
  pendingRecords = []
  enqueueStorage(() => putStoredRecords(batch))
}

function notifyStatusListeners(): void {
  if (statusNotificationScheduled) return
  statusNotificationScheduled = true

  queueMicrotask(() => {
    statusNotificationScheduled = false
    const status = getProtocolRecordingStatus()
    statusListeners.forEach((listener) => listener(status))
  })
}

function enqueueStorage(operation: () => Promise<void>): Promise<void> {
  storageQueue = storageQueue.then(operation).catch((error) => {
    console.warn('[protocol-recorder] IndexedDB 写入失败，当前录制仍保留在内存中', error)
  })
  return storageQueue
}

async function putStoredRecords(batch: RecordedTrackerProtocol[]): Promise<void> {
  const database = await openDatabase()
  if (!database || batch.length === 0) return

  const transaction = database.transaction(RECORD_STORE_NAME, 'readwrite')
  const store = transaction.objectStore(RECORD_STORE_NAME)
  batch.forEach((record) => store.put(record))
  await waitForTransaction(transaction)
}

async function clearStoredRecords(): Promise<void> {
  const database = await openDatabase()
  if (!database) return

  const transaction = database.transaction(RECORD_STORE_NAME, 'readwrite')
  transaction.objectStore(RECORD_STORE_NAME).clear()
  await waitForTransaction(transaction)
}

async function readStoredRecords(): Promise<RecordedTrackerProtocol[]> {
  const database = await openDatabase()
  if (!database) return []

  return new Promise((resolve, reject) => {
    const transaction = database.transaction(RECORD_STORE_NAME, 'readonly')
    const request = transaction.objectStore(RECORD_STORE_NAME).getAll()
    request.onsuccess = () => {
      const storedRecords = request.result as RecordedTrackerProtocol[]
      resolve(
        storedRecords.sort((left, right) => left.seq - right.seq).slice(0, MAX_PROTOCOL_RECORDS)
      )
    }
    request.onerror = () => reject(request.error)
  })
}

async function readStoredRecordsSafely(): Promise<RecordedTrackerProtocol[]> {
  try {
    return await readStoredRecords()
  } catch (error) {
    console.warn('[protocol-recorder] IndexedDB 读取失败', error)
    return []
  }
}

function openDatabase(): Promise<IDBDatabase | null> {
  if (databasePromise) return databasePromise
  if (typeof indexedDB === 'undefined') return Promise.resolve(null)

  let resolveDatabase: (database: IDBDatabase | null) => void = () => undefined
  const openPromise = new Promise<IDBDatabase | null>((resolve) => {
    resolveDatabase = resolve
  })
  databasePromise = openPromise

  let request: IDBOpenDBRequest
  try {
    request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION)
  } catch {
    databasePromise = null
    resolveDatabase(null)
    return openPromise
  }

  let settled = false
  const resolveFailure = () => {
    if (settled) return
    settled = true
    if (databasePromise === openPromise) databasePromise = null
    resolveDatabase(null)
  }

  request.onupgradeneeded = () => {
    const database = request.result
    if (!database.objectStoreNames.contains(RECORD_STORE_NAME)) {
      database.createObjectStore(RECORD_STORE_NAME, { keyPath: 'seq' })
    }
  }

  request.onsuccess = () => {
    if (settled) {
      request.result.close()
      return
    }
    settled = true
    resolveDatabase(request.result)
  }
  request.onerror = resolveFailure
  request.onblocked = resolveFailure

  return openPromise
}

function waitForTransaction(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error)
    transaction.onabort = () => reject(transaction.error)
  })
}

function downloadRecording(content: string): void {
  if (typeof document === 'undefined' || typeof URL === 'undefined') return

  const blob = new Blob([content], { type: 'application/x-ndjson;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = DOWNLOAD_FILE_NAME
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}
