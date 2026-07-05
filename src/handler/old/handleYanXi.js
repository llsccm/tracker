import { CardConfig } from '../config'
import { cardManager, Zone } from '../context'
import { Game } from '@/tracker'
import { tracker } from '@/tracker/runtime/browser'

function getTrackerRoom() {
  return tracker.getReadyTrackerRoom()
}

function getTrackedPileCardIDs() {
  return getTrackerRoom()?.publicZones.getPileCardIDs() ?? new Zone(255, 1).cards.map(({ key }) => key)
}

function getTrackedCardLocationKeys(cardID) {
  return getTrackerRoom()?.getCardLocationInfo(cardID).keys ?? cardManager.findKZ(cardID).keys
}

function getTrackedPlayerHandCardIDs(seatID) {
  return (
    getTrackerRoom()?.getPlayerHandCardIDs(seatID) ??
    new Zone(seatID).cards.map(({ key }) => key).filter((id) => id > 0)
  )
}

/**
 * 王元姬 识人 宴戏 辅助逻辑
 */
export default function handleYanXi(SpellID, Param, Params) {
  Game.setSpellState(SpellID, Params.slice())
  const spKeys = Array.from(new Set(getTrackedPlayerHandCardIDs(Param))).sort((a, b) => b - a)

  const pdSet = new Set(getTrackedPileCardIDs().slice(0, Game.isGuoZhan ? undefined : 2))

  const pdKeys = Array.from(pdSet).sort((a, b) => b - a)

  let { yes, no } = Params.reduce(
    (acc, id) => {
      const keys = getTrackedCardLocationKeys(id)
      if (spKeys.find((k) => keys.includes(k)) !== undefined) acc.yes.push(id)
      if (pdKeys.find((k) => keys.includes(k)) !== undefined) acc.no.push(id)
      return acc
    },
    { yes: [], no: [] }
  )

  const resDiv = document.getElementById('result')

  if (no.length == 2) {
    yes = Params.filter((id) => !no.includes(id))
  } else if (yes.length == 1) {
    no = Params.filter((id) => !yes.includes(id))
  }

  if (yes.length == 1 || yes.length == 2) {
    resDiv.innerHTML =
      '<span class="textRes">【宴戏】' +
      yes.map((id) => CardConfig.GetInstance().getCard(id).ncn).join('/') +
      '</span>'
    Game.setSpellState(SpellID, yes.concat(Params.filter((id) => !yes.includes(id))))
  } else {
    resDiv.innerHTML = '<span class="textRes">【宴戏】未知</span>'
  }

  const spellCards = Game.getSpellState(SpellID)
  const cards = new Zone(Param)
    .show(spellCards[0])
    .concat(new Zone(255, 1, Game.isGuoZhan ? Zone.RAND : Zone.DING).show(spellCards.slice(-2)))

  const trackerRoom = getTrackerRoom()

  if (trackerRoom) {
    const trackerCards = cards.map((card) => card.refactorCard).filter(Boolean)
    const createGroup = (groupCards) => {
      if (groupCards.length === 0) return
      trackerRoom.createConstraintGroup({
        id: `yanxi_${SpellID}_${++trackerRoom.constraintGroupSeq}`,
        cards: groupCards,
        known: true,
        sourceEvent: {
          type: 'yanxi',
          raw: { SpellID, Param, Params: Params.slice(), yes: yes.slice(), no: no.slice() }
        }
      })
    }

    if (yes.length == 3) {
      createGroup(trackerCards)
    } else if (yes.length == 1) {
      createGroup(trackerCards.slice(1, 3))
    } else if (yes.length == 2) {
      createGroup(trackerCards.slice(0, 2))
      createGroup(trackerCards.slice(1, 3))
    }

    trackerRoom.resolveConstraints()
  } else {
    if (yes.length == 3) {
      cardManager.pack(cards)
    } else if (yes.length == 1) {
      cardManager.pack(cards.slice(1, 3))
    } else if (yes.length == 2) {
      cardManager.pack(cards.slice(0, 2))
      cardManager.pack(cards.slice(1, 3))
    }
  }

  Params.forEach((id) => {
    resDiv.innerHTML +=
      '<span class="textRes' +
      (yes.length < 3 && yes.includes(id) ? ' textRes' : '') +
      '">' +
      CardConfig.GetInstance().getCard(id).ncn +
      '：' +
      [
        [yes, '手牌'],
        [no, '牌堆']
      ]
        .filter(([arr]) => arr.includes(id))
        .map(([_, str]) => str)
        .join('/') +
      '</span><br>'
  })
}
