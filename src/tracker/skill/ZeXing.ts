import type { CardID } from '@/tracker/types'
import type { Room } from '../Room'
import type { PatchedMoveCardFields } from '../types'

export default function handleZeXing(patched: PatchedMoveCardFields, room: Room): void {
  const spellCards = room.readSkillState<CardID[]>(patched.SpellID)

  if (
    patched.FromZone == 5 &&
    patched.ToZone == 5 &&
    patched.CardCount == spellCards?.length &&
    patched.CardIDs.filter((id) => id > 0).length == 0
  ) {
    patched.CardIDs = [...spellCards]
    room.deleteSkillState(patched.SpellID)
  }
}
