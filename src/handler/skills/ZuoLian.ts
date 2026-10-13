import type { CardID, SeatID } from '@/tracker/types'
import type { SkillMoveContext } from './types'

interface ZuoLianState {
  [seatID: SeatID]: CardID
  stack?: CardID
}

export default function handleZuoLian(context: SkillMoveContext): void {
  const { game, patched } = context

  // 在手牌中展示
  if (patched.FromZone === 5 && patched.ToZone === 5 && patched.MoveType === 21) {
    const positiveIDs = patched.CardIDs.filter((id) => id > 0)

    if (positiveIDs.length === 1) {
      const spellState = game.ensureSpellState<ZuoLianState>(patched.SpellID, () => ({}))
      spellState[patched.FromID] = positiveIDs[0]
    }

    return
  }

  // 从手牌中移动到交换区
  if (patched.FromZone === 5 && patched.ToZone === 10 && patched.MoveType === 11) {
    const spellState = game.ensureSpellState<ZuoLianState>(patched.SpellID, () => ({}))
    const knownCardID = patched.CardIDs.find((id) => id > 0)
    const cardID = knownCardID || spellState[patched.FromID]

    delete spellState[patched.FromID]

    if (!(cardID > 0)) {
      delete spellState.stack
      return
    }

    if (!knownCardID) patched.CardIDs[0] = cardID
    spellState.stack = cardID

    return
  }

  // 交换区返回牌堆顶
  if (
    patched.FromZone === 10 &&
    (patched.ToZone === 1 || patched.ToZone === 2) &&
    patched.MoveType === 11
  ) {
    const spellState = game.getSpellState<ZuoLianState>(patched.SpellID)
    const cardID = spellState?.stack

    if (!patched.CardIDs.some((id) => id > 0) && cardID > 0) patched.CardIDs[0] = cardID
    if (spellState) delete spellState.stack
  }
}
