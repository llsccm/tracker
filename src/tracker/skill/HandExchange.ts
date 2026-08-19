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
 * docs/protocols/hand-exchange.md
 *
 * ## 不变式（改动前务必对齐三处读写口径）
 * 1. Card.locationCandidates 是候选位置（含 exchange 批次令牌）的唯一可写来源；
 *    seats / subZoneCandidates 只是它的只读投影。
 * 2. HandExchangeCandidateRecord 只保存 spellID / subZone 元数据用于恢复兼容读面，
 *    绝不保存候选集合副本，避免通用约束收敛后的分支被旧快照复活。
 * 3. card.location / subZone / spellID 兼容读面由 projectCandidateRecord 同步；
 *    当通用约束删掉最后一个玩家分支时，改由 Card.syncLegacyCandidatesFromLocationCandidates
 *    的 exchange 分支兜底为 location='exchange'。改其一必须同步其二。
 * 4. 逻辑暂存的候选牌 location 记为 'exchange'，但刻意不加入 zones.get('exchange')；
 *    因此按 Zone 成员统计的口径不会计入它们，按 card.location 统计的口径才会。
 */
import { MOVE_TYPE } from '../MoveEventNormalizer'
import { trackerLogger } from '@/utils/logger'
import type { Card } from '../Card'
import type { Room } from '../Room'
import type {
  LocationCandidate,
  OutsideLocationCandidate,
  SeatID,
  SpellID,
  SubZone
} from '../types'
import { recordTraversal } from '../traversalStats'
import {
  getCount,
  getPositiveIDs,
  getRaw,
  type MoveEventDraft,
  nextGroupID,
  patchEvent
} from './moveEventUtils'

/**
 * 当前一局 tracker 状态的共享 key。
 * value 形态：{ bySpell: { [spellID]: { batches: { [fromSeat]: batch[] } } } }
 * 按 SpellID 隔离，避免两个交换技能并发时串批。
 */
export const HAND_EXCHANGE_STATE_KEY = 'handExchangeBatches'

/** 某座位进交换区时登记的一整批手牌实体。 */
type HandExchangeBatch = {
  /** 唯一批次令牌；候选位置在进出交换区时通过该令牌完成可逆置换。 */
  batchID: string
  /** 进区时快照的实体列表；回手时只取仍在 exchange 的成员。 */
  cards: Card[]
  /** 是否有候选位置由逻辑账本迁移；此时实体数与协议手牌变化量需要解耦。 */
  hasCandidateAlternatives: boolean
  /** 原持有座位；也是 batches 字典的 key。 */
  fromSeat: SeatID
  spellID: number
}

/**
 * 单张候选牌的交换期元数据。
 *
 * 候选集合始终只写 Card.locationCandidates；这里不保存副本，避免通用约束收敛后被旧快照覆盖。
 */
type HandExchangeCandidateRecord = {
  card: Card
  /** 进入候选账本前的兼容字段，最终恢复玩家读面时一并还原。 */
  spellID: SpellID | null
  subZone: SubZone | null
}

/** 单个 SpellID 下尚未取回的进区批次与候选记录；同座位按嵌套顺序使用栈。 */
type HandExchangeSpellState = {
  /** 同一座位可能在外层交换尚未回手时再次参与内层交换，因此不能只保存单个批次。 */
  batches: Record<string, HandExchangeBatch[]>
  /**
   * 本 SpellID 私有的候选元数据索引；与 batches 一样按技能隔离，
   * 两个交换技能并发时不会互相串走对方的候选分支。候选位置本身保存在 Card.locationCandidates。
   */
  candidateRecords: Map<Card, HandExchangeCandidateRecord>
}

/** 房间内所有交换技能的批次账本。 */
type HandExchangeRoomState = {
  bySpell: Record<string, HandExchangeSpellState>
  /** 仅用于生成全局唯一 batchID 的自增序号；批次与候选均已按 SpellID 隔离。 */
  nextBatchSeq: number
}

function resolveSpellID(event: MoveEventDraft): number {
  const raw = getRaw(event)
  const spellID = Number(raw.SpellID ?? event.options?.spellID ?? 0)
  return Number.isFinite(spellID) ? spellID : 0
}

/** 可写读取：进区登记时才创建房间账本。 */
function ensureRoomExchangeState(room: Room): HandExchangeRoomState {
  return room.ensureSkillState(HAND_EXCHANGE_STATE_KEY, () => ({
    bySpell: {},
    nextBatchSeq: 0
  }))
}

/**
 * 只读读取：不存在则返回 undefined，避免查询路径留下空 skillState。
 * 回手 / 清理 都应走这条路径。
 */
function readRoomExchangeState(room: Room): HandExchangeRoomState | undefined {
  return room.readSkillState<HandExchangeRoomState>(HAND_EXCHANGE_STATE_KEY)
}

/** 可写读取：确保指定 SpellID 的批次字典存在。 */
function ensureSpellExchangeState(room: Room, spellID: number): HandExchangeSpellState {
  const roomState = ensureRoomExchangeState(room)
  const key = String(spellID)
  if (!roomState.bySpell[key]) {
    // 候选记录随批次字典一起按 SpellID 建账，回手结算后随该技能账本一并清理。
    roomState.bySpell[key] = { batches: {}, candidateRecords: new Map() }
  }
  return roomState.bySpell[key]
}

/** 只读读取：未登记过该 SpellID 时不创建空字典。 */
function readSpellExchangeState(room: Room, spellID: number): HandExchangeSpellState | undefined {
  return readRoomExchangeState(room)?.bySpell[String(spellID)]
}

/**
 * 某 SpellID 的批次与候选都结算完后清理其账本；共享账本空了再删除 tracker 状态 key。
 * 必须在候选恢复（returnCandidateAlternatives）之后调用：候选记录已按 SpellID 隔离，
 * 过早删除该技能账本会连带丢失尚未回手的候选令牌。
 */
function clearSpellExchangeStateIfEmpty(room: Room, spellID: number): void {
  const roomState = readRoomExchangeState(room)
  if (!roomState) return

  const state = roomState.bySpell[String(spellID)]
  if (state && Object.keys(state.batches).length === 0 && state.candidateRecords.size === 0) {
    delete roomState.bySpell[String(spellID)]
  }

  if (Object.keys(roomState.bySpell).length === 0) {
    room.deleteSkillState(HAND_EXCHANGE_STATE_KEY)
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
function isHandCandidate(candidate: LocationCandidate, seatID: SeatID): boolean {
  return candidate.type === 'player' && candidate.subZone === 'hand' && candidate.seatID === seatID
}

/** exchange 批次令牌直接参与统一候选模型，并以 batchID 区分嵌套层级。 */
function isBatchCandidate(
  candidate: LocationCandidate
): candidate is OutsideLocationCandidate & { batchID: string } {
  return candidate.type === 'outside' && candidate.zone === 'exchange' && Boolean(candidate.batchID)
}

/**
 * 捕获候选牌进入本轮交换前的完整位置。
 *
 * 单一位置已经是确定实体，不需要候选账本接管。
 */
function createCandidateRecord(card: Card): HandExchangeCandidateRecord | null {
  if (card.locationCandidates.length <= 1) return null

  return {
    card,
    spellID: card.spellID,
    subZone: card.subZone
  }
}

/**
 * 根据 Card 当前候选同步物理位置兼容读面。
 *
 * batchID 已直接保存在 locationCandidates；record 只负责恢复旧版 subZone / spellID 读面。
 */
function projectCandidateRecord(room: Room, record: HandExchangeCandidateRecord): void {
  const candidates = record.card.getLocationCandidates()
  const hasPlayerCandidate = candidates.some((candidate) => candidate.type === 'player')
  const hasBatchCandidate = candidates.some(isBatchCandidate)

  // 批次令牌只是逻辑候选，实体不能同时残留在真实公共 Zone 中被默认来源再次取走。
  if (hasPlayerCandidate || hasBatchCandidate) {
    room.clearCardsFromPublicZones([record.card])
  }

  if (hasPlayerCandidate) {
    // 仍有玩家位置分支时保留手牌兼容读面，供索引和后续嵌套交换继续识别。
    record.card.subZone = record.subZone
    record.card.spellID = record.spellID
  } else if (hasBatchCandidate) {
    // 只有批次分支时停在逻辑 exchange；不加入 Zone，避免占用其它批次的实体槽。
    record.card.location = 'exchange'
    record.card.subZone = null
    record.card.spellID = null
  }

  room.notifyCardChanged(record.card, { type: 'hand-exchange-candidate-projected' })
}

/**
 * 将 fromSeat 对应的所有候选分支替换为本次 batchID。
 *
 * 返回集合只包含本批次接管的候选 Card，调用方据此把它们排除在确定实体列表之外。
 * 候选记录取自本 SpellID 私有账本，不会波及并发的其它交换技能。
 */
function stageCandidateAlternatives(
  room: Room,
  state: HandExchangeSpellState,
  handCards: Card[],
  fromSeat: SeatID,
  batchID: string,
  protocolKnownIDs: Set<number>
): Set<Card> {
  handCards.forEach((card) => {
    // 协议明确给出正 ID 时，来源身份已经确定，应继续走普通实体移动而不是保留候选。
    if (protocolKnownIDs.has(card.id) || state.candidateRecords.has(card)) return
    // 当前候选 UI 只追踪已公开正 ID；暗占位仍由 sourceCards 和数量约束处理。
    if (!(card.isKnown === true && card.id > 0)) return

    const record = createCandidateRecord(card)
    if (
      record &&
      card.getLocationCandidates().some((candidate) => isHandCandidate(candidate, fromSeat))
    ) {
      state.candidateRecords.set(card, record)
    }
  })

  const stagedCandidates = new Set<Card>()
  // 始终改写 Card 当前候选，通用约束在嵌套交换期间消除的分支不会被元数据索引复活。
  state.candidateRecords.forEach((record) => {
    let staged = false
    const nextCandidates = record.card.getLocationCandidates().map((candidate) => {
      if (!isHandCandidate(candidate, fromSeat)) return candidate
      staged = true
      return {
        type: 'outside',
        zone: 'exchange',
        batchID
      } satisfies OutsideLocationCandidate
    })
    if (!staged) return

    stagedCandidates.add(record.card)
    record.card.setLocationCandidates(nextCandidates, 'handExchange:candidateStage')
    projectCandidateRecord(room, record)
  })
  return stagedCandidates
}

/**
 * 把指定 batchID 的候选分支恢复为接收座位手牌。
 *
 * 只有一张牌的全部批次令牌都已返回后，才移除该 SpellID 记录并重新完全交给通用候选模型。
 */
function returnCandidateAlternatives(
  room: Room,
  state: HandExchangeSpellState,
  batchID: string,
  toSeat: SeatID,
  protocolKnownIDs: Set<number>,
  revealsWholeBatch: boolean
): Set<number> {
  const logicallyResolvedKnownIDs = new Set<number>()
  state.candidateRecords.forEach((record, card) => {
    const currentCandidates = card.getLocationCandidates()
    const belongsToBatch = currentCandidates.some(
      (candidate) => isBatchCandidate(candidate) && candidate.batchID === batchID
    )

    // 回手协议明确给出该候选 ID 时，已经证明它属于本批次；
    // 其它座位或嵌套批次分支全部失效，可直接确认到接收者手牌。
    if (protocolKnownIDs.has(card.id) && belongsToBatch) {
      card.setLocationCandidates(
        [
          {
            type: 'player',
            seatID: toSeat,
            subZone: 'hand',
            spellID: null
          }
        ],
        'handExchange:candidateKnownReturn'
      )
      projectCandidateRecord(room, record)
      state.candidateRecords.delete(card)
      // 该 ID 已由候选模型直接落到目标手牌，不能再交给物理移动路径重复搬运。
      logicallyResolvedKnownIDs.add(card.id)
      return
    }

    let returned = false
    const nextCandidates = currentCandidates
      .map((candidate) => {
        if (!isBatchCandidate(candidate) || candidate.batchID !== batchID) return candidate
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
      .filter((candidate): candidate is LocationCandidate => candidate !== null)
    if (!returned) return

    // 完整明牌与当前候选矛盾时可能删空全部分支；清除批次令牌但保留实体当前位置，
    // 等待后续协议重新建立可证明的位置。
    card.setLocationCandidates(nextCandidates, 'handExchange:candidateReturn')
    projectCandidateRecord(room, record)

    // 正常情况下总会留下另一个玩家/批次分支；删空说明协议整手明牌与本地候选相互矛盾，
    // 多半是上游观测有误。开发环境显式告警，避免静默留下一张无位置的已知牌难以定位。
    if (import.meta.env?.DEV && nextCandidates.length === 0) {
      trackerLogger.warn('整手交换回手后候选牌已无任何可证明位置（疑似协议矛盾或上游观测错误）', {
        cardID: card.id,
        batchID,
        toSeat
      })
    }

    if (nextCandidates.length === 0 || !nextCandidates.some(isBatchCandidate)) {
      state.candidateRecords.delete(card)
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
  logicallyResolvedKnownIDs: Set<number> = new Set(),
  moveOnlyStagedCards = false
): MoveEventDraft {
  const { knownIDs: stagedKnownIDs, unknownCards } = splitKnownAndUnknownCards(cards)
  // 回到可见手牌时，协议正 ID 可能对应 exchange 中的匿名占位；
  // 保留这些 ID 让 Room 的公共区身份置换把占位替换为真实已知实体。
  const protocolKnownIDs = getPositiveIDs(event.cardIDs ?? []).filter(
    (id) => !logicallyResolvedKnownIDs.has(id)
  )
  const knownIDs = Array.from(new Set([...stagedKnownIDs, ...protocolKnownIDs]))
  const protocolCardCount = getCount(event)
  const separatesEntityMovement = hasCandidateAlternatives || moveOnlyStagedCards
  // 回手批次可能已有成员提前离开 exchange；实体数只能取当前仍在区内的 cards，
  // 协议手牌变化量必须通过 handMoveCount 独立同步，不能从其它批次补足实体。
  const cardCount = separatesEntityMovement
    ? cards.length
    : Math.max(protocolCardCount, cards.length)
  // 纯明或纯暗才挂 combinationID；混批只靠 cardIDs + sourceCards 分别移动。
  const isPureBatch = cards.length > 0 && (knownIDs.length === 0 || unknownCards.length === 0)

  return patchEvent(event, {
    cardIDs: knownIDs,
    options: {
      ...(unknownCards.length > 0 ? { sourceCards: unknownCards } : {}),
      cardCount,
      ...(separatesEntityMovement ? { handMoveCount: protocolCardCount } : {}),
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
  const roomState = ensureRoomExchangeState(room)
  const state = ensureSpellExchangeState(room, spellID)
  const batchKey = String(fromSeat)
  const batchStack = state.batches[batchKey] ?? []
  // batchID 用房间级自增序号保证全局唯一；候选账本则取本 SpellID 私有的 state。
  const batchID = nextBatchID(roomState, spellID, fromSeat)
  const protocolKnownIDs = new Set(getPositiveIDs(event.cardIDs ?? []))
  const stagedCandidates = stageCandidateAlternatives(
    room,
    state,
    handCards,
    fromSeat,
    batchID,
    protocolKnownIDs
  )
  // 候选身份已有 batchID 承载，不能再次放入 cardIDs/sourceCards，否则会被实锤到来源座位。
  const batchCards = handCards.filter((card) => !stagedCandidates.has(card))
  // 内层交换后结算先于外层；同座位批次按后进先出保存才能对应协议回手顺序。
  batchStack.push({
    batchID,
    cards: batchCards.slice(),
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
  const state = readSpellExchangeState(room, spellID)
  const batchStack = state?.batches[batchKey]
  // 优先弹出内层批次，避免空手回牌事件误消费仍待结算的外层实体批次。
  const batch = batchStack?.pop()
  if (!batch || !state || !batchStack) return event

  // 批次可能被中途打断；只取仍停在 exchange 的实体，避免把已离开的牌再搬一次。
  const stagedCards = batch.cards.filter((card) => card.location === 'exchange')
  // 仅当前座位的全部嵌套批次均已结算时，才删除它的账本入口。
  if (batchStack.length === 0) {
    delete state.batches[batchKey]
  }

  // 候选分支必须在清理账本之前恢复：候选记录已按 SpellID 隔离，
  // 若先删空该技能账本，会连带丢失尚未回手的候选令牌。
  const protocolKnownIDs = new Set(getPositiveIDs(event.cardIDs ?? []))
  const protocolCardCount = getCount(event)
  const revealsWholeBatch = protocolCardCount > 0 && protocolKnownIDs.size >= protocolCardCount
  const logicallyResolvedKnownIDs = returnCandidateAlternatives(
    room,
    state,
    batch.batchID,
    Number(raw.ToID),
    protocolKnownIDs,
    revealsWholeBatch
  )

  // 批次与候选都结算后再清理该 SpellID 账本；共享账本空了顺带删除 tracker 状态 key。
  clearSpellExchangeStateIfEmpty(room, spellID)

  // 即使所有成员都已离开 exchange，也必须保留协议手牌变化量；不能退回原事件去抽取其它批次。
  // 回手协议也可能带正 ID；与进区一致，先对齐批次内对应实体的公开状态。
  alignProtocolKnownCards(event, stagedCards)

  return buildExchangePatch(
    event,
    room,
    stagedCards,
    spellID,
    'hand_exchange_return',
    batch.hasCandidateAlternatives,
    logicallyResolvedKnownIDs,
    true
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
