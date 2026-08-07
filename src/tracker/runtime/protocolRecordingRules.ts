export interface ProjectedTrackerProtocol {
  className: string
  payload: Record<string, unknown>
}

export interface TrackerProtocolRecordingContext {
  mySeatID?: number
  currentSeatID?: number
}

type ProtocolObject = Record<string, unknown>
type ProtocolPredicate = (
  message: ProtocolObject,
  context: TrackerProtocolRecordingContext
) => boolean

const ALWAYS_RECORDED_CLASSES = new Set([
  'MsgReconnectGame',
  'decodeGameRecordInitInfo',
  'decodeGsClientUserSeatFlagNtf',
  'GsCFirstPhaseRole',
  'MsgGamePlayCardNtf',
  'SmsgGameSetCharacter',
  'GsCGuoZhanSetCharacter',
  'MsgGameTurnNtf',
  'GsCGamephaseNtf',
  'MsgGameRoundNtf',
  'MsgGameOver',
  'ClientLeavetableRep'
])

// 对局结束只作为生命周期事件回放；结算明细既不参与记牌，也不参与推断。
const EMPTY_PAYLOAD_CLASSES = new Set(['ClientLeavetableRep', 'MsgGameOver', 'MsgReconnectGame'])

// Prettier 会压缩数字列表，但项目 ESLint 要求长数组逐项换行。
// prettier-ignore
const ROLE_OPT_TARGET_SPELL_IDS = new Set([
  4,
  5,
  357,
  361,
  372,
  501,
  774,
  811,
  851,
  898,
  921,
  943,
  987,
  988,
  2900,
  3119,
  3310,
  3437,
  3483,
  3876,
  3903,
  4025
])

const TRACKER_ROLE_DATA_EX_IDS = new Set([3544, 3571])
const TRACKER_USE_SPELL_IDS = new Set([3090, 3138, 3157, 3161, 3185, 3193, 3511, 3750])

const CONDITIONAL_RECORDING_RULES: Record<string, ProtocolPredicate> = {
  MsgNtfUseCardType: shouldRecordCounterUseCard,
  PubGsCUseCard: shouldRecordCounterUseCard,
  PubGsCUseSpell: shouldRecordUseSpell,
  PubGsCMoveCard: shouldRecordMoveCard,
  GsCUpdateRoleDataNtf: (message) => readNumberField(message, 'StateID') === 58,
  MsgGameShowFigure: (message) => readNumberField(message, 'Figure') === 1,
  GsCUpdateRoleDataExNtf: (message) =>
    TRACKER_ROLE_DATA_EX_IDS.has(readNumberField(message, 'DataID') ?? -1),
  GsCRoleOptTargetNtf: shouldRecordRoleOptTarget,
  CGsRoleSpellOptRep: shouldRecordRoleSpellOpt
}

const ROOT_IGNORED_FIELDS = new Set([
  'ByteData',
  'CardSpell',
  'ClassName',
  'Data',
  'DataCount',
  'FItem',
  'ProtoObj',
  'Spell',
  '_className_',
  'className',
  'data',
  'data_count',
  'errCode',
  'errMsg',
  'fromSocket2',
  'id',
  'isResume',
  'isSend',
  'msgQueuePriority',
  'pbMsgType',
  'printIgnorList',
  'printJsonIgnorList',
  'protoName',
  'receviedStatus',
  'sendStatus',
  'timestamp',
  'userID'
])

const ROOT_FIELD_EXCEPTIONS = new Map([
  ['MsgNtfUseCardType', new Set(['isSend'])],
  ['PubGsCUseCard', new Set(['isSend'])],
  ['PubGsCMoveCard', new Set(['isSend'])]
])

const ROOT_FIELD_ALLOWLISTS: Record<string, ReadonlySet<string>> = {
  GsCFirstPhaseRole: new Set(['SeatID']),
  GsCGamephaseNtf: new Set(['Round', 'SeatID']),
  GsCGuoZhanSetCharacter: new Set(['GeneralData', 'SeatID']),
  GsCUpdateRoleDataExNtf: new Set(['DataID', 'Datas', 'SeatID']),
  GsCUpdateRoleDataNtf: new Set(['SeatID', 'StateID']),
  MsgGamePlayCardNtf: new Set(['CardList']),
  MsgGameRoundNtf: new Set(['isPassed']),
  MsgGameShowFigure: new Set(['Figure', 'SeatID']),
  MsgGameTurnNtf: new Set(['TurnCnt']),
  MsgNtfUseCardType: new Set(['castSeatId', 'isSend', 'spellID', 'spellId', 'useType']),
  PubGsCMoveCard: new Set([
    'CardCount',
    'CardIDs',
    'FromID',
    'FromPosition',
    'FromZone',
    'FromZoneParam',
    'MoveType',
    'SpellID',
    'SrcSeatID',
    'ToID',
    'ToPosition',
    'ToZone',
    'ToZoneParam',
    'isSend'
  ]),
  PubGsCUseCard: new Set(['SeatID', 'isSend', 'spellID', 'useType']),
  PubGsCUseSpell: new Set([
    'CardIDs',
    'DestSeatIDs',
    'EffectIndex',
    'SeatID',
    'SpellID',
    'SrcSeatID'
  ]),
  SmsgGameSetCharacter: new Set(['Infos']),
  CGsRoleSpellOptRep: new Set(['Datas', 'SeatID', 'SpellID', 'Type']),
  GsCRoleOptTargetNtf: new Set([
    'Param',
    'Params',
    'SeatID',
    'SpellID',
    'SrcSeatID',
    'Type',
    'targetSeatID'
  ])
}

const NESTED_FIELD_ALLOWLISTS: Record<string, ReadonlySet<string>> = {
  'GsCGuoZhanSetCharacter.GeneralData': new Set(['cardID', 'index']),
  'SmsgGameSetCharacter.Infos': new Set(['CharacterID', 'SeatID'])
}

const NESTED_IGNORED_FIELDS = new Set(['timestamp'])
const TRACKER_SEAT_INFO_FIELDS = ['SeatID', 'seat_id', 'user_temp_id', 'ClientID']
const OMITTED = Symbol('omitted')
const MAX_PROTOCOL_DEPTH = 20

export function shouldRecordTrackerProtocol(
  message: unknown,
  context: TrackerProtocolRecordingContext = {}
): boolean {
  if (!isProtocolObject(message)) return false

  const className = getProtocolClassName(message)
  if (!className) return false

  const conditionalRule = CONDITIONAL_RECORDING_RULES[className]
  if (conditionalRule) return conditionalRule(message, context)

  return ALWAYS_RECORDED_CLASSES.has(className)
}

function shouldRecordCounterUseCard(
  message: ProtocolObject,
  context: TrackerProtocolRecordingContext
): boolean {
  const useType = readNumberField(message, 'useType')
  const spellID = readNumberField(message, 'spellID') ?? readNumberField(message, 'spellId') ?? 0
  if (useType !== 1 || Boolean(readProtocolField(message, 'isSend')) || spellID <= 0) return false

  if (context.mySeatID === undefined) return true
  const seatID =
    readNumberField(message, 'SeatID') ?? readNumberField(message, 'castSeatId') ?? undefined
  return seatID === context.mySeatID
}

function shouldRecordUseSpell(
  message: ProtocolObject,
  context: TrackerProtocolRecordingContext
): boolean {
  const spellID = readNumberField(message, 'SpellID') ?? -1
  if (!TRACKER_USE_SPELL_IDS.has(spellID)) return false

  switch (spellID) {
    case 3090:
      if (readNumberField(message, 'EffectIndex') !== 1) return false
      return (
        context.currentSeatID === undefined ||
        readNumberField(message, 'SeatID') === context.currentSeatID
      )

    case 3157:
    case 3511:
      return readArrayField(message, 'CardIDs').some((cardID) => Number(cardID) > 0)

    case 3750:
      return (
        readNumberField(message, 'EffectIndex') === 2 &&
        readArrayField(message, 'DestSeatIDs').length === 0
      )

    default:
      return true
  }
}

function shouldRecordMoveCard(message: ProtocolObject): boolean {
  return !(
    readNumberField(message, 'CardCount') === 0 ||
    readNumberField(message, 'MoveType') === 0 ||
    readNumberField(message, 'ToZone') === 11 ||
    Boolean(readProtocolField(message, 'isSend'))
  )
}

function shouldRecordRoleSpellOpt(message: ProtocolObject): boolean {
  const datas = readArrayField(message, 'Datas')
  if (datas.length === 0) return false

  const type = readNumberField(message, 'Type')
  if (type === 72) return true

  switch (readNumberField(message, 'SpellID')) {
    case 2022:
    case 3659:
      return true
    case 3744:
      return type !== 73
    case 3336:
    case 3868:
      return type === 50
    case 7009:
      return type === 30
    default:
      return false
  }
}

function shouldRecordRoleOptTarget(message: ProtocolObject): boolean {
  const spellID = readNumberField(message, 'SpellID') ?? -1
  if (!ROLE_OPT_TARGET_SPELL_IDS.has(spellID)) return false

  const params = readArrayField(message, 'Params')
  const param = readNumberField(message, 'Param')
  const type = readNumberField(message, 'Type')
  const targetSeatID = readNumberField(message, 'targetSeatID')
  const srcSeatID = readNumberField(message, 'SrcSeatID')

  switch (spellID) {
    case 4:
    case 5:
    case 357:
    case 372:
    case 501:
    case 811:
    case 921:
    case 3119:
    case 3437:
    case 3876:
    case 4025:
      return targetSeatID !== undefined && targetSeatID !== 255 && params.length > 0

    case 361:
    case 774:
    case 851:
    case 3310:
      return targetSeatID !== undefined && targetSeatID !== 255 && param === 0 && params.length > 0

    case 943:
      return param === 0 && params.length === 1

    case 898:
      return srcSeatID !== undefined && srcSeatID !== 255 && param === 0 && params.length > 2

    case 987:
    case 988:
      return targetSeatID !== undefined && param === 1 && params.length > 2

    case 2900:
      return targetSeatID !== undefined && type === 28 && params.length >= 3

    case 3483:
      return targetSeatID !== undefined && param === 1 && params.length > 0

    case 3903:
      return (
        targetSeatID === 255 &&
        param === 0 &&
        ((type === 28 && params.length > 2) || (type === 29 && params.length === 4))
      )

    default:
      return false
  }
}

function readArrayField(message: ProtocolObject, key: string): unknown[] {
  const value = readProtocolField(message, key)
  return Array.isArray(value) ? value : []
}

export function projectTrackerProtocol(message: unknown): ProjectedTrackerProtocol | null {
  if (!isProtocolObject(message)) return null

  const className = getProtocolClassName(message)
  if (!className) return null

  if (EMPTY_PAYLOAD_CLASSES.has(className)) {
    return { className, payload: {} }
  }

  const payload = collectRootPayload(message, className)
  appendRequiredNestedPayload(message, className, payload)

  return { className, payload }
}

export function getProtocolClassName(message: ProtocolObject): string | null {
  const className = readProtocolField(message, 'className')
  if (typeof className === 'string' && className) return className

  const fallbackClassName = readProtocolField(message, 'ClassName')
  return typeof fallbackClassName === 'string' && fallbackClassName ? fallbackClassName : null
}

function collectRootPayload(message: ProtocolObject, className: string): Record<string, unknown> {
  const payload: Record<string, unknown> = {}
  const exceptions = ROOT_FIELD_EXCEPTIONS.get(className)
  const allowedFields = ROOT_FIELD_ALLOWLISTS[className]

  for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(message))) {
    if (!descriptor.enumerable || !('value' in descriptor)) continue
    if (allowedFields && !allowedFields.has(key)) continue
    if (ROOT_IGNORED_FIELDS.has(key) && !exceptions?.has(key)) continue

    const value = cloneProtocolValue(descriptor.value)
    if (value !== OMITTED) payload[key] = value
  }

  applyNestedFieldProjections(className, payload)
  return payload
}

function applyNestedFieldProjections(className: string, payload: Record<string, unknown>): void {
  for (const [fieldPath, allowedFields] of Object.entries(NESTED_FIELD_ALLOWLISTS)) {
    const [targetClassName, fieldName] = fieldPath.split('.')
    if (targetClassName !== className) continue

    const values = payload[fieldName]
    if (!Array.isArray(values)) continue
    payload[fieldName] = values.map((value) => projectNestedRecord(value, allowedFields))
  }
}

function projectNestedRecord(value: unknown, allowedFields: ReadonlySet<string>): unknown {
  if (!isProtocolObject(value)) return value

  const projected: Record<string, unknown> = {}
  for (const field of allowedFields) {
    if (Object.prototype.hasOwnProperty.call(value, field)) projected[field] = value[field]
  }
  return projected
}

function appendRequiredNestedPayload(
  message: ProtocolObject,
  className: string,
  payload: Record<string, unknown>
): void {
  if (className === 'decodeGameRecordInitInfo') appendRecordInitPayload(message, payload)
  if (className === 'decodeGsClientUserSeatFlagNtf') appendSeatInfoPayload(message, payload)
}

function appendRecordInitPayload(message: ProtocolObject, payload: Record<string, unknown>): void {
  const protoObj = readProtocolField(message, 'ProtoObj')
  if (!isProtocolObject(protoObj)) return

  const matchName = cloneProtocolValue(readProtocolField(protoObj, 'matchName'))
  if (matchName === OMITTED) return

  payload.ProtoObj = { matchName }
}

function appendSeatInfoPayload(message: ProtocolObject, payload: Record<string, unknown>): void {
  const data = readProtocolField(message, 'data')
  if (!isProtocolObject(data)) return

  const protoObj = readProtocolField(data, 'protoObj')
  if (!isProtocolObject(protoObj)) return

  const seatinfo = readProtocolField(protoObj, 'seatinfo')
  if (!Array.isArray(seatinfo)) return

  payload.data = { protoObj: { seatinfo: seatinfo.map(projectSeatInfo) } }
}

function projectSeatInfo(value: unknown): Record<string, unknown> {
  if (!isProtocolObject(value)) return {}

  const result: Record<string, unknown> = {}
  TRACKER_SEAT_INFO_FIELDS.forEach((key) => {
    const fieldValue = cloneProtocolValue(readProtocolField(value, key))
    if (fieldValue !== OMITTED) result[key] = fieldValue
  })
  return result
}

function readNumberField(message: ProtocolObject, key: string): number | undefined {
  const value = Number(readProtocolField(message, key))
  return Number.isFinite(value) ? value : undefined
}

function readProtocolField(message: ProtocolObject, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(message, key)
  if (descriptor && 'value' in descriptor) return descriptor.value

  try {
    return message[key]
  } catch {
    return undefined
  }
}

function cloneProtocolValue(
  value: unknown,
  seen = new WeakSet<object>(),
  depth = 0
): unknown | typeof OMITTED {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') return Number.isFinite(value) ? value : OMITTED
  if (typeof value === 'bigint') return value.toString()
  if (typeof value !== 'object') return OMITTED
  if (depth >= MAX_PROTOCOL_DEPTH || value instanceof Date) return OMITTED
  if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) return OMITTED
  if (seen.has(value)) return OMITTED

  seen.add(value)

  if (Array.isArray(value)) {
    const result = value.map((item) => {
      const clonedItem = cloneProtocolValue(item, seen, depth + 1)
      return clonedItem === OMITTED ? null : clonedItem
    })
    seen.delete(value)
    return result
  }

  const result: Record<string, unknown> = {}
  for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
    if (!descriptor.enumerable || !('value' in descriptor)) continue
    if (NESTED_IGNORED_FIELDS.has(key)) continue

    const clonedValue = cloneProtocolValue(descriptor.value, seen, depth + 1)
    if (clonedValue !== OMITTED) result[key] = clonedValue
  }

  seen.delete(value)
  return result
}

function isProtocolObject(value: unknown): value is ProtocolObject {
  return value !== null && typeof value === 'object'
}
