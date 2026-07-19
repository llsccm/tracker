import { destroyPeiXiuMapWindow } from '@/ui/PeiXiuMapWindow'
import { CardConfig } from '../config'
import { drawYanJiao, drawYiCheng } from '../draw'
import { Game, globalConfig } from '../tracker'
import { tracker } from '../tracker/runtime/browser'
// import handleYanXi from './handleYanXi'

function getTrackedPlayerHandCardIDs(seatID) {
  return tracker.getReadyTrackerRoom()?.getPlayerHandCardIDs(seatID) ?? []
}

function revealPlayerHandCards(seatID, cardIDs, options = {}) {
  tracker.revealTrackerCards({ type: 'player', seatID, ...options }, cardIDs)
}

function revealPileCards(cardIDs) {
  // 看牌堆消息不仅公开牌面，也确认这些实体位于牌堆端点。
  tracker.revealTrackerCards(
    {
      type: 'public',
      zoneName: 'pile',
      reposition: true,
      cardIDsTopFirst: true
    },
    cardIDs
  )
}

function revealTargetCards(seatID, cardIDs) {
  if (Number(seatID) === 255) {
    revealPileCards(cardIDs)
  } else {
    revealPlayerHandCards(seatID, cardIDs)
  }
}

// 部分手牌协议在 handCount 恰好等于目标整手数时，应按 fullHand 同步。
// 优先信观测手牌数；没有观测时才退回本地手牌实体数。
function shouldRevealAsFullHand(seatID, handCount) {
  const count = Number(handCount) || 0
  if (count <= 0) return false

  const room = tracker.getReadyTrackerRoom()
  if (!room) return false

  const player = room.getPlayer?.(seatID)
  if (player?.hasObservedHandCount === true) {
    return count === Number(player.observedHandCount)
  }

  const handCards =
    typeof room.refreshPlayerSnapshot === 'function'
      ? room
          .refreshPlayerSnapshot()
          .filter((card) => card.subZone === 'hand' && card.seats?.has?.(Number(seatID)))
      : null

  if (Array.isArray(handCards) && handCards.length > 0) {
    return count === handCards.length
  }

  return false
}

export function handleRoleOptTargetNtf(arg) {
  const { SpellID, Param, Params, SeatID, SrcSeatID, targetSeatID, Type } = arg

  switch (SpellID) {
    // 张菖蒲 严教
    case 945:
      if (Param == 0 && Params?.length > 0) {
        const arr = Params.map((id) => CardConfig.GetInstance().getCardNumber(id))
        drawYanJiao(arr, SeatID == Game.myID)
      }
      break

    // 刘辟 易城
    case 3440:
      // 更改为 不再计算队友刘辟的易城 Game.mySeats.includes(SeatID)
      if (Game.myID !== undefined && Game.myID === SeatID && Param == 0 && Params?.length > 0) {
        if (Type == 28) {
          const paiduiNumbers = Params.map((id) => CardConfig.GetInstance().getCardNumber(id))
          const shoupaiNumbers = getTrackedPlayerHandCardIDs(SeatID).map((id) =>
            CardConfig.GetInstance().getCardNumber(id)
          )
          drawYiCheng(paiduiNumbers, shoupaiNumbers)
        } else {
          drawYiCheng()
        }
      }
      break

    // 蒲元 锻造
    case 11003:
      if (Param == 0 && Params?.length > 0 && SrcSeatID != Game.myID && globalConfig.v) {
        document.getElementById('result').innerHTML =
          '<span class="textRes"> 【锻造】<br>' +
          Params.map((id) => CardConfig.GetInstance().getCard(id).ncn).join('<br>') +
          '</span>'
      }

      break

    // 王元姬 识人 宴戏
    // case 7016:
    // case 7017:
    //   if (Params?.length > 0 && (SrcSeatID == Game.myID || import.meta.env.DEV)) {
    //     handleYanXi(SpellID, Param, Params)
    //   }

    //   break

    // 顺拆 魄袭 伪溃 审时 闪袭 勘破 缓释 眩惑(界) 强识(界) 目标角色全部手牌明牌
    case 4:
    case 5:
    case 921:
    case 372:
    case 811:
    case 357:
    case 3119:
    case 501:
    case 3437:
    case 3876:
      if (Params?.length > 0) {
        if (targetSeatID !== undefined && targetSeatID !== 255) {
          revealPlayerHandCards(targetSeatID, Params, { fullHand: true })
        }
      }
      break

    // 伏间 下书 贿生 忘隙(新) 目标角色部分手牌
    case 851:
    case 361:
    case 774:
    case 3310:
      if (Param == 0 && Params?.length > 0) {
        if (targetSeatID !== undefined && targetSeatID !== 255) {
          revealPlayerHandCards(targetSeatID, Params)
        }
      }
      break

    // 吕凯 图南 观看牌堆顶一张牌
    case 943:
      if (Param == 0 && Params?.length == 1) {
        revealPileCards(Params)
      }
      break

    // 王粲 散文
    case 898:
      if (Param == 0 && Params?.length > 2) {
        if (SrcSeatID !== undefined && SrcSeatID !== 255) {
          revealPlayerHandCards(SrcSeatID, Params.slice(1, Params[0] + 1))
        }
      }
      break

    // 黄承彦 观虚
    case 987:
    case 988:
      if (Param == 1 && Params?.length > 2) {
        if (SrcSeatID == Game.myID || import.meta.env.DEV) {
          const pileCount = Number(Params[0]) || 0
          const handCount = Number(Params[1]) || 0
          if (pileCount > 0) {
            // Params: [牌堆张数, 手牌张数, ...牌堆顶, ...目标手牌]
            revealPileCards(Params.slice(2, 2 + pileCount))
          }
          if (handCount > 0 && targetSeatID !== undefined && targetSeatID !== 255) {
            revealPlayerHandCards(
              targetSeatID,
              Params.slice(2 + pileCount, 2 + pileCount + handCount)
            )
          }
        }
      }
      break

    // 周群 天候
    case 3903:
      if (Param == 0 && Params?.length > 2) {
        if (
          targetSeatID !== undefined &&
          targetSeatID == 255 &&
          (SrcSeatID == Game.myID || import.meta.env.DEV)
        ) {
          revealPileCards(Params.slice(2, 2 + Params[0]))
        }
      }
      break

    // 族钟琰
    case 3266:
      if (Param == 0 && Params?.length > 0) {
        if (targetSeatID !== undefined && (SrcSeatID == Game.myID || import.meta.env.DEV)) {
          revealTargetCards(
            targetSeatID,
            Params.filter((_, index) => index % 3 == 1)
          )
        }
      }
      break

    // 族钟繇 诫厉
    // Params: [pileCount, handCount, ...pileTopCardIDs, ...handCardIDs]
    // 手牌片段是目标部分手牌，不一定等于全部手牌
    case 3483:
      if (Param == 1 && Params?.length > 0) {
        const pileCount = Number(Params[0]) || 0
        const handCount = Number(Params[1]) || 0

        if (pileCount > 0) {
          const trackerRoom = tracker.getReadyTrackerRoom()
          if (trackerRoom) {
            trackerRoom.getSkillState(SpellID).expectedPileCount = pileCount
          }
        }

        if (Params.length > 2) {
          if (pileCount > 0) {
            revealPileCards(Params.slice(2, 2 + pileCount))
          }
          if (handCount > 0 && targetSeatID !== undefined && targetSeatID !== 255) {
            const handCardIDs = Params.slice(2 + pileCount, 2 + pileCount + handCount)
            revealPlayerHandCards(
              targetSeatID,
              handCardIDs,
              shouldRevealAsFullHand(targetSeatID, handCount) ? { fullHand: true } : {}
            )
          }
        }
      }
      break

    // 郭照 椒遇
    case 3571:
      if (Param == 0) {
        Params.slice(1).forEach((id) => Game.getSpellState(SpellID)?.add?.(id))
      }
      break

    // 晋司马懿 雄志 权变
    case 7010:
    case 7011:
      if (Params?.length > 0 && targetSeatID == 255) {
        if (SrcSeatID == Game.myID || import.meta.env.DEV) {
          revealPileCards(Params)
        }
      }
      break

    // 国战先驱
    case 2900:
      if (Type == 28) {
        Game.setGeneral(targetSeatID, Params[2], Params[1], true)
      }
      break

    case 4021:
      // 此时裴秀开始选技能 应该销毁地图
      if (Type == 78) {
        destroyPeiXiuMapWindow()
        Game.deleteSpellState(4022)
      }
      break

    default:
      break
  }
}
