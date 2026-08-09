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

interface RecordingSession {
  id: string
  startedAt: number
}

interface StoredTrackerProtocol extends RecordedTrackerProtocol {
  sessionId: string
  sessionStartedAt: number
}

interface StoredProtocolRecording {
  session: RecordingSession
  records: RecordedTrackerProtocol[]
}

type StatusListener = (status: ProtocolRecordingStatus) => void

const DATABASE_NAME = 'dxc-tracker-protocol-recording'
const DATABASE_VERSION = 2
const RECORD_STORE_NAME = 'records'
const DOWNLOAD_FILE_NAME = 'tracker-protocols.jsonl'
export const MAX_PROTOCOL_RECORDS = 10_000

let active = false
let sequence = 0
let limitReached = false
let currentSession: RecordingSession | null | undefined
let lastSessionStartedAt = 0
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
  currentSession = createRecordingSession()
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
  currentSession = null
  records = []
  pendingRecords = []
  flushScheduled = false
  const clearOperation = enqueueStorage(clearStoredRecords)
  notifyStatusListeners()
  await clearOperation
  return getProtocolRecordingStatus()
}

export async function initializeProtocolRecording(): Promise<ProtocolRecordingStatus> {
  if (currentSession === null) return getProtocolRecordingStatus()

  const expectedGeneration = loadGeneration
  await storageQueue
  const storedRecording = await readStoredRecordingSafely(currentSession?.id)

  if (expectedGeneration !== loadGeneration || active || records.length > 0) {
    return getProtocolRecordingStatus()
  }
  if (storedRecording === undefined) return getProtocolRecordingStatus()
  if (storedRecording === null) {
    if (currentSession === undefined) currentSession = null
    return getProtocolRecordingStatus()
  }

  currentSession = storedRecording.session
  lastSessionStartedAt = Math.max(lastSessionStartedAt, currentSession.startedAt)
  records = storedRecording.records.slice(0, MAX_PROTOCOL_RECORDS)
  sequence = records[records.length - 1]?.seq ?? 0
  limitReached = storedRecording.records.length >= MAX_PROTOCOL_RECORDS
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

  let exportRecords = records
  if (exportRecords.length === 0 && currentSession !== null) {
    const storedRecording = await readStoredRecordingSafely(currentSession?.id)
    if (storedRecording && currentSession === undefined) {
      currentSession = storedRecording.session
      lastSessionStartedAt = Math.max(lastSessionStartedAt, currentSession.startedAt)
    }
    exportRecords = storedRecording?.records ?? []
  }
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
  const session = currentSession
  if (!session) return
  enqueueStorage(() => putStoredRecords(session, batch))
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

async function putStoredRecords(
  session: RecordingSession,
  batch: RecordedTrackerProtocol[]
): Promise<void> {
  const database = await openDatabase()
  if (!database || batch.length === 0) return

  const transaction = database.transaction(RECORD_STORE_NAME, 'readwrite')
  const store = transaction.objectStore(RECORD_STORE_NAME)
  batch.forEach((record) => {
    const storedRecord: StoredTrackerProtocol = {
      ...record,
      sessionId: session.id,
      sessionStartedAt: session.startedAt
    }
    store.put(storedRecord)
  })
  await waitForTransaction(transaction)
}

async function clearStoredRecords(): Promise<void> {
  const database = await openDatabase()
  if (!database) return

  const transaction = database.transaction(RECORD_STORE_NAME, 'readwrite')
  transaction.objectStore(RECORD_STORE_NAME).clear()
  await waitForTransaction(transaction)
}

async function readStoredRecording(sessionId?: string): Promise<StoredProtocolRecording | null> {
  const database = await openDatabase()
  if (!database) return null

  return new Promise((resolve, reject) => {
    const transaction = database.transaction(RECORD_STORE_NAME, 'readonly')
    const request = transaction.objectStore(RECORD_STORE_NAME).getAll()
    request.onsuccess = () => {
      const storedRecords = (request.result as unknown[]).filter(isStoredTrackerProtocol)
      const selectedSessionId = sessionId ?? findLatestSessionId(storedRecords)
      if (!selectedSessionId) {
        resolve(null)
        return
      }

      const sessionRecords = storedRecords
        .filter((record) => record.sessionId === selectedSessionId)
        .sort((left, right) => left.seq - right.seq)
      const firstRecord = sessionRecords[0]
      if (!firstRecord) {
        resolve(null)
        return
      }

      resolve({
        session: {
          id: firstRecord.sessionId,
          startedAt: firstRecord.sessionStartedAt
        },
        records: sessionRecords.slice(0, MAX_PROTOCOL_RECORDS).map(toRecordedTrackerProtocol)
      })
    }
    request.onerror = () => reject(request.error)
  })
}

async function readStoredRecordingSafely(
  sessionId?: string
): Promise<StoredProtocolRecording | null | undefined> {
  try {
    return await readStoredRecording(sessionId)
  } catch (error) {
    console.warn('[protocol-recorder] IndexedDB 读取失败', error)
    return undefined
  }
}

function createRecordingSession(): RecordingSession {
  const startedAt = Math.max(Date.now(), lastSessionStartedAt + 1)
  lastSessionStartedAt = startedAt
  const suffix =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2)
  return { id: `${startedAt}-${suffix}`, startedAt }
}

function findLatestSessionId(records: StoredTrackerProtocol[]): string | null {
  const latest = records.reduce<StoredTrackerProtocol | null>((current, record) => {
    if (!current || record.sessionStartedAt > current.sessionStartedAt) return record
    if (
      record.sessionStartedAt === current.sessionStartedAt &&
      record.sessionId > current.sessionId
    ) {
      return record
    }
    return current
  }, null)
  return latest?.sessionId ?? null
}

function isStoredTrackerProtocol(value: unknown): value is StoredTrackerProtocol {
  if (!value || typeof value !== 'object') return false
  const record = value as Partial<StoredTrackerProtocol>
  return (
    typeof record.sessionId === 'string' &&
    Number.isFinite(record.sessionStartedAt) &&
    Number.isInteger(record.seq) &&
    typeof record.className === 'string' &&
    Boolean(record.payload) &&
    typeof record.payload === 'object' &&
    !Array.isArray(record.payload)
  )
}

function toRecordedTrackerProtocol(record: StoredTrackerProtocol): RecordedTrackerProtocol {
  return {
    seq: record.seq,
    className: record.className,
    payload: record.payload
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
    if (database.objectStoreNames.contains(RECORD_STORE_NAME)) {
      database.deleteObjectStore(RECORD_STORE_NAME)
    }
    database.createObjectStore(RECORD_STORE_NAME, { keyPath: ['sessionId', 'seq'] })
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
