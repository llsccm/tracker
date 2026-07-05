import { BaseCard } from './BaseCard'
import { createSubZoneCandidateKey, getSubZoneName } from './candidate/subZoneCandidate'
import {
  createLocationCandidateKey,
  fromPublicCandidate,
  fromSubZoneCandidate,
  getContainerLocationCandidates,
  getPlayerLocationCandidates,
  getPublicLocationCandidates,
  normalizeLocationCandidate,
  projectSeatsFromLocationCandidates,
  toPublicCandidate,
  toSubZoneCandidate
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

/**
 * 重构版卡牌实体类
 * 放弃双向链表，采用状态标记与座位候选集绑定机制
 */
export class Card extends BaseCard {
  declare room: Room
  declare location: CardLocation
  declare subZone: SubZone | null
  declare isKnown: boolean
  declare spellID: SpellID | null
  declare turn: number
  declare round: number
  declare phase: number
  declare owner: SeatID | null
  declare locationCandidates: LocationCandidate[]
  declare suspended: boolean
  declare combinationID: string | number | null

  /**
   * @param id - 卡牌 ID
   * @param room - 所属 Room 引用
   */
  constructor(id: CardID, room: Room) {
    super(id) // 内部由 BaseCard 自动通过 CardConfig 单例拉取 cardInfo
    this.room = room

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
    // 它和 seats 并列存在，避免“owner 已确定”被误解成“子区域已确定”。
    this.locationCandidates = []
    this.suspended = false // 候选席位过度发散时暂停追踪

    // 3. 嵌套组合指纹 (同生共死关系)
    this.combinationID = null // 局部约束组 ID，用于记录这张牌参与的最近一次模糊分组
  }

  get resolvedSeat(): SeatID | null {
    if (this.location !== 'player' || this.seats.size !== 1) return null
    return this.seats.values().next().value ?? null
  }

  get seats(): Set<SeatID> {
    // 迁移期兼容读面：seats 只是完整位置候选的座位投影，不再独立承载状态。
    const candidateSeats = projectSeatsFromLocationCandidates(this.locationCandidates)
    if (candidateSeats.size > 0) return candidateSeats
    if (this.location === 'player' && this.owner !== null) return new Set([this.owner])
    return new Set()
  }

  get subZoneCandidates(): SubZoneCandidate[] {
    // 迁移期兼容读面：玩家子区域候选只从完整位置主模型投影，不再独立存储。
    return getPlayerLocationCandidates(this.locationCandidates)
      .map((candidate) => toSubZoneCandidate(candidate))
      .filter((candidate): candidate is SubZoneCandidate => Boolean(candidate))
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
    if (this.seats.size !== nextSeats.size) return false
    return Array.from(nextSeats).every((seat) => this.seats.has(seat))
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

  syncOwnerFromSeats(reason = 'syncOwnerFromSeats', change: SeatChangeSnapshot = {}): boolean {
    const previousOwner = change.previousOwner ?? this.owner
    const previousResolvedSeat =
      change.previousResolvedSeat !== undefined ? change.previousResolvedSeat : previousOwner
    const currentSeats = change.nextSeats ?? this.seats
    // 无显式快照时席位集合未发生变化，变更前集合即当前集合。
    const previousSeats = change.previousSeats ?? currentSeats
    const previousSeatSize = change.previousSeatSize ?? currentSeats.size
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

  setSeats(nextSeats: SeatInput, reason = 'setSeats'): boolean {
    const normalizedSeats = this.normalizeSeats(nextSeats)
    const previousOwner = this.owner
    const previousResolvedSeat = this.resolvedSeat
    // 入口捕获变更前席位集合：候选收缩时被移除的座位只在这里可见。
    const previousSeats = this.seats
    const previousSeatSize = previousSeats.size
    const seatsChanged = !this.hasSameSeats(normalizedSeats)
    let subZoneCandidatesChanged = false
    let resolvedSubZoneCandidate = null
    let nextProjectedSeats = new Set(normalizedSeats)

    if (this.subZoneCandidates.length > 0) {
      // seats 收敛时只剔除对应角色的位置候选。
      // 例如 A 手牌 / B 手牌 / A 标记排除 B 后，应保留 A 手牌 / A 标记。
      const filteredCandidates = this.subZoneCandidates.filter((candidate) =>
        normalizedSeats.has(candidate.seatID)
      )
      let filteredLocationCandidates: LocationCandidate[] = []
      let locationCandidatesChanged = false
      if (this.locationCandidates.length > 0) {
        filteredLocationCandidates = this.locationCandidates.filter(
          (candidate) => candidate.type !== 'player' || normalizedSeats.has(candidate.seatID)
        )
        locationCandidatesChanged =
          filteredLocationCandidates.length !== this.locationCandidates.length
      }

      const remainingLocationCandidateCount =
        this.locationCandidates.length > 0
          ? filteredLocationCandidates.length
          : filteredCandidates.length
      subZoneCandidatesChanged = filteredCandidates.length !== this.subZoneCandidates.length

      if (filteredCandidates.length === 1 && remainingLocationCandidateCount === 1) {
        // 只有完整位置候选也只剩一个时，才真正落定子区域。
        resolvedSubZoneCandidate = filteredCandidates[0]
      } else if (subZoneCandidatesChanged || locationCandidatesChanged) {
        if (locationCandidatesChanged) {
          this.locationCandidates = filteredLocationCandidates
        }
      }

      nextProjectedSeats = projectSeatsFromLocationCandidates(this.locationCandidates)
    } else if (this.location === 'player' && normalizedSeats.size > 1) {
      const subZone = this.subZone ?? 'hand'
      const spellID = subZone === 'mark' ? this.spellID : null
      this.locationCandidates = Array.from(normalizedSeats)
        .map((seatID) => fromSubZoneCandidate({ seatID, subZone, spellID }))
        .filter((candidate): candidate is PlayerLocationCandidate => Boolean(candidate))
      subZoneCandidatesChanged = this.locationCandidates.length > 0
      nextProjectedSeats = projectSeatsFromLocationCandidates(this.locationCandidates)
    }

    if (resolvedSubZoneCandidate) {
      this.subZone = resolvedSubZoneCandidate.subZone
      this.spellID = resolvedSubZoneCandidate.spellID
      this.locationCandidates = []
      this.syncTimestamp()
      nextProjectedSeats = new Set([resolvedSubZoneCandidate.seatID])
    }

    const candidatesChanged = subZoneCandidatesChanged || Boolean(resolvedSubZoneCandidate)

    if (subZoneCandidatesChanged) {
      this.room?.notifyCardChanged?.(this, {
        type: 'card-subzone-candidates-filtered',
        reason,
        candidates: this.subZoneCandidates
      })
    }

    const ownerChanged = this.syncOwnerFromSeats(reason, {
      previousOwner,
      previousResolvedSeat,
      previousSeatSize,
      previousSeats,
      nextResolvedSeat:
        this.location === 'player' && nextProjectedSeats.size === 1
          ? (nextProjectedSeats.values().next().value ?? null)
          : null,
      nextSeats: nextProjectedSeats,
      seatsChanged
    })

    return candidatesChanged || ownerChanged
  }

  addSeat(seat: SeatInput, reason = 'addSeat'): boolean {
    const normalizedSeats = this.normalizeSeats(seat)
    if (normalizedSeats.size === 0) return false

    const nextSeats = new Set(this.seats)
    normalizedSeats.forEach((seatID) => nextSeats.add(seatID))
    return this.setSeats(nextSeats, reason)
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

  getLocationCandidates(): LocationCandidate[] {
    return this.locationCandidates.slice()
  }

  hasLocationCandidate(candidate: LocationCandidateInput | string): boolean {
    const key = typeof candidate === 'string' ? candidate : createLocationCandidateKey(candidate)
    if (!key) return false

    return this.locationCandidates.some((item) => createLocationCandidateKey(item) === key)
  }

  /**
   * 从 locationCandidates 同步旧字段，保证旧视图和旧约束仍可读。
   */
  syncLegacyCandidatesFromLocationCandidates(
    reason = 'syncLegacyCandidatesFromLocationCandidates'
  ): boolean {
    const playerCandidates = getPlayerLocationCandidates(this.locationCandidates)
      .map((candidate) => toSubZoneCandidate(candidate))
      .filter(Boolean)

    const publicCandidates = getPublicLocationCandidates(this.locationCandidates)
      .map((candidate) =>
        toPublicCandidate(
          candidate,
          (zone, position, count) => getPublicCandidateLabel(zone, position, count) ?? null
        )
      )
      .filter(Boolean)

    const containerCandidates = getContainerLocationCandidates(this.locationCandidates)

    const previousSubZoneKeys = this.subZoneCandidates
      .map((candidate) => createSubZoneCandidateKey(candidate))
      .sort()
      .join('|')

    const nextSubZoneKeys = playerCandidates
      .map((candidate) => createSubZoneCandidateKey(candidate))
      .sort()
      .join('|')

    const previousPublicKeys = this.publicCandidates
      .map((candidate) => JSON.stringify(candidate))
      .sort()
      .join('|')

    const nextPublicKeys = publicCandidates
      .map((candidate) => JSON.stringify(candidate))
      .sort()
      .join('|')

    const previousLocation = this.location
    let changed = previousSubZoneKeys !== nextSubZoneKeys || previousPublicKeys !== nextPublicKeys

    // 玩家/容器候选都属于玩家相关区域，不能继续残留在公共 Zone 被后续摸牌再次取到。
    if (
      (playerCandidates.length > 0 || containerCandidates.length > 0) &&
      publicCandidates.length === 0
    ) {
      this.room?.clearCardsFromPublicZones?.([this])
    }

    if (playerCandidates.length > 0 || containerCandidates.length > 0) {
      this.location = 'player'
      changed = previousLocation !== this.location || changed
      this.syncTimestamp()

      const candidateSeats = projectSeatsFromLocationCandidates(this.locationCandidates)
      if (candidateSeats.size > 0) {
        changed = this.setSeats(candidateSeats, `${reason}:seats`) || changed
      } else if (this.seats.size > 0 || this.owner !== null) {
        // 容器候选不直接归属某个 seat，owner 只由容器投影阶段解释。
        changed = this.clearSeats(`${reason}:seats`) || changed
      }
    } else if (this.seats.size > 0 || this.owner !== null) {
      changed = this.clearSeats(`${reason}:seats`) || changed
    }

    if (changed) {
      this.room?.markCounterDirty?.(this)
    }

    return changed
  }

  /**
   * 从当前旧状态构造完整位置候选，供迁移期增量更新使用。
   */
  getLegacyLocationCandidates(): LocationCandidate[] {
    const playerCandidates =
      this.subZoneCandidates.length > 0
        ? this.subZoneCandidates.map((candidate) => fromSubZoneCandidate(candidate))
        : this.location === 'player'
          ? Array.from(this.seats).map((seatID) =>
              fromSubZoneCandidate({
                seatID,
                subZone: this.subZone ?? 'hand',
                spellID: this.subZone === 'mark' ? this.spellID : null
              })
            )
          : []

    const publicCandidates = this.publicCandidates.map((candidate) =>
      fromPublicCandidate(candidate)
    )

    return [...playerCandidates, ...publicCandidates].filter(Boolean)
  }

  /**
   * 设置完整位置候选集合。
   */
  setLocationCandidates(
    candidates: LocationCandidateInput[] = [],
    reason = 'setLocationCandidates'
  ): boolean {
    const uniqueCandidates = new Map<string, LocationCandidate>()
    candidates.forEach((candidate) => {
      const normalized = normalizeLocationCandidate(candidate)
      if (!normalized) return
      uniqueCandidates.set(createLocationCandidateKey(normalized), normalized)
    })

    const nextCandidates = Array.from(uniqueCandidates.values())

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
    this.locationCandidates = nextCandidates
    this.syncLegacyCandidatesFromLocationCandidates(reason)

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
    if (
      nextCandidates.length === 1 &&
      normalizeLocationCandidate(remainingCandidate)?.type === 'player'
    ) {
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
    const hadCandidates = this.subZoneCandidates.length > 0 || this.locationCandidates.length > 0
    // 清空候选前捕获席位集合：落定到他座时被收缩掉的座位不会出现在后续 setSeats 事件里。
    const previousSeats = this.seats

    // 明确绑定到玩家区前先清公共区引用，避免同一实体同时出现在牌堆/弃牌堆顺序中。
    this.room?.clearCardsFromPublicZones?.([this])
    this.location = 'player'
    this.subZone = normalized.subZone
    this.spellID = normalized.spellID
    this.locationCandidates = []
    this.suspended = false
    this.syncTimestamp()
    const seatsChanged = this.setSeats([normalized.seatID], `${reason}:seat`)
    this.room?.markCounterDirty?.(this)
    const changed =
      hadCandidates ||
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
    return this.subZoneCandidates.length > 0
  }

  getSubZoneCandidates(): SubZoneCandidate[] {
    return this.subZoneCandidates.slice()
  }

  /**
   * @param candidate 候选位置对象或候选位置 key
   */
  hasSubZoneCandidate(candidate: SubZoneCandidateInput | string): boolean {
    const key = typeof candidate === 'string' ? candidate : createSubZoneCandidateKey(candidate)
    if (!key) return false

    return this.subZoneCandidates.some((item) => createSubZoneCandidateKey(item) === key)
  }

  /**
   * 设置完整位置候选集合。
   * @returns 是否发生变化
   */
  setSubZoneCandidates(
    candidates: SubZoneCandidateInput[] = [],
    reason = 'setSubZoneCandidates'
  ): boolean {
    const publicCandidates = this.publicCandidates.map((candidate) =>
      fromPublicCandidate(candidate)
    )
    const playerCandidates = candidates.map((candidate) => fromSubZoneCandidate(candidate))

    return this.setLocationCandidates(
      [...publicCandidates, ...playerCandidates].filter(Boolean),
      reason
    )
  }

  addSubZoneCandidate(candidate: SubZoneCandidateInput, reason = 'addSubZoneCandidate'): boolean {
    return this.setSubZoneCandidates([...this.subZoneCandidates, candidate], reason)
  }

  /**
   * 移除一个完整位置候选；若只剩一个候选，则自动落定到该位置。
   */
  removeSubZoneCandidate(
    candidate: SubZoneCandidateInput | string,
    reason = 'removeSubZoneCandidate'
  ): boolean {
    const key = typeof candidate === 'string' ? candidate : createSubZoneCandidateKey(candidate)
    if (!key || !this.hasSubZoneCandidate(key)) return false

    if (this.locationCandidates.length > 0) {
      const target = this.subZoneCandidates.find((item) => createSubZoneCandidateKey(item) === key)
      return this.removeLocationCandidate(fromSubZoneCandidate(target), reason)
    }

    const nextCandidates = this.subZoneCandidates.filter(
      (item) => createSubZoneCandidateKey(item) !== key
    )

    if (nextCandidates.length === 1) {
      return this.resolveSubZoneCandidate(nextCandidates[0], `${reason}:singleRemaining`)
    }

    return this.setSubZoneCandidates(nextCandidates, reason)
  }

  /**
   * 清空子区域候选。通常用于明确移动到公共区或已确定绑定到某个子区域。
   */
  clearSubZoneCandidates(reason = 'clearSubZoneCandidates'): boolean {
    const hadPlayerLocationCandidates = this.locationCandidates.some(
      (candidate) => candidate.type === 'player'
    )
    if (this.subZoneCandidates.length === 0 && !hadPlayerLocationCandidates) return false

    if (hadPlayerLocationCandidates) {
      this.locationCandidates = this.locationCandidates.filter(
        (candidate) => candidate.type !== 'player'
      )
      this.syncLegacyCandidatesFromLocationCandidates(`${reason}:locationCandidates`)
    }
    this.room?.notifyCardChanged?.(this, {
      type: 'card-subzone-candidates-cleared',
      reason
    })

    return true
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
    this.location = 'player'
    this.subZone = subZone
    this.spellID = spellID
    this.syncTimestamp()
    this.clearSubZoneCandidates('bindCandidates')
    this.locationCandidates = []
    this.suspended = false

    if (known) {
      this.confirmKnown()
    }

    this.setSeats(seats, 'bindCandidates')
    this.room?.markCounterDirty?.(this)
    // location/subZone/spellID 可能在 owner 不变时改变（如 equip→mark 同座位），
    // setSeats 此时不发席位事件；显式通知增量索引按新子区/技能重投影。
    this.room?.notifyCardChanged?.(this, { type: 'card-bound', subZone, spellID })
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
    this.combinationID = null
    this.spellID = null
    const candidatesChanged = this.clearSubZoneCandidates(`moveToPublicZone:${destination}`)
    this.locationCandidates = []
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
        : this.getLegacyLocationCandidates()

    return this.setLocationCandidates(
      [...baseCandidates, fromPublicCandidate(normalized)].filter(Boolean),
      'addPublicCandidate'
    )
  }

  removePublicCandidates(predicate: (candidate: PublicCandidate | null) => boolean): boolean {
    const baseCandidates =
      this.locationCandidates.length > 0
        ? this.locationCandidates
        : this.getLegacyLocationCandidates()
    if (!baseCandidates.some((candidate) => candidate.type === 'public')) return false

    const nextCandidates = baseCandidates.filter((candidate) => {
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
    this.combinationID = null
    this.spellID = null
    this.locationCandidates = []
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
