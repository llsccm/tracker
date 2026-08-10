import { destroyPeiXiuMapWindow } from '@/ui/PeiXiuMapWindow'
import { CardConfig } from '../config'
import { drawChengXiang, drawYanJiao, drawYiCheng } from '../draw'
import { Game } from '../tracker'
import { tracker } from '../tracker/runtime/browser'
import {
  FULL_HAND_ROLE_OPT_SPELL_IDS,
  PARTIAL_HAND_ROLE_OPT_SPELL_IDS,
  shouldRevealAsFullHand
} from '../tracker/runtime/protocolRules'
import { laya } from '@/runtime/gameAdapter'
import { wait } from '@/utils'
// import handleYanXi from './handleYanXi'

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

// 部分手牌协议在 handCount 恰好等于目标整手数时，应按 fullHand 同步。
// 优先信观测手牌数；没有观测时才退回本地手牌实体数。
function shouldRevealTrackedHandAsFullHand(seatID, handCount) {
  const room = tracker.getReadyTrackerRoom()
  if (!room) return false

  const player = room.getPlayer?.(seatID)
  if (player?.hasObservedHandCount === true) {
    return shouldRevealAsFullHand({
      handCount,
      observedHandCount: player.observedHandCount
    })
  }

  const localHandCount = room.playerCardsSnapshot.filter(
    (card) => card.subZone === 'hand' && card.seats?.has?.(Number(seatID))
  ).length
  return shouldRevealAsFullHand({ handCount, localHandCount })
}

function getCardNumbers(ids) {
  const config = CardConfig.GetInstance()
  return ids.map((id) => config.getCardNumber(id))
}

// GsCRoleOptTargetNtf
export function handleRoleOptTargetNtf(msg) {
  const { SpellID, Param, Params, SeatID, SrcSeatID, targetSeatID, Type } = msg

  if (FULL_HAND_ROLE_OPT_SPELL_IDS.has(Number(SpellID))) {
    if (targetSeatID === undefined || targetSeatID === 255) return
    if (Params?.length > 0) revealPlayerHandCards(targetSeatID, Params, { fullHand: true })
    return
  }

  if (PARTIAL_HAND_ROLE_OPT_SPELL_IDS.has(Number(SpellID))) {
    if (targetSeatID === undefined || targetSeatID === 255) return
    if (Param == 0 && Params?.length > 0) revealPlayerHandCards(targetSeatID, Params)
    return
  }

  switch (SpellID) {
    // 张菖蒲 严教
    case 945:
      if (Param == 0 && Params?.length > 0) {
        drawYanJiao(getCardNumbers(Params))
      }
      break

    // 刘辟 易城
    case 3440:
      // 更改为 不再计算队友刘辟的易城 Game.mySeats.includes(SeatID)
      if (Param == 0 && Params?.length > 0 && Game.myID !== undefined && Game.myID === SeatID) {
        // Params: (5) [96, 123, 128, 64, 129]
        if (Type == 28) {
          const paiduiNumbers = getCardNumbers(Params)
          const shoupaiNumbers = getCardNumbers(tracker.getTrackedPlayerHandCardIDs(SeatID))
          drawYiCheng(paiduiNumbers, shoupaiNumbers)
        }

        // 易城结束
        // if (Type == 29) {
        // }
      }

      break

    // 蒲元 锻造
    case 11003:
      if (Param == 0 && Params?.length > 0 && SrcSeatID != Game.myID) {
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

    // 吕凯 图南 观看牌堆顶一张牌
    case 943:
      if (Param == 0 && Params?.length == 1) {
        revealPileCards(Params)
      }
      break

    // 王粲 散文
    case 898:
      if (SrcSeatID === undefined) break
      if (Param == 0 && Params?.length > 2 && SrcSeatID !== 255) {
        revealPlayerHandCards(SrcSeatID, Params.slice(1, Params[0] + 1))
      }
      break

    // 黄承彦 观虚
    case 987:
    case 988:
      if (targetSeatID === undefined) break
      // 观虚牌堆全局可知游卡已修复 无需再判断主视角
      // 与观骨的差异 只展示牌堆 无目标角色手牌消息 所以需要在这里同步目标手牌
      if (Param == 1 && Params?.length > 2) {
        // Params: [牌堆张数, 手牌张数, ...牌堆顶, ...目标手牌]
        const pileCount = Number(Params[0]) || 0
        const handCount = Number(Params[1]) || 0

        if (pileCount > 0) {
          revealPileCards(Params.slice(2, 2 + pileCount))
        }

        if (handCount > 0 && targetSeatID !== 255) {
          revealPlayerHandCards(
            targetSeatID,
            Params.slice(2 + pileCount, 2 + pileCount + handCount)
          )
        }
      }

      break

    // 周群 天候
    case 3903:
      // Type 28/29 的有效牌面只下发给发动者；其他角色只会收到 Params 为空数组的消息。
      if (targetSeatID != 255 || Param != 0) break

      // Params: [牌堆观看数, 手牌数, ...牌堆顶, ...主视角手牌]
      if (Type == 28 && Params?.length > 2) {
        const pileCount = Number(Params[0]) || 0
        const pileCardIDs = Params.slice(2, 2 + pileCount)
        if (pileCount > 0 && pileCardIDs.length == pileCount) revealPileCards(pileCardIDs)
        break
      }

      // 发动者私有消息，Params: [展示者座位号, ...牌堆顶三牌]
      if (Type == 29 && Params?.length == 4) revealPileCards(Params.slice(1))

      // OPT_SKILL_FLAG3 可能用于选择角色获得技能 此处占位
      // if (Type == 30)
      break

    // 观骨
    case 3266:
      // 观骨全局可知游卡已修复
      // if (Param == 0 && Params?.length > 0 && targetSeatID !== undefined) {
      //   // 这里需补充数据格式
      //   const cardIDs = Params.filter((_, index) => index % 3 == 0)

      //   if (targetSeatID !== 255) revealPlayerHandCards(targetSeatID, cardIDs)
      // }

      break

    // 族钟繇 诫厉
    case 3483:
      if (targetSeatID === undefined) break
      // 目前全局不可知
      // 同样只展示牌堆 目标角色手牌需要在这里同步
      // Params: [pileCount, handCount, ...pileTopCardIDs, ...handCardIDs]
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
          // 牌堆
          if (pileCount > 0) revealPileCards(Params.slice(2, 2 + pileCount))

          // 手牌
          if (handCount > 0 && targetSeatID !== 255) {
            const handCardIDs = Params.slice(2 + pileCount, 2 + pileCount + handCount)
            revealPlayerHandCards(
              targetSeatID,
              handCardIDs,
              shouldRevealTrackedHandAsFullHand(targetSeatID, handCount) ? { fullHand: true } : {}
            )
          }
        }
      }

      break

    // 郭照 椒遇
    case 3571:
      // 这里数据不全 得四处拼接
      // Params: [牌数, ...CardIDs]
      // console.info(msg)
      // if (Param == 0) {
      //   Params.slice(1).forEach((id) => Game.getSpellState(SpellID)?.add?.(id))
      // }
      break

    // 晋司马懿 雄志 权变
    case 7010:
    case 7011:
      // 全局可知已被修复
      // 权变能看到牌堆顶 同时有卡牌消息 此处不需要同步
      // if (Params?.length > 0 && targetSeatID == 255) {
      //   if (SrcSeatID == Game.myID) {
      //     revealPileCards(Params)
      //   }
      // }
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

    case 3641:
      // 关闭其他视角的天书窗口
      if (Type == 67 && SeatID !== Game.myID) {
        wait(() => laya.GetWindow('TianShuWindow'))
          .then((win) => win.Close?.())
          .catch((err) => {
            console.error(err)
          })
      }

      break

    // 佐练
    // case 3488:
    //   // Param: 0
    //   // Params: [3, 20, 2, 90, 1, 22, 0, 39, 6, 110]
    //   if (Type == 28) {
    //     //
    //   }
    //   break

    // 称象
    case 441:
    case 3492: {
      if (SrcSeatID === undefined || targetSeatID !== 255) break
      if (SrcSeatID !== Game.myID) break

      const cardIDs = Game.getSpellState(SpellID)
      if (!Array.isArray(cardIDs) || !cardIDs.length) break

      drawChengXiang(getCardNumbers(cardIDs), SpellID == 3492)
      Game.deleteSpellState(SpellID)

      break
    }

    default:
      break
  }
}
