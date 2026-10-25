import type { Room } from '../Room'
import type { CardID, PatchedMoveCardFields } from '../types'
import { defineStoredCardsPlugin, recordSharedCardIDs } from './storedCardsPlugin'

export const zeXingPlugin = defineStoredCardsPlugin({
  id: 'zeXing',
  spellIDs: [3854],
  prepare: handleZeXing,
  record: recordSharedCardIDs
})

function handleZeXing(patched: PatchedMoveCardFields, room: Room): void {
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
