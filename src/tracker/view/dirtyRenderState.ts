import type { Card } from '../Card'
import type { DirtyCardEvent, Room } from '../Room'
import type { SeatID } from '../types'

interface DirtyRenderState {
  shouldRenderPanels: boolean
  shouldRenderAllPlayers: boolean
  affectedSeatIDs: Set<SeatID>
  consumedEventCount: number
  overflowed: boolean
  latestSeq: number
}

const dirtyCardCursors = new WeakMap<Room, number>()
const forceFullPlayerRenderRooms = new WeakSet<Room>()

export function markFullPlayerRender(room: Room): void {
  forceFullPlayerRenderRooms.add(room)
}

export function collectDirtyRenderState(room: Room): DirtyRenderState {
  const lastSeq = dirtyCardCursors.get(room) ?? 0
  const latestSeq = room.dirtyCardSeq
  const forcedFullRender = forceFullPlayerRenderRooms.has(room)

  let events: DirtyCardEvent[] = []
  let overflowed = false

  if (latestSeq > lastSeq) {
    const firstEventSeq = room.dirtyCardEvents[0]?.seq
    const hasLostEvents = room.dirtyCardEvents.length === 0 || firstEventSeq > lastSeq + 1

    if (hasLostEvents) {
      overflowed = true
    } else {
      events = room.dirtyCardEvents.filter((event) => event.seq > lastSeq)
    }
  }

  const affectedSeatIDs = new Set<SeatID>()
  events.forEach((event) => {
    collectAffectedSeatsFromDetail(event.detail, affectedSeatIDs)
    collectAffectedSeatsFromCard(event.card, affectedSeatIDs)
  })

  const hasCardChanges = latestSeq > lastSeq
  const shouldRenderPanels = room.viewDirty || hasCardChanges
  const shouldRenderAllPlayers = forcedFullRender || overflowed

  return {
    shouldRenderPanels,
    shouldRenderAllPlayers,
    affectedSeatIDs,
    consumedEventCount: events.length,
    overflowed,
    latestSeq
  }
}

export function finishDirtyRender(
  room: Room,
  renderState?: Pick<DirtyRenderState, 'latestSeq'>
): void {
  dirtyCardCursors.set(room, renderState?.latestSeq ?? room.dirtyCardSeq)
  forceFullPlayerRenderRooms.delete(room)
  room.viewDirty = false
}

const keys = [
  'previousResolvedSeat',
  'nextResolvedSeat',
  'previousOwner',
  'nextOwner',
  'seatID',
  'fromSeatID'
]

function collectAffectedSeatsFromDetail(
  detail: Record<string, unknown> | null | undefined,
  affectedSeatIDs: Set<SeatID>
): void {
  if (!detail) return

  keys.forEach((key) => addSeat(detail[key], affectedSeatIDs))

  // 候选收缩时被移除的座位只存在于变更前席位集合，卡牌当前状态已看不到它。
  if (Array.isArray(detail.previousSeats)) {
    detail.previousSeats.forEach((seatID) => addSeat(seatID, affectedSeatIDs))
  }
}

function collectAffectedSeatsFromCard(card: Card, affectedSeatIDs: Set<SeatID>): void {
  addSeat(card.owner, affectedSeatIDs)
  addSeat(card.resolvedSeat, affectedSeatIDs)

  card.seats.forEach((seatID) => addSeat(seatID, affectedSeatIDs))
  card.subZoneCandidates.forEach((candidate) => addSeat(candidate.seatID, affectedSeatIDs))

  card.getLocationCandidates?.().forEach((candidate) => {
    if (candidate.type === 'player') addSeat(candidate.seatID, affectedSeatIDs)
  })
}

function addSeat(value: unknown, affectedSeatIDs: Set<SeatID>): void {
  if (typeof value !== 'number' || !Number.isFinite(value) || value === 255) return
  affectedSeatIDs.add(value)
}
