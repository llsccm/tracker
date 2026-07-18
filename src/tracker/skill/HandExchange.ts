/**
 * 整手牌经交换区互易装饰器。
 *
 * 协议模式（不绑定单一 SpellID；技能 121 是完整实战样例）：
 * 1. MoveType=11
 * 2. 手牌 -> 交换区：5 -> 10，FromID=原持有座位
 * 3. 交换区 -> 手牌：10 -> 5，FromID=原持有者批次键，ToID=目标座位
 *
 * 默认移动路径无法处理的问题：
 * - 交换区可能同时暂存双方批次，按 zone 顶/底取牌会串批
 * - 整手常混有明牌与暗实体；正 CardIDs 与空 CardIDs 都可能出现
 * - FromZone=10 时 FromID 不能当座位解释，只能当批次键
 *
 * 详细协议说明见：
 * docs/protocols/PubGsCMoveCard-spell-121-hand-exchange.md
 */
import { MOVE_TYPE } from '../MoveEventNormalizer'
import type { Card } from '../Card'
import type { Room } from '../Room'
import type { LocationCandidate, SeatID, SpellID, SubZone } from '../types'
import { recordTraversal } from '../traversalStats'

/** 兼容旧导出名；整手交换已不再绑定单一技能 ID。 */
export const HAND_EXCHANGE_SPELL_ID = 121

/**
 * 房间级 skillState key。
 * value 形态：{ bySpell: { [spellID]: { batches: { [fromSeat]: batch[] } } } }
 * 按 SpellID 隔离，避免两个交换技能并发时串批。
 */
export const HAND_EXCHANGE_STATE_KEY = 'handExchangeBatches'

type MoveEventDraft = any

/** 某座位进交换区时登记的一整批手牌实体。 */
type HandExchangeBatch = {
  /** 唯一批次令牌；候选位置在进出交换区时通过该令牌完成可逆置换。 */
  batchID: string
  /** 进区时快照的实体列表；回手时只取仍在 exchange 的成员。 */
  cards: Card[]
  /** 协议整手数；用于保留 cardCount，避免明暗拆分后张数丢失。 */
  cardCount: number
  /** 是否有候选位置由逻辑账本迁移；此时实体数与协议手牌变化量需要解耦。 */
  hasCandidateAlternatives: boolean
  /** 原持有座位；也是 batches 字典的 key。 */
  fromSeat: SeatID
  spellID: number
}

/**
 * 候选位置进入交换区后的逻辑替身。
 *
 * 它不会作为真实 Card 加入 exchange Zone，只用于区分同一座位的外层、内层批次。
 */
type HandExchangeBatchAlternative = {
  type: 'handExchangeBatch'
  batchID: string
}

/** 候选牌在交换期间可以同时指向普通完整位置或尚未返回的交换批次。 */
type HandExchangeCandidateAlternative = LocationCandidate | HandExchangeBatchAlternative

/**
 * 单张候选牌的交换期快照。
 *
 * alternatives 是推理主状态；Card.locationCandidates 只是当前可投影到通用位置模型的兼容读面。
 */
type HandExchangeCandidateRecord = {
  card: Card
  alternatives: HandExchangeCandidateAlternative[]
  /** 进入候选账本前的兼容字段，最终恢复玩家位置时一并还原。 */
  spellID: SpellID | null
  subZone: SubZone | null
}

/** 单个 SpellID 下尚未取回的进区批次；同座位按嵌套顺序使用栈。 */
type HandExchangeSpellState = {
  /** 同一座位可能在外层交换尚未回手时再次参与内层交换，因此不能只保存单个批次。 */
  batches: Record<string, HandExchangeBatch[]>
}

/** 房间内所有交换技能的批次账本。 */
type HandExchangeRoomState = {
  bySpell: Record<string, HandExchangeSpellState>
  /** 候选记录跨 SpellID 共享，使不同技能嵌套时仍能逐批置换候选位置。 */
  candidateRecords: Map<Card, HandExchangeCandidateRecord>
  nextBatchSeq: number
}

function getRaw(event: MoveEventDraft): any {
  return event.raw ?? event.options?.sourceEvent?.raw ?? {}
}

function getCount(event: MoveEventDraft): number {
  return Math.max(0, Number(event.cardCount ?? event.options?.cardCount ?? 0))
}

/** 协议 CardIDs 中的正 ID；0 / 负数 / 非法值不参与 known 对齐。 */
function getPositiveIDs(cardIDs: any[] = []): number[] {
  return Array.from(new Set(cardIDs.map((id) => Number(id) || 0).filter((id) => id > 0)))
}

function patchEvent(event: MoveEventDraft, patch: any = {}): MoveEventDraft {
  return {
    ...event,
    ...patch,
    cardIDs: patch.cardIDs ?? event.cardIDs,
    options: {
      ...event.options,
      ...(patch.options ?? {})
    }
  }
}

function nextGroupID(room: Room, spellID: number | string, label: string): string {
  return `${label}_${spellID}_${++room.constraintGroupSeq}`
}

function resolveSpellID(event: MoveEventDraft): number {
  const raw = getRaw(event)
  const spellID = Number(raw.SpellID ?? event.options?.spellID ?? 0)
  return Number.isFinite(spellID) ? spellID : 0
}

/** 可写读取：进区登记时才创建房间账本。 */
function getRoomExchangeState(room: Room): HandExchangeRoomState {
  return room.getSkillState(HAND_EXCHANGE_STATE_KEY, () => ({
    bySpell: {},
    candidateRecords: new Map(),
    nextBatchSeq: 0
  })) as HandExchangeRoomState
}

/**
 * 只读读取：不存在则返回 undefined，避免查询路径留下空 skillState。
 * 回手 / 清理 都应走这条路径。
 */
function getRoomExchangeStateReadonly(room: Room): HandExchangeRoomState | undefined {
  return room.skillState.get(HAND_EXCHANGE_STATE_KEY) as HandExchangeRoomState | undefined
}

/** 可写读取：确保指定 SpellID 的批次字典存在。 */
function getSpellExchangeState(room: Room, spellID: number): HandExchangeSpellState {
  const roomState = getRoomExchangeState(room)
  const key = String(spellID)
  if (!roomState.bySpell[key]) {
    roomState.bySpell[key] = { batches: {} }
  }
  return roomState.bySpell[key]
}

/** 只读读取：未登记过该 SpellID 时不创建空字典。 */
function getSpellExchangeStateReadonly(
  room: Room,
  spellID: number
): HandExchangeSpellState | undefined {
  return getRoomExchangeStateReadonly(room)?.bySpell[String(spellID)]
}

/** 某 SpellID 的批次全部取回后清理；房间账本空了再删 skillState key。 */
function clearSpellExchangeState(room: Room, spellID: number): void {
  const roomState = getRoomExchangeStateReadonly(room)
  if (!roomState) return
  delete roomState.bySpell[String(spellID)]
  if (Object.keys(roomState.bySpell).length === 0 && roomState.candidateRecords.size === 0) {
    room.clearSkillState(HAND_EXCHANGE_STATE_KEY)
  }
}

/**
 * 收集某座位当前手牌实体（明牌 + 暗实体 + 候选明牌）。
 * 优先扫 player 快照而不是 room.cards 全牌池；仍对访问量做 traversal 插桩。
 */
function getPlayerHandCards(room: Room, seatID: SeatID): Card[] {
  // 装饰阶段优先复用 player 快照，避免每次进区都扫 room.cards 全牌池。
  const playerCards = room.refreshPlayerSnapshot()
  recordTraversal('handExchange:playerHand', playerCards.length)
  return playerCards.filter((card) => card.subZone === 'hand' && card.seats.has(seatID))
}

/** 判断某个逻辑候选是否表示指定座位的手牌分支。 */
function isHandCandidate(
  alternative: HandExchangeCandidateAlternative,
  seatID: SeatID
): alternative is LocationCandidate {
  return (
    alternative.type === 'player' && alternative.subZone === 'hand' && alternative.seatID === seatID
  )
}

/** 批次候选不是通用 LocationCandidate，只能由本模块解释和还原。 */
function isBatchAlternative(
  alternative: HandExchangeCandidateAlternative
): alternative is HandExchangeBatchAlternative {
  return alternative.type === 'handExchangeBatch'
}

/** 为普通位置与批次令牌生成统一去重键，防止座位置换后产生重复分支。 */
function candidateAlternativeKey(alternative: HandExchangeCandidateAlternative): string {
  if (isBatchAlternative(alternative)) return `batch:${alternative.batchID}`
  return JSON.stringify(alternative)
}

/** 合并交换置换后指向同一完整位置的候选分支。 */
function dedupeCandidateAlternatives(
  alternatives: HandExchangeCandidateAlternative[]
): HandExchangeCandidateAlternative[] {
  const unique = new Map<string, HandExchangeCandidateAlternative>()
  alternatives.forEach((alternative) => {
    unique.set(candidateAlternativeKey(alternative), alternative)
  })
  return Array.from(unique.values())
}

/**
 * 捕获候选牌进入本轮交换前的完整位置。
 *
 * 单一位置已经是确定实体，不需要候选账本接管。
 */
function createCandidateRecord(card: Card): HandExchangeCandidateRecord | null {
  const alternatives = card.locationCandidates.map((candidate) => ({ ...candidate }))
  if (alternatives.length <= 1) return null

  return {
    card,
    alternatives,
    spellID: card.spellID,
    subZone: card.subZone
  }
}

/**
 * 把模块内的批次候选投影回 Card 可理解的 LocationCandidate。
 *
 * 尚未返回的批次统一投影为 exchange outside 候选；唯一 batchID 仍保留在 record 中，
 * 所以多个嵌套批次即使投影相同，也不会丢失各自的返回目标。
 */
function projectCandidateRecord(room: Room, record: HandExchangeCandidateRecord): void {
  const projected = dedupeCandidateAlternatives(
    record.alternatives.map((alternative) => {
      if (!isBatchAlternative(alternative)) return alternative
      // 完整位置主模型没有批次维度；exchange outside 候选只作为暂存投影，
      // 真正的批次身份仍由 candidateRecords 中的唯一 batchID 保留。
      return { type: 'outside', zone: 'exchange' } satisfies LocationCandidate
    })
  ) as LocationCandidate[]
  const hasPlayerCandidate = projected.some((candidate) => candidate.type === 'player')

  // 候选身份由逻辑账本承载，不能同时残留在真实公共 Zone 中被默认移动路径再次取走。
  room.clearCardsFromPublicZones([record.card])
  if (hasPlayerCandidate) {
    // 仍有玩家位置分支时保留手牌兼容读面，供索引和后续嵌套交换继续识别。
    record.card.subZone = record.subZone
    record.card.spellID = record.spellID
  } else {
    // 所有分支都已暂存时，只把 Card 停在逻辑 exchange；不加入 Zone，避免重复占实体槽。
    record.card.location = 'exchange'
    record.card.subZone = null
    record.card.spellID = null
  }
  record.card.setLocationCandidates(projected, 'handExchange:candidateProjection')
  room.notifyCardChanged(record.card, { type: 'hand-exchange-candidate-projected' })
}

/**
 * 将 fromSeat 对应的所有候选分支替换为本次 batchID。
 *
 * 返回集合只包含本批次接管的候选 Card，调用方据此把它们排除在确定实体列表之外。
 */
function stageCandidateAlternatives(
  room: Room,
  roomState: HandExchangeRoomState,
  handCards: Card[],
  fromSeat: SeatID,
  batchID: string,
  protocolKnownIDs: Set<number>
): Set<Card> {
  handCards.forEach((card) => {
    // 协议明确给出正 ID 时，来源身份已经确定，应继续走普通实体移动而不是保留候选。
    if (protocolKnownIDs.has(card.id) || roomState.candidateRecords.has(card)) return
    // 当前候选 UI 只追踪已公开正 ID；暗占位仍由 sourceCards 和数量约束处理。
    if (!(card.isKnown === true && card.id > 0)) return

    const record = createCandidateRecord(card)
    if (
      record &&
      record.alternatives.some((alternative) => isHandCandidate(alternative, fromSeat))
    ) {
      roomState.candidateRecords.set(card, record)
    }
  })

  const stagedCandidates = new Set<Card>()
  // 遍历房间级记录而不是当前玩家快照，使已完全暂存的候选仍可参与跨 SpellID 嵌套交换。
  roomState.candidateRecords.forEach((record) => {
    let staged = false
    record.alternatives = dedupeCandidateAlternatives(
      record.alternatives.map((alternative) => {
        if (!isHandCandidate(alternative, fromSeat)) return alternative
        staged = true
        return { type: 'handExchangeBatch', batchID }
      })
    )
    if (!staged) return

    stagedCandidates.add(record.card)
    projectCandidateRecord(room, record)
  })
  return stagedCandidates
}

/**
 * 把指定 batchID 的候选分支恢复为接收座位手牌。
 *
 * 只有一张牌的全部批次令牌都已返回后，才移除房间级记录并重新完全交给通用候选模型。
 */
function returnCandidateAlternatives(
  room: Room,
  roomState: HandExchangeRoomState,
  batchID: string,
  toSeat: SeatID,
  protocolKnownIDs: Set<number>,
  revealsWholeBatch: boolean
): Set<number> {
  const logicallyResolvedKnownIDs = new Set<number>()
  roomState.candidateRecords.forEach((record, card) => {
    let returned = false

    // 回手协议明确给出该候选 ID 时，已经证明它属于本批次；
    // 其它座位或嵌套批次分支全部失效，可直接确认到接收者手牌。
    if (
      protocolKnownIDs.has(card.id) &&
      record.alternatives.some(
        (alternative) => isBatchAlternative(alternative) && alternative.batchID === batchID
      )
    ) {
      record.alternatives = [
        {
          type: 'player',
          seatID: toSeat,
          subZone: 'hand',
          spellID: null
        }
      ]
      projectCandidateRecord(room, record)
      roomState.candidateRecords.delete(card)
      // 该 ID 已由候选账本直接落到目标手牌，不能再交给物理移动路径重复搬运。
      logicallyResolvedKnownIDs.add(card.id)
      return
    }

    record.alternatives = dedupeCandidateAlternatives(
      record.alternatives
        .map((alternative) => {
          if (!isBatchAlternative(alternative) || alternative.batchID !== batchID) {
            return alternative
          }
          returned = true
          // CardIDs 覆盖整批时，未出现的候选不属于该批次；删除该分支而不是移到接收者。
          if (revealsWholeBatch) return null
          return {
            type: 'player',
            seatID: toSeat,
            subZone: 'hand',
            spellID: null
          } satisfies LocationCandidate
        })
        .filter(
          (alternative): alternative is HandExchangeCandidateAlternative => alternative !== null
        )
    )
    if (!returned) return

    // 完整明牌与候选账本矛盾时可能删空全部分支；保留当前 Card 状态并等待后续协议，
    // 不凭空构造一个错误位置。
    if (record.alternatives.length === 0) {
      roomState.candidateRecords.delete(card)
      return
    }

    projectCandidateRecord(room, record)
    // 仍有令牌表示该身份还横跨未结算的外层/内层交换，必须继续保留自定义账本。
    if (!record.alternatives.some(isBatchAlternative)) {
      roomState.candidateRecords.delete(card)
    }
  })
  return logicallyResolvedKnownIDs
}

/** 生成房间内唯一批次 ID，避免同 SpellID、同座位的嵌套交换令牌冲突。 */
function nextBatchID(roomState: HandExchangeRoomState, spellID: number, fromSeat: SeatID): string {
  return `${spellID}:${fromSeat}:${++roomState.nextBatchSeq}`
}

/**
 * 整手进区门槛：
 * - 调用方已收集 handCards，这里只做张数判断，避免二次扫描
 * - CardCount 等于本地手牌实体数，或等于已观测手牌数
 * - 空手只在观测手牌数明确为 0 时接管，用空批次隔离嵌套交换
 * - 允许协议带正 CardIDs（常见于己方整手），不要求全暗
 *
 * 不接管佐练单张 5->10、诫厉暂存后回牌堆等非整手路径。
 */
function isWholeHandExchangeStage(
  event: MoveEventDraft,
  room: Room,
  fromSeat: SeatID,
  handCards: Card[]
): boolean {
  const cardCount = getCount(event)
  const player = room.getPlayer(fromSeat)

  if (cardCount === 0) {
    return (
      handCards.length === 0 &&
      player?.hasObservedHandCount === true &&
      player.observedHandCount === 0
    )
  }

  if (handCards.length === 0) return false

  // 观测手牌数是协议事实；一旦存在，不能再用可能尚未补齐的实体快照放宽整手门槛。
  if (player?.hasObservedHandCount === true) {
    return cardCount === player.observedHandCount
  }

  // 没有观测总数时，才退回本地实体数判断是否为整手。
  return cardCount === handCards.length
}

/**
 * 用协议正 ID 对齐实体公开态。
 * 本机视角的己方整手可能给出全部正 ID，但本地 isKnown 仍可能为 false；
 * 不在进区/回手前 confirmKnown，后续会把它们当暗实体塞进 sourceCards。
 */
function alignProtocolKnownCards(event: MoveEventDraft, cards: Card[]): void {
  const protocolKnownIDs = new Set(getPositiveIDs(event.cardIDs ?? []))

  // 协议正 ID 表示这些身份对本机已公开；登记批次前先对齐 isKnown，
  // 避免己方整手正 ID 进交换区后仍被当暗实体处理。
  if (protocolKnownIDs.size > 0) {
    cards.forEach((card) => {
      if (protocolKnownIDs.has(card.id) && card.isKnown !== true) {
        card.confirmKnown()
      }
    })
  }
}

/**
 * 把批次拆成 Room.moveCards 可消费的两路：
 * - knownIDs -> cardIDs（按正 ID 搬走明牌）
 * - unknownCards -> options.sourceCards（按实体搬走暗牌）
 */
function splitKnownAndUnknownCards(cards: Card[]): {
  knownIDs: number[]
  unknownCards: Card[]
} {
  const knownIDs: number[] = []
  const unknownCards: Card[] = []

  cards.forEach((card) => {
    if (card.isKnown === true && card.id > 0) {
      knownIDs.push(card.id)
      return
    }
    unknownCards.push(card)
  })

  return { knownIDs, unknownCards }
}

/**
 * 生成进区/回手补丁。
 * 明暗同批不能共用 combinationID：Room 会把 known 组与 unknown 组合并，
 * ConstraintGroup.known 被 OR 为 true 后会 confirmKnown 整组暗牌。
 */
function buildExchangePatch(
  event: MoveEventDraft,
  room: Room,
  cards: Card[],
  spellID: number,
  label: string,
  hasCandidateAlternatives = false,
  logicallyResolvedKnownIDs: Set<number> = new Set()
): MoveEventDraft {
  const { knownIDs: stagedKnownIDs, unknownCards } = splitKnownAndUnknownCards(cards)
  // 回到可见手牌时，协议正 ID 可能对应 exchange 中的匿名占位；
  // 保留这些 ID 让 Room 的公共区身份置换把占位替换为真实已知实体。
  const protocolKnownIDs = getPositiveIDs(event.cardIDs ?? []).filter(
    (id) => !logicallyResolvedKnownIDs.has(id)
  )
  const knownIDs = Array.from(new Set([...stagedKnownIDs, ...protocolKnownIDs]))
  const protocolCardCount = getCount(event)
  // 候选模式只移动确定实体，完整手牌数量改由 handMoveCount 单独同步。
  const cardCount = hasCandidateAlternatives
    ? cards.length
    : Math.max(protocolCardCount, cards.length)
  // 纯明或纯暗才挂 combinationID；混批只靠 cardIDs + sourceCards 分别移动。
  const isPureBatch = cards.length > 0 && (knownIDs.length === 0 || unknownCards.length === 0)

  return patchEvent(event, {
    cardIDs: knownIDs,
    options: {
      ...(unknownCards.length > 0 ? { sourceCards: unknownCards } : {}),
      cardCount,
      ...(hasCandidateAlternatives ? { handMoveCount: protocolCardCount } : {}),
      ...(isPureBatch ? { combinationID: nextGroupID(room, spellID, label) } : {})
    }
  })
}

/**
 * 手牌 -> 交换区（5 -> 10）。
 * 流程：收集一次手牌 -> 校验整手 -> 对齐协议正 ID -> 登记批次 -> 拆明暗补丁。
 * 账本 key 使用 FromID（原持有座位），回手时协议会把同一值放回 FromID。
 */
function stageHandToExchange(event: MoveEventDraft, room: Room, spellID: number): MoveEventDraft {
  const raw = getRaw(event)
  const fromSeat = Number(raw.FromID)
  if (!Number.isFinite(fromSeat)) return event

  // 同一次进区只扫一次手牌，门槛判断与批次登记复用同一结果。
  const handCards = getPlayerHandCards(room, fromSeat)
  if (!isWholeHandExchangeStage(event, room, fromSeat, handCards)) return event

  alignProtocolKnownCards(event, handCards)

  // 只有确认接管后才创建可写账本，避免非整手路径污染 skillState。
  const roomState = getRoomExchangeState(room)
  const state = getSpellExchangeState(room, spellID)
  const batchKey = String(fromSeat)
  const batchStack = state.batches[batchKey] ?? []
  const batchID = nextBatchID(roomState, spellID, fromSeat)
  const protocolKnownIDs = new Set(getPositiveIDs(event.cardIDs ?? []))
  const stagedCandidates = stageCandidateAlternatives(
    room,
    roomState,
    handCards,
    fromSeat,
    batchID,
    protocolKnownIDs
  )
  // 候选身份已有 batchID 承载，不能再次放入 cardIDs/sourceCards，否则会被实锤到来源座位。
  const batchCards = handCards.filter((card) => !stagedCandidates.has(card))
  const cardCount =
    stagedCandidates.size > 0 ? getCount(event) : Math.max(getCount(event), handCards.length)
  // 内层交换后结算先于外层；同座位批次按后进先出保存才能对应协议回手顺序。
  batchStack.push({
    batchID,
    cards: batchCards.slice(),
    cardCount,
    hasCandidateAlternatives: stagedCandidates.size > 0,
    fromSeat,
    spellID
  })
  state.batches[batchKey] = batchStack

  // 零张批次只充当嵌套屏障，不需要改写实际移动参数或创建约束组。
  if (handCards.length === 0 && stagedCandidates.size === 0) return event
  return buildExchangePatch(
    event,
    room,
    batchCards,
    spellID,
    'hand_exchange_stage',
    stagedCandidates.size > 0
  )
}

/**
 * 交换区 -> 手牌（10 -> 5）。
 * FromID 是进区时登记的批次键（原持有者），不是目标座位；目标座位在 ToID。
 * 查询未命中时只读返回，不创建空账本。
 */
function returnExchangeBatchToHand(
  event: MoveEventDraft,
  room: Room,
  spellID: number
): MoveEventDraft {
  const raw = getRaw(event)
  // 回手协议：FromID = 原持有者批次键；ToID = 真正接收座位。
  const batchKey = String(raw.FromID)
  const state = getSpellExchangeStateReadonly(room, spellID)
  const batchStack = state?.batches[batchKey]
  // 优先弹出内层批次，避免空手回牌事件误消费仍待结算的外层实体批次。
  const batch = batchStack?.pop()
  if (!batch) return event

  // 批次可能被中途打断；只取仍停在 exchange 的实体，避免把已离开的牌再搬一次。
  const stagedCards = batch.cards.filter((card) => card.location === 'exchange')
  // 仅当前座位的全部嵌套批次均已结算时，才删除它的账本入口。
  if (batchStack.length === 0) {
    delete state.batches[batchKey]
  }
  if (Object.keys(state.batches).length === 0) {
    clearSpellExchangeState(room, spellID)
  }

  const roomState = getRoomExchangeStateReadonly(room)
  let logicallyResolvedKnownIDs = new Set<number>()
  if (roomState) {
    const protocolKnownIDs = new Set(getPositiveIDs(event.cardIDs ?? []))
    const protocolCardCount = getCount(event)
    const revealsWholeBatch = protocolCardCount > 0 && protocolKnownIDs.size >= protocolCardCount
    logicallyResolvedKnownIDs = returnCandidateAlternatives(
      room,
      roomState,
      batch.batchID,
      Number(raw.ToID),
      protocolKnownIDs,
      revealsWholeBatch
    )
    if (Object.keys(roomState.bySpell).length === 0 && roomState.candidateRecords.size === 0) {
      room.clearSkillState(HAND_EXCHANGE_STATE_KEY)
    }
  }

  if (stagedCards.length === 0 && !batch.hasCandidateAlternatives) return event

  // 回手协议也可能带正 ID；与进区一致，先对齐批次内对应实体的公开状态。
  alignProtocolKnownCards(event, stagedCards)

  return buildExchangePatch(
    event,
    room,
    stagedCards,
    spellID,
    'hand_exchange_return',
    batch.hasCandidateAlternatives,
    logicallyResolvedKnownIDs
  )
}

/**
 * 通用整手牌交换装饰：不绑定具体 SpellID。
 * 只处理 MoveType=11 且 zone 为 5<->10 的路径；其余事件原样返回。
 *
 * 协议模式：
 * - 手牌 -> 交换区（5 -> 10）：按 FromID 登记整批；允许协议正 CardIDs（己方整手）
 * - 交换区 -> 手牌（10 -> 5）：FromID 是原持有者批次键，目标座位看 ToID
 */
export default function decorateHandExchange(event: MoveEventDraft, room: Room): MoveEventDraft {
  const raw = getRaw(event)
  if (Number(raw.MoveType ?? event.moveType ?? event.options?.moveType) !== MOVE_TYPE.EXCHANGE) {
    return event
  }

  const fromZone = Number(raw.FromZone)
  const toZone = Number(raw.ToZone)
  const spellID = resolveSpellID(event)

  if (fromZone === 5 && toZone === 10) {
    return stageHandToExchange(event, room, spellID)
  }

  if (fromZone === 10 && toZone === 5) {
    return returnExchangeBatchToHand(event, room, spellID)
  }

  return event
}
