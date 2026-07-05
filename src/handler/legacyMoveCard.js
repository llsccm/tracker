import { Card, cardManager, Zone } from '../context'
import { Game } from '../tracker/Game'
import { POSITION_RANDOM } from '../tracker/candidate/cardPositions'
import { handleLegacyChengLieMove } from './old/handleLegacyChengLieMove'
import { handleLegacyJieLiMove } from './old/handleLegacyJieLiMove'
import { handleLegacyWenGuaMove } from './old/handleLegacyWenGuaMove'

export function handleLegacyMoveCard(move, branch = 'normal') {
  const {
    CardIDs,
    CardCount,
    FromID,
    FromZone,
    FromPosition,
    FromZoneParam,
    ToID,
    ToZone,
    ToPosition,
    ToZoneParam,
    MoveType,
    SpellID
  } = move

  const from = new Zone(FromID, FromZone, FromPosition, CardCount, SpellID, FromZoneParam)
  const to = new Zone(ToID, ToZone, ToPosition, CardCount, SpellID, ToZoneParam)

  switch (branch) {
    case 'recycle':
      handleLegacyRecycleMove({ CardIDs, CardCount, FromZone, SpellID, from, to })
      return

    case 'hunyuanRandomBottom':
      to.pos = POSITION_RANDOM
      to.add(
        CardIDs.concat(Array(CardCount - CardIDs.length).fill(0)).map(
          (id) => new Card(0, id, to.zoneID)
        )
      )
      return

    case 'initialPile':
      to.add(
        CardIDs.concat(Array(CardCount - CardIDs.length).fill(0)).map(
          (id) => new Card(Game.isGameStart ? 0 : id, id, to.zoneID)
        )
      )
      return

    case 'mulliganReturn':
      handleLegacyMulliganReturn({ CardIDs, from, to })
      return

    case 'shuffleDiscard':
      handleLegacyShuffleDiscard({ from, to })
      return

    default:
      handleLegacyPhysicalMove({
        CardIDs,
        CardCount,
        FromID,
        FromZone,
        FromPosition,
        FromZoneParam,
        ToID,
        ToZone,
        ToPosition,
        ToZoneParam,
        MoveType,
        SpellID,
        from,
        to
      })
  }
}

function handleLegacyRecycleMove({ CardIDs, CardCount, FromZone, SpellID, from, to }) {
  if (to.zone !== 12) {
    to.add(
      CardIDs.concat(Array(CardCount - CardIDs.length).fill(0)).map(
        (id) => new Card(id, id, to.zoneID)
      )
    )
  } else if (FromZone != 12 && FromZone != 0) {
    cardManager.move(from.remove(CardIDs, SpellID), to.zoneID)
  }
}

function handleLegacyMulliganReturn({ CardIDs, from, to }) {
  const key = cardManager.pack(to.cards, true)

  to.add(
    from.remove(CardIDs.filter((id) => id > 0)).map((card) => {
      if (key == 0) {
        card.destroy(key)
      } else {
        card.create(key)
        card.plot(true)
      }
      return card
    })
  )

  Zone.draw(from.zoneID)
}

function handleLegacyShuffleDiscard({ from, to }) {
  if (Game.isGameStart && !Game.isPassed) {
    cardManager.pack(
      cardManager.get(0).map((card) => card.destroy()),
      false,
      1
    )
  }

  to.set([
    ...to.cards.map((card) => (Game.isPassed ? card.destroy(0) : card)),
    ...from.cards.map((card) => card.destroy(0))
  ])

  from.set([])
}

function handleLegacyPhysicalMove({
  CardIDs,
  CardCount,
  FromID,
  FromZone,
  FromPosition,
  ToZone,
  SpellID,
  from,
  to
}) {
  switch (SpellID) {
    // 马承 【骋烈】
    case 3208:
      handleLegacyChengLieMove({ CardIDs, FromZone, ToZone, SpellID, from, to })
      break

    // 族钟繇 【诫厉】
    case 3483:
      handleLegacyJieLiMove({
        CardIDs,
        CardCount,
        FromZone,
        ToZone,
        FromPosition,
        SpellID,
        from,
        to
      })
      break

    // 徐氏 【问卦】
    case 780:
      handleLegacyWenGuaMove({
        CardIDs,
        CardCount,
        FromID,
        FromZone,
        ToZone,
        FromPosition,
        SpellID,
        from,
        to
      })
      break
  }
}
