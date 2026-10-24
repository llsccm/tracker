import type { Room } from '../Room'
import type { CardID, PatchedMoveCardFields } from '../types'
import { defineStoredCardsPlugin, recordSharedCardIDs } from './storedCardsPlugin'

export const qingYiLianJuPlugin = defineStoredCardsPlugin({
  id: 'qingYiLianJu',
  spellIDs: [3157, 3511],
  prepare: handleQingYiLianJu,
  record: recordSharedCardIDs
})

function handleQingYiLianJu(patched: PatchedMoveCardFields, room: Room): void {
  const spellCards = room.readSkillState<CardID[]>(patched.SpellID)
  if (
    patched.FromZone == 2 &&
    patched.ToZone == 5 &&
    patched.CardCount == spellCards?.length &&
    patched.CardIDs.filter((id) => id > 0).length == 0
  ) {
    spellCards.forEach((id, i) => {
      patched.CardIDs[i] = id
    })
    room.deleteSkillState(patched.SpellID)
  }
}
