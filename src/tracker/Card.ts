import { BaseCard } from './BaseCard'
import { createSubZoneCandidateKey, getSubZoneName } from './candidate/subZoneCandidate'
import {
  createLocationCandidateKey,
  fromPublicCandidate,
  fromSubZoneCandidate,
  getPlayerLocationCandidates,
  getPublicLocationCandidates,
  normalizeLocationCandidate,
  projectSeatsFromLocationCandidates,
  toPublicCandidate
} from './candidate/locationCandidate'
import type { LocationCandidateInput } from './candidate/locationCandidate'
import type { SubZoneCandidateInput } from './candidate/subZoneCandidate'
import type { Room } from './Room'
import type {
  CardID,
  LocationCandidate,
  PlayerLocationCandidate,
  PublicCandidate,
  PublicZoneName,
  SeatID,
  SpellID,
  SubZone,
  SubZoneCandidate
} from './types'
import { getPublicCandidateLabel } from './candidate/publicCandidate'

type CardLocation = PublicZoneName | 'player' | 'suspended'
type SeatInput = SeatID | Iterable<SeatID | string | null | undefined> | null | undefined

interface SeatChangeSnapshot {
  previousOwner?: SeatID | null
  previousResolvedSeat?: SeatID | null
  previousSeatSize?: number
  previousSeats?: Set<SeatID>
  nextResolvedSeat?: SeatID | null
  nextSeats?: Set<SeatID>
  seatsChanged?: boolean
}

/** moveToPublicZone / reset 把牌带离玩家区前的状态快照，用于判断是否需要补发 player 快照脏牌。 */
interface PublicMigrationSnapshot {
  location: CardLocation
  subZone: SubZone | null
  spellID: SpellID | null
  candidateCount: number
  suspended: boolean
}

interface BindOptions {
  known?: boolean
}

interface CardIdentityLike {
  id: number
}

export function hasRealIdentity(card: CardIdentityLike): boolean {
  return card.id > 0
}

export function isAnonymous(card: CardIdentityLike): boolean {
  return !hasRealIdentity(card)
}

/**
 * 重构版卡牌实体类
 * 放弃双向链表，采用状态标记与座位候选集绑定机制
 */
export class Card extends BaseCard {
  declare entityID: number
  declare room: Room
  declare location: CardLocation
  declare subZone: SubZone | null
  declare isKnown: boolean
  declare spellID: SpellID | null
  declare turn: number
  declare round: number
  declare phase: number
  declare owner: SeatID | null
  /** 唯一候选存储；写入时冻结，读面可安全共享，不另存兼容投影。 */
  private _locationCandidates: readonly Readonly<LocationCandidate>[] = Object.freeze([])
  declare suspended: boolean

  /**
   * @param id - 卡牌 ID
   * @param room - 所属 Room 引用
   */
  constructor(id: CardID, room: Room) {
    super(id) // 内部由 BaseCard 自动通过 CardConfig 单例拉取 cardInfo
    this.room = room
    this.entityID = id > 0 ? id : room.allocateAnonymousEntityID()
    if (!hasRealIdentity(this)) this.id = this.entityID

    // 1. 位置绑定与标记
    this.location = 'pile' // 'pile' | 'discard' | 'exile' | 'player' | 'suspended'
    this.subZone = null // 当 location === 'player' 时：'hand' | 'equip' | 'judge' | 'mark'
    this.isKnown = false // 至少有一名玩家知道这张牌的物理 ID（明牌标记）
    this.spellID = null // 用于标记区域时，存储卡牌是由哪个具体技能（如“佐练”、“七星”）产生的

    // 最近一次卡牌流转时间戳信息，用于在弃牌堆中过滤本回合弃牌等武将特判
    this.turn = 0
    this.round = 0
    this.phase = 0

    // 2. 候选席位投影与拥有权
    this.owner = null // 当前拥有该牌的座位号，由 syncOwnerFromSeats 根据候选位置推导缓存
    // 完整位置候选：例如 A 手牌 / B 手牌 / A 标记。
    // owner 已确定不代表子区域已确定；落定后由 location/owner/subZone/spellID 保存位置。
    this.suspended = false // 候选席位过度发散时暂停追踪

    // 3. 嵌套组合指纹 (同生共死关系)
  }

  /**
   * 把匿名槽原地升级为真实身份；位置、候选与区域引用保持不变。
   * Room 负责在调用后同步身份集合、cardIndex 与计数器。
   */
  materializeIdentity(cardID: CardID): void {
    if (!isAnonymous(this) || cardID <= 0) return

    this.setCardInfo(cardID)
    this.entityID = cardID
  }

  get resolvedSeat(): SeatID | null {
    if (this.location !== 'player') return null
    const seats = this.seats
    return seats.size === 1 ? (seats.values().next().value ?? null) : null
  }

  get locationCandidates(): readonly Readonly<LocationCandidate>[] {
    return this._locationCandidates
  }

  /** 仅接收内部已规范化候选；状态迁移与脏事件仍由各领域写入口负责。 */
  private storeLocationCandidates(candidates: readonly LocationCandidate[]): void {
    this._locationCandidates = Object.freeze(
      candidates.map((candidate) => Object.freeze(candidate))
    )
  }

  get seats(): Set<SeatID> {
    // 座位查询读面：未决位置按候选投影，已落定位置读取 owner。
    const candidateSeats = projectSeatsFromLocationCandidates(this.locationCandidates)
    if (candidateSeats.size > 0) return candidateSeats
    if (this.location === 'player' && this.owner !== null) return new Set([this.owner])
    return new Set()
  }

  get subZoneCandidates(): SubZoneCandidate[] {
    // 迁移期兼容读面：玩家子区域候选只从完整位置主模型投影，不再独立存储。
    return getPlayerLocationCandidates(this.locationCandidates).map(
      ({ seatID, subZone, spellID }) => ({ seatID, subZone, spellID })
    )
  }

  get publicCandidates(): PublicCandidate[] {
    // 迁移期兼容读面：公共区候选只描述不确定的牌堆顶/底等位置。
    return getPublicLocationCandidates(this.locationCandidates)
      .map((candidate) =>
        toPublicCandidate(
          candidate,
          (zone, position, count) => getPublicCandidateLabel(zone, position, count) ?? null
        )
      )
      .filter((candidate): candidate is PublicCandidate => Boolean(candidate))
  }

  /**
   * 规整座位输入为 Set<SeatID>。
   * 兼容单值 / 数组 / Set，并丢弃 null、undefined 与 NaN。
   * 这是 seats 写路径的统一入口格式化，不改变牌的候选语义。
   */
  normalizeSeats(seats: SeatInput): Set<SeatID> {
    const rawSeats = seats instanceof Set || Array.isArray(seats) ? Array.from(seats) : [seats]
    return new Set(
      rawSeats
        .filter((seat) => seat !== null && seat !== undefined)
        .map((seat) => Number(seat))
        .filter((seat) => !Number.isNaN(seat))
    )
  }

  hasSameSeats(nextSeats: Set<SeatID>): boolean {
    const seats = this.seats
    if (seats.size !== nextSeats.size) return false
    return Array.from(nextSeats).every((seat) => seats.has(seat))
  }

  /**
   * 同步当前游戏回合/轮时间戳信息
   */
  syncTimestamp(): void {
    const timestamp = this.room?.getCurrentTimestamp?.() ?? {
      turn: 0,
      round: 0,
      phase: 0
    }
    this.turn = timestamp.turn ?? 0
    this.round = timestamp.round ?? 0
    this.phase = timestamp.phase ?? 0
  }

  /**
   * 确认这张物理牌已经明牌
   */
  confirmKnown(): void {
    if (!this.isKnown) {
      this.isKnown = true
      this.room?.markCounterDirty?.(this)
      // 明牌确认会改变投影（暗牌不投影、明牌进入对应展示桶），需通知增量索引重投影。
      this.room?.notifyCardChanged?.(this, { type: 'card-known-confirmed' })
    }
    this.syncTimestamp()
  }

  /**
   * 根据当前 seats 投影同步 owner / resolvedSeat，并在变化时发出脏事件。
   *
   * 注意：
   * - seats.size === 1 只表示 owner 已确定，不等于手牌/标记等子区域已确定。
   * - previousSeats 必须在候选收缩前捕获；被剔除的座位只会出现在事件快照里。
   * - 调用方可传入 SeatChangeSnapshot，避免 setSeats 过程中读到半更新状态。
   */
  syncOwnerFromSeats(reason = 'syncOwnerFromSeats', change: SeatChangeSnapshot = {}): boolean {
    const previousOwner = change.previousOwner ?? this.owner
    const previousResolvedSeat =
      change.previousResolvedSeat !== undefined ? change.previousResolvedSeat : previousOwner
    const currentSeats = change.nextSeats ?? this.seats
    // 无显式快照时席位集合未发生变化，变更前集合即当前集合。
    const previousSeats = change.previousSeats ?? currentSeats
    const previousSeatSize = change.previousSeatSize ?? previousSeats.size
    const seatsChanged = change.seatsChanged === true
    const nextResolvedSeat =
      change.nextResolvedSeat !== undefined
        ? change.nextResolvedSeat
        : this.location === 'player' && currentSeats.size === 1
          ? (currentSeats.values().next().value ?? null)
          : null
    const nextOwner = nextResolvedSeat
    const ownerChanged = previousOwner !== nextOwner
    const resolvedSeatChanged = previousResolvedSeat !== nextResolvedSeat

    this.owner = nextOwner

    if (seatsChanged || ownerChanged || resolvedSeatChanged) {
      this.room?.notifyCardChanged?.(this, {
        type: 'card-seats-changed',
        reason,
        previousResolvedSeat,
        nextResolvedSeat,
        previousSeatSize,
        nextSeatSize: currentSeats.size,
        previousSeats: Array.from(previousSeats),
        previousOwner,
        nextOwner
      })

      return true
    }

    return false
  }

  /**
   * 按座位筛选完整位置候选；无玩家候选时从已落定子区建立候选。
   *
   * 语义边界：
   * - 主要用途是“过滤/收敛”，不是“新增完整位置候选”。
   * - 已有玩家位置候选时：只按 seats 过滤对应玩家位置候选。
   * - 尚无完整位置候选且 seats > 1 时：按当前 subZone 兼容生成玩家位置候选。
   * - 若要扩展候选座位，应优先用 addSeat / setLocationCandidates，避免依赖本方法静默新增。
   * - seats 只是位置候选的座位级投影；owner 确定不代表具体子区域已落定。
   */
  setSeats(nextSeats: SeatInput, reason = 'setSeats'): boolean {
    const normalizedSeats = this.normalizeSeats(nextSeats)
    // 候选收缩前捕获席位，剔除的座位必须进入脏事件。
    const previousSeats = this.seats
    const seatsChanged =
      previousSeats.size !== normalizedSeats.size ||
      Array.from(normalizedSeats).some((seat) => !previousSeats.has(seat))
    const playerCandidates = getPlayerLocationCandidates(this.locationCandidates)

    if (playerCandidates.length > 0) {
      // 座位收敛只筛除对应玩家分支，保留同座位的不同子区及所有非玩家候选。
      const filteredCandidates = this.locationCandidates.filter(
        (candidate) => candidate.type !== 'player' || normalizedSeats.has(candidate.seatID)
      )
      return this.setLocationCandidates(filteredCandidates, reason)
    }

    if (this.location === 'player' && normalizedSeats.size > 1) {
      const subZone = this.subZone ?? 'hand'
      const spellID = subZone === 'mark' ? this.spellID : null
      const nextLocationCandidates = Array.from(normalizedSeats)
        .map((seatID) => fromSubZoneCandidate({ seatID, subZone, spellID }))
        .filter((candidate): candidate is PlayerLocationCandidate => Boolean(candidate))
      // 此分支尚无玩家候选；已有候选的重复投影由上面的筛选分支保持幂等。
      return this.setLocationCandidates(
        [...this.locationCandidates, ...nextLocationCandidates],
        reason
      )
    }

    return this.syncOwnerFromSeats(reason, {
      previousSeats,
      nextResolvedSeat:
        this.location === 'player' && normalizedSeats.size === 1
          ? (normalizedSeats.values().next().value ?? null)
          : null,
      nextSeats: normalizedSeats,
      seatsChanged
    })
  }

  /**
   * 扩展候选座位。
   *
   * - 尚无完整位置候选时：走 setSeats 的兼容扩座位路径。
   * - 已有完整位置候选时：真正追加目标座位的玩家位置候选，而不是只过滤旧候选。
   *   默认优先复制已有 hand 候选模板；没有 hand 时复制现有玩家子区模板。
   */
  addSeat(seat: SeatInput, reason = 'addSeat'): boolean {
    const normalizedSeats = this.normalizeSeats(seat)
    if (normalizedSeats.size === 0) return false

    if (this.hasLocationCandidates()) {
      const templates = this.getSeatExpansionTemplates(
        getPlayerLocationCandidates(this.locationCandidates)
      )
      const nextCandidates = this.locationCandidates.slice()
      let changed = false

      normalizedSeats.forEach((seatID) => {
        templates.forEach((template) => {
          const candidate: PlayerLocationCandidate = {
            type: 'player',
            seatID,
            subZone: template.subZone,
            spellID: template.spellID
          }
          const key = createLocationCandidateKey(candidate)
          if (!key || this.hasLocationCandidate(key)) return

          nextCandidates.push(candidate)
          changed = true
        })
      })

      if (!changed) return false
      return this.setLocationCandidates(nextCandidates, reason)
    }

    const nextSeats = new Set(this.seats)
    normalizedSeats.forEach((seatID) => nextSeats.add(seatID))
    return this.setSeats(nextSeats, reason)
  }

  /**
   * 推导 addSeat 需要追加的位置模板。
   * 有 hand 候选时只扩 hand，避免把标记区等局部候选误复制到新座位。
   */
  private getSeatExpansionTemplates(
    playerCandidates: PlayerLocationCandidate[]
  ): { subZone: SubZone; spellID: SpellID | null }[] {
    if (playerCandidates.length === 0) {
      const subZone = this.subZone ?? 'hand'
      return [
        {
          subZone,
          spellID: subZone === 'mark' ? this.spellID : null
        }
      ]
    }

    const handCandidates = playerCandidates.filter((candidate) => candidate.subZone === 'hand')
    const sourceCandidates = handCandidates.length > 0 ? handCandidates : playerCandidates
    const templates = new Map<string, { subZone: SubZone; spellID: SpellID | null }>()

    sourceCandidates.forEach((candidate) => {
      const spellID = candidate.subZone === 'mark' ? candidate.spellID : null
      const key = `${candidate.subZone}:${spellID ?? ''}`
      if (!templates.has(key)) {
        templates.set(key, { subZone: candidate.subZone, spellID })
      }
    })

    return Array.from(templates.values())
  }

  deleteSeat(seat: SeatInput, reason = 'deleteSeat'): boolean {
    const normalizedSeats = this.normalizeSeats(seat)
    if (normalizedSeats.size === 0) return false

    const nextSeats = new Set(this.seats)
    normalizedSeats.forEach((seatID) => nextSeats.delete(seatID))
    return this.setSeats(nextSeats, reason)
  }

  clearSeats(reason = 'clearSeats'): boolean {
    return this.setSeats([], reason)
  }

  hasLocationCandidates(): boolean {
    return this.locationCandidates.length > 0
  }

  hasLocationCandidate(candidate: LocationCandidateInput | string): boolean {
    const key = typeof candidate === 'string' ? candidate : createLocationCandidateKey(candidate)
    if (!key) return false

    return this.locationCandidates.some((item) => createLocationCandidateKey(item) === key)
  }

  /**
   * 根据候选协调位置事实、owner 和公共区关系；兼容投影由 getter 即时生成。
   */
  private reconcileLocationStateFromCandidates(
    reason: string,
    previousSeats: Set<SeatID>
  ): boolean {
    const playerCandidates = getPlayerLocationCandidates(this.locationCandidates)
    const hasPublicCandidate = this.locationCandidates.some(
      (candidate) => candidate.type === 'public'
    )
    const hasContainerCandidate = this.locationCandidates.some(
      (candidate) => candidate.type === 'container'
    )
    const hasExchangeBatchCandidate = this.locationCandidates.some(
      (candidate) =>
        candidate.type === 'outside' && candidate.zone === 'exchange' && Boolean(candidate.batchID)
    )
    const previousLocation = this.location
    let changed = false

    // 玩家/容器/交换批次候选都不能继续残留在真实公共 Zone 被后续摸牌再次取到。
    if (
      (playerCandidates.length > 0 || hasContainerCandidate || hasExchangeBatchCandidate) &&
      !hasPublicCandidate
    ) {
      this.room?.clearCardsFromPublicZones?.([this])
    }

    if (playerCandidates.length > 0 || hasContainerCandidate) {
      this.location = 'player'
      changed = previousLocation !== this.location
      this.syncTimestamp()
    } else if (hasExchangeBatchCandidate) {
      // 批次令牌只记逻辑 exchange 位置，不加入公共 Zone；与 HandExchange 的读面契约一致。
      this.location = 'exchange'
      this.subZone = null
      this.spellID = null
      changed = previousLocation !== this.location
      this.syncTimestamp()
    }

    // 这里只投影已经提交的候选，不调用 setSeats/clearSeats 反向改写候选。
    const nextSeats = projectSeatsFromLocationCandidates(this.locationCandidates)
    changed =
      this.syncOwnerFromSeats(reason, {
        previousSeats,
        nextSeats,
        nextResolvedSeat:
          this.location === 'player' && nextSeats.size === 1
            ? (nextSeats.values().next().value ?? null)
            : null,
        seatsChanged:
          previousSeats.size !== nextSeats.size ||
          Array.from(previousSeats).some((seat) => !nextSeats.has(seat))
      }) || changed

    if (changed) {
      this.room?.markCounterDirty?.(this)
    }

    return changed
  }

  /**
   * 从当前旧状态构造完整位置候选，供迁移期增量更新使用。
   */
  /** 只读展开当前可能位置：未决候选优先，否则返回确定位置；不写回候选或投影。 */
  getPossibleLocations(): readonly LocationCandidate[] {
    if (this.suspended || this.location === 'suspended') return []
    if (this.locationCandidates.length > 0) return this.locationCandidates
    if (this.location === 'player') return this.getResolvedLocationCandidates()
    const candidate = normalizeLocationCandidate({ type: 'public', zone: this.location })
    return candidate ? [candidate] : []
  }

  private getResolvedLocationCandidates(): LocationCandidate[] {
    if (this.location !== 'player' || this.owner === null) return []
    const candidate = fromSubZoneCandidate({
      seatID: this.owner,
      subZone: this.subZone ?? 'hand',
      spellID: this.subZone === 'mark' ? this.spellID : null
    })
    return candidate ? [candidate] : []
  }

  /**
   * 设置完整位置候选集合。
   */
  setLocationCandidates(
    candidates: readonly LocationCandidateInput[] = [],
    reason = 'setLocationCandidates'
  ): boolean {
    const uniqueCandidates = new Map<string, LocationCandidate>()
    candidates.forEach((candidate) => {
      const normalized = normalizeLocationCandidate(candidate)
      if (!normalized) return
      uniqueCandidates.set(createLocationCandidateKey(normalized), normalized)
    })

    const nextCandidates = Array.from(uniqueCandidates.values())

    // 单一玩家位置在写入事务内落定；投影同步不负责再次改写候选。
    if (nextCandidates.length === 1 && nextCandidates[0].type === 'player') {
      return this.resolveLocationCandidate(nextCandidates[0], reason)
    }

    const previousKeys = this.locationCandidates
      .map((candidate) => createLocationCandidateKey(candidate))
      .sort()
      .join('|')

    const nextKeys = nextCandidates
      .map((candidate) => createLocationCandidateKey(candidate))
      .sort()
      .join('|')

    const changed = previousKeys !== nextKeys

    if (!changed) return false

    // 替换候选集前捕获席位集合：收缩后剩余多个候选时不会走 resolveLocationCandidate，
    // 后续 setSeats 入口看到的已是收缩后的投影，被移除的座位只在这里可见。
    const previousSeats = this.seats
    this.storeLocationCandidates(nextCandidates)
    this.reconcileLocationStateFromCandidates(reason, previousSeats)

    this.room?.notifyCardChanged?.(this, {
      type: 'card-location-candidates-changed',
      reason,
      candidates: this.locationCandidates,
      previousSeats: Array.from(previousSeats)
    })

    return true
  }

  removeLocationCandidate(
    candidate: LocationCandidateInput | string,
    reason = 'removeLocationCandidate'
  ): boolean {
    const key = typeof candidate === 'string' ? candidate : createLocationCandidateKey(candidate)
    if (!key || !this.hasLocationCandidate(key)) return false

    const nextCandidates = this.locationCandidates.filter(
      (item) => createLocationCandidateKey(item) !== key
    )

    const [remainingCandidate] = nextCandidates
    if (nextCandidates.length === 1 && remainingCandidate.type === 'player') {
      return this.resolveLocationCandidate(remainingCandidate, `${reason}:singleRemaining`)
    }

    return this.setLocationCandidates(nextCandidates, reason)
  }

  /**
   * 将完整位置候选直接落定为当前卡牌位置。
   */
  resolveLocationCandidate(
    candidate: LocationCandidateInput,
    reason = 'resolveLocationCandidate'
  ): boolean {
    const normalized = normalizeLocationCandidate(candidate)
    if (!normalized) return false

    if (normalized.type === 'public') {
      this.moveToPublicZone(normalized.zone)
      return true
    }

    if (normalized.type !== 'player') return false

    const previousSubZone = this.subZone
    const previousSpellID = this.spellID
    const previousLocation = this.location
    const hadCandidates = this.hasLocationCandidates()
    // 清空候选前捕获席位集合：落定到他座时被收缩掉的座位不会出现在后续 setSeats 事件里。
    const previousSeats = this.seats

    // 明确绑定到玩家区前先清公共区引用，避免同一实体同时出现在牌堆/弃牌堆顺序中。
    this.room?.clearCardsFromPublicZones?.([this])
    this.location = 'player'
    this.subZone = normalized.subZone
    this.spellID = normalized.spellID
    this.storeLocationCandidates([])
    this.suspended = false
    this.syncTimestamp()
    const nextSeats = new Set([normalized.seatID])
    const seatsChanged = this.syncOwnerFromSeats(`${reason}:seat`, {
      previousSeats,
      nextSeats,
      nextResolvedSeat: normalized.seatID,
      seatsChanged:
        previousSeats.size !== nextSeats.size ||
        Array.from(previousSeats).some((seat) => !nextSeats.has(seat))
    })
    this.room?.markCounterDirty?.(this)
    const changed =
      hadCandidates ||
      previousLocation !== this.location ||
      previousSubZone !== this.subZone ||
      previousSpellID !== this.spellID ||
      seatsChanged

    if (changed) {
      this.room?.notifyCardChanged?.(this, {
        type: 'card-location-resolved',
        reason,
        candidate: normalized,
        previousSeats: Array.from(previousSeats)
      })
    }

    return changed
  }

  hasSubZoneCandidates(): boolean {
    return this.locationCandidates.some((candidate) => candidate.type === 'player')
  }

  /**
   * @param candidate 候选位置对象或候选位置 key
   */
  hasSubZoneCandidate(candidate: SubZoneCandidateInput | string): boolean {
    const key = typeof candidate === 'string' ? candidate : createSubZoneCandidateKey(candidate)
    if (!key) return false

    return this.locationCandidates.some(
      (item) => item.type === 'player' && createSubZoneCandidateKey(item) === key
    )
  }

  /**
   * 清空子区域候选。通常用于明确移动到公共区或已确定绑定到某个子区域。
   */
  clearSubZoneCandidates(reason = 'clearSubZoneCandidates'): boolean {
    const nextCandidates = this.locationCandidates.filter(
      (candidate) => candidate.type !== 'player'
    )
    if (nextCandidates.length === this.locationCandidates.length) return false

    return this.setLocationCandidates(nextCandidates, reason)
  }

  /**
   * 将完整位置候选直接落定为当前卡牌位置。
   */
  resolveSubZoneCandidate(
    candidate: SubZoneCandidateInput,
    reason = 'resolveSubZoneCandidate'
  ): boolean {
    return this.resolveLocationCandidate(fromSubZoneCandidate(candidate), reason)
  }

  /**
   * 绑定到指定玩家或候选玩家集合，但不默认改变明牌状态
   * @param seats 座位号或座位号数组
   * @param subZone 子区域
   * @param spellID 技能 ID
   * @param options 是否同时确认物理明牌
   */
  bindCandidates(
    seats: SeatInput,
    subZone: SubZone = 'hand',
    spellID: SpellID | null = null,
    options: BindOptions = {}
  ): void {
    const { known = false } = options
    const previousSeats = this.seats
    this.location = 'player'
    this.subZone = subZone
    this.spellID = spellID
    this.syncTimestamp()
    this.storeLocationCandidates([])
    this.suspended = false

    if (known) {
      this.confirmKnown()
    }

    this.setSeats(seats, 'bindCandidates')
    this.room?.markCounterDirty?.(this)
    // location/subZone/spellID 可能在 owner 不变时改变（如 equip→mark 同座位），
    // setSeats 此时不发席位事件；显式通知增量索引按新子区/技能重投影。
    this.room?.notifyCardChanged?.(this, {
      type: 'card-bound',
      subZone,
      spellID,
      previousSeats: Array.from(previousSeats)
    })
  }

  /**
   * 绑定到指定玩家或候选玩家集合，默认确认这张牌为明牌
   * @param seats 座位号或座位号数组
   * @param subZone 子区域
   * @param spellID 技能 ID
   */
  bindTo(
    seats: SeatInput,
    subZone: SubZone = 'hand',
    spellID: SpellID | null = null,
    options: BindOptions = {}
  ): void {
    this.bindCandidates(seats, subZone, spellID, { known: true, ...options })
  }

  /**
   * 移动到公共区域
   * @param destination 'outside' | 'pile' | 'discard' | 'exile' | 'process' | 'exchange'
   */
  moveToPublicZone(destination: PublicZoneName): void {
    const previous = this.capturePublicMigrationSnapshot()

    const seatsChanged = this.clearSeats(`moveToPublicZone:${destination}`)
    this.location = destination
    this.subZone = null
    this.spellID = null
    const candidatesChanged = this.clearSubZoneCandidates(`moveToPublicZone:${destination}`)
    this.storeLocationCandidates([])
    this.suspended = false
    this.syncTimestamp()

    // 移入弃牌堆或被销毁时，可以保留 isKnown=true，以方便记牌器反查
    if (destination === 'exile' || destination === 'outside') {
      this.isKnown = false
    }

    this.room?.markCounterDirty?.(this)

    this.notifyLeftPlayerZoneIfSilent(!seatsChanged && !candidatesChanged, previous, {
      type: 'card-moved-to-public-zone',
      destination
    })
  }

  /**
   * 获取对当前卡牌推断位置的友好中文描述（用于 Qcard 悬浮反查 title）
   * 代替原版高危递归 swap & findKZ 逻辑
   */
  getLocationDescription(): string {
    if (this.suspended) return '位置发散，暂停追踪'

    const ambiguousDescription = this.room?.ambiguousKnownIndex?.describe(this.id)
    if (ambiguousDescription) return ambiguousDescription

    if (this.location === 'outside') return '游戏外'
    if (this.location === 'pile') return '牌堆'
    if (this.location === 'discard') return '弃牌堆'
    if (this.location === 'exile') return '销毁'
    if (this.location === 'exchange') return '交换临时区'
    if (this.location === 'process') return '处理区'
    if (this.location === 'player') {
      const parts: string[] = []

      if (this.hasSubZoneCandidates()) {
        this.subZoneCandidates.forEach((candidate) => {
          const prefix = this.room.formatSeatPrefix(candidate.seatID)
          parts.push(`${prefix}${getSubZoneName(candidate.subZone)}`)
        })

        return parts.join('/')
      }

      this.seats.forEach((seatID) => {
        const prefix = this.room.formatSeatPrefix(seatID)
        parts.push(`${prefix}${getSubZoneName(this.subZone)}`)
      })

      return parts.join('/')
    }

    return '未知'
  }

  addPublicCandidate(candidate: PublicCandidate): boolean {
    const normalized = {
      zone: candidate.zone,
      label: candidate.label,
      position: candidate.position,
      count: candidate.count
    }
    const baseCandidates =
      this.locationCandidates.length > 0
        ? this.locationCandidates
        : this.getResolvedLocationCandidates()

    return this.setLocationCandidates(
      [...baseCandidates, fromPublicCandidate(normalized)].filter(Boolean),
      'addPublicCandidate'
    )
  }

  removePublicCandidates(predicate: (candidate: PublicCandidate | null) => boolean): boolean {
    if (!this.locationCandidates.some((candidate) => candidate.type === 'public')) return false

    const nextCandidates = this.locationCandidates.filter((candidate) => {
      if (candidate.type !== 'public') return true
      const publicCandidate = toPublicCandidate(
        candidate,
        (zone, position, count) => getPublicCandidateLabel(zone, position, count) ?? null
      )
      return !predicate(publicCandidate)
    })
    return this.setLocationCandidates(nextCandidates, 'removePublicCandidates')
  }

  /**
   * 清洗或重置状态
   */
  reset(): void {
    const previous = this.capturePublicMigrationSnapshot()

    const seatsChanged = this.clearSeats('reset')
    this.location = 'pile'
    this.subZone = null
    this.isKnown = false
    this.spellID = null
    this.storeLocationCandidates([])
    this.suspended = false
    this.turn = 0
    this.round = 0
    this.phase = 0
    this.room?.markCounterDirty?.(this)

    this.notifyLeftPlayerZoneIfSilent(!seatsChanged, previous, { type: 'card-reset' })
  }

  /**
   * 捕获离开玩家区前的状态快照，供 moveToPublicZone / reset 结束时判断是否补发 player 快照脏牌。
   */
  private capturePublicMigrationSnapshot(): PublicMigrationSnapshot {
    return {
      location: this.location,
      subZone: this.subZone,
      spellID: this.spellID,
      candidateCount: this.locationCandidates.length,
      suspended: this.suspended
    }
  }

  /**
   * 牌离开玩家区后，clearSeats/clearSubZoneCandidates 已发事件时无需重复补；仅无席位 player 牌
   * （如弹窗 mark）这类静默离场才在此补发 player 快照脏牌，纯公共区移动无 player 状态走 Zone dirty。
   * silent 分支意味着该牌本就无席位，owner/座位类字段恒为空，故不入事件。
   */
  private notifyLeftPlayerZoneIfSilent(
    silent: boolean,
    previous: PublicMigrationSnapshot,
    detail: Record<string, unknown>
  ): void {
    if (!silent) return

    const needsCardDirty =
      previous.location === 'player' ||
      previous.subZone !== null ||
      previous.spellID !== null ||
      previous.candidateCount > 0 ||
      previous.suspended !== this.suspended

    if (!needsCardDirty) return

    this.room?.notifyCardChanged?.(this, {
      ...detail,
      previousLocation: previous.location,
      previousSubZone: previous.subZone,
      previousSpellID: previous.spellID
    })
  }
}
