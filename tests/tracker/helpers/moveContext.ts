import type { PatchedMoveCardFields, RawMoveCardEvent } from '@/tracker/types'
import { protocolMove } from './trackerController'

export function moveContext(fields: Partial<RawMoveCardEvent> = {}): {
  raw: Readonly<RawMoveCardEvent>
  patched: PatchedMoveCardFields
} {
  const move = protocolMove(fields)
  const raw = Object.freeze({ ...move, CardIDs: Object.freeze([...move.CardIDs]) })
  return { raw, patched: { ...raw, CardIDs: [...raw.CardIDs] } }
}
