import { CardConfig } from './config'
import { isRetainedLogicMessage } from './featureFlags'
import {
  handleChatMessage,
  handleGameOver,
  handleGamePhase,
  handleGameTurn,
  handleLeaveTable,
  handleMoveCard,
  handleRogueLike,
  handleRoleSpellOptRep,
  handleRoleOptTargetNtf,
  handleTriggerSpellNew,
  handleUseSpell,
  showShanHeTuSponsorPrompt,
  handleUpdateRoleDataExNtf,
  handleUseCard
} from './handler'
import { handleRecordStartGame } from './handler/StartGame'
import {
  handleAdWindow,
  handleGeneralSkin,
  handleGeneralWishPool,
  handleKillEffect,
  handlePackageOpened,
  handleSkinWishPool,
  handleTableInfo,
  handleUserProfileSkin
} from './handler/clientEnhancements'
import { handleUserSession } from './handler/userSession'
import { laya } from './runtime/gameAdapter'
import { Game, globalConfig, UI, user } from './tracker'
import { tracker } from './tracker/runtime/browser'
import { recordTrackerProtocol } from './tracker/runtime/protocolRecorder'
import { handleBroadMsg } from './handler/chat'

// const DOUDIZHU_MSGS = new Set([
//   'decodeMsgGameStart',
//   'decodeMsgBroadcastMoveCard',
//   'decodeSNoticeOp',
//   'MsgGameOver'
// ])

let lastClassName = null

export function logic(msg) {
  try {
    if (!msg) return
    if (msg.startsWith?.('socket连接关闭')) return
    if (msg.className === undefined && msg.ClassName === undefined) return

    const className = msg.ClassName || msg.className || msg.toString()
    // 结束消息只处理连续消息中的第一条；初始化通知仅幂等更新对局信息。
    if (className === lastClassName && className === 'MsgGameOver') {
      return
    }
    lastClassName = className

    const { ProtoObj, SeatID } = msg

    // 录制器有独立的记牌协议规则，需先于功能白名单执行，以保留路由遗漏现场。
    recordTrackerProtocol(msg, { mySeatID: Game.myID, currentSeatID: Game.currentID })

    if (!isRetainedLogicMessage(className)) return

    handleUserSession(msg, className)

    // if (typeof PUERTS_JS_RESOURCES !== 'undefined') {
    //   if (!hasRuntime()) return
    //   if (DOUDIZHU_MSGS.has(className)) handleDoudizhuMessage(msg)
    //   return
    // }

    switch (className) {
      // 绑定码
      case 'ClientBindKeyRep':
        if (import.meta.env.DEV) console.info(msg)
        break

      // 收到此消息后会请求公告 可以尝试在此关闭 AdPushWindow
      case 'decodeSyncGameDataEvent':
        // 充值也会有此消息 但是暂无更好方案
        handleAdWindow()
        break

      // 断线重连
      case 'MsgReconnectGame':
        tracker.degradeTrackerRoom(msg)
        break

      case 'MsgReconnectGameHand':
        tracker.restoreTrackerReconnectHand(msg)
        break

      case 'decodeSSCChatmsgNtf':
        handleChatMessage(msg, ProtoObj)
        break

      case 'decodeClientActSysBroadMsgListResp':
        handleBroadMsg(ProtoObj)
        break

      case 'MsgHeartAliveRep': {
        // 同步到服务器时间
        // timer.sync(msg)
        // const beijingDay = Math.floor((timer.now() + 8 * 3600 * 1000) / 86400000)
        // if (timer.lastTaskDate != beijingDay) {
        //   timer.lastTaskDate = beijingDay
        // }
        break
      }

      case 'decodeRogueLikeDataSync':
        // 山河图展示：只绘制信息与提示，不触发自动操作。
        handleRogueLike(ProtoObj)
        showShanHeTuSponsorPrompt(ProtoObj)
        break

      case 'ClientActivitysetDataRep':
        // 山河图展示：活动状态变化时仅刷新/隐藏展示内容。
        // idleCallback(() => {
        //   handleRogueLike()
        // })
        break

      // 更新对局标识与模式，运行状态在座位开局入口统一重置。
      case 'decodeGameRecordInitInfo':
        if (import.meta.env.DEV) console.info(msg)
        if (ProtoObj) Game.updateRecordInfo(ProtoObj)
        break

      case 'GsCModifyUserseatNtf': // 游戏开始标志 / 游戏结束标志
        // 最佳的初始化位置 但是旧录像没有这个消息
        // 第二个 decodeGameRecordInitInfo 消息在此之后
        // handleStartGame(msg)
        break

      // 座位信息
      case 'decodeGsClientUserSeatFlagNtf':
        // 新录像两个消息都有 旧录像只有这个消息
        handleRecordStartGame(msg)
        if (globalConfig.showNameSwitch && Game.needShowName) laya.showName()
        break

      // 山河图等模式的座位临时显隐
      case 'MsgGamePlayerShowStatusNtf':
        // msg.Count
        tracker.setTrackerPlayerShowStatuses(msg.SeatData)
        break

      case 'GsCUpdateRoleDataNtf':
        // DATA_MARK_SWJG_RANK 抓鬼等有此消息?
        // if (msg.StateID === 47) {
        //   console.info(msg)
        // }

        // 22排位有58消息 DATA_CAMP_ID 阵营语音 SeatID: 0 Value: 402476507
        // 可以用来确认22主视角
        if (
          msg.StateID === 58 &&
          Game.isRecord &&
          Game.myID === undefined &&
          SeatID !== undefined
        ) {
          tracker.setTrackerMySeatID(SeatID)
        }

        // 单骑玩家虎符数量
        // if (msg.StateID === 66) {
        //   //
        // }

        break

      // 身份更新 Type 1是分配 2是标记/广播
      case 'MsgGameShowFigure':
        // Figure: 主公/地主是1 农民是3
        // 统率的主公可能不是先手 但是这里先不管
        // 斗地主全部都是 type1 不能用作主视角判断

        // 假设主视角非主公
        // 第一条收到 type2 的 主公信息
        // 第二条收到 type1 的 自己阵营信息
        // 后面会收到 type2 的 主公信息 或者 阵亡翻开身份
        if (msg.Figure === 1) tracker.setTrackerFirstHand(SeatID)
        // console.info('座位: ' + SeatID + '的身份: ' + msg.Figure)

        // if (msg.Type == 1) {
        //   //
        // }

        break

      // 先手位置 在选将后触发
      case 'GsCFirstPhaseRole':
        if (SeatID !== undefined) {
          // laya.ged?.CloseWindow?.('CardConfigWindow')
          tracker.setTrackerFirstHand(SeatID)
        }
        break

      //关卡过关
      case 'MsgGameRoundNtf':
        if (msg.isPassed) Game.isPassed = msg.isPassed
        break

      case 'MsgGameOver':
        if (import.meta.env.DEV) console.info(msg)
        handleGameOver()
        break

      case 'ClientLeavetableRep':
        handleLeaveTable()
        break

      case 'ClientRecommendShopItemRep':
        // 退出录像时清理? 可能还有更好的方法
        if (Game.isGameStart && msg?.userID === user.userID) handleLeaveTable()
        break

      case 'decodeRougeBaseInfoRep':
        //该class 在 MsgGamePlayCardNtf（牌堆初始化） 之前
        UI.friendGeneral = ProtoObj?.friendGeneral?.length ?? UI.friendGeneral
        break

      //牌堆准备 比 GsCModifyUserseatNtf 晚
      case 'MsgGamePlayCardNtf':
        {
          const cardList = msg.CardList
          if (!Array.isArray(cardList) || cardList.length === 0) {
            console.warn('[logic] MsgGamePlayCardNtf 缺少 CardList，跳过牌堆初始化')
            break
          }

          const dictCard = CardConfig.GetInstance().cardIDsOrder.filter((id) =>
            cardList.includes(id)
          )
          const paidui = dictCard
            .concat(cardList.filter((id) => !dictCard.includes(id)))
            .filter(Boolean)

          Game.isGuoZhan = cardList.includes(1150)
          Game.isDouDiZhu = cardList.includes(13005)
          Game.isShanHeTu = cardList.includes(20100)

          Game.resetConfigHandCards()
          tracker.initTrackerDeck(paidui)
        }

        break

      // 选择武将
      case 'SmsgGameSetCharacter':
        // 斗地主是同步选择武将 播放录像时可以用这个方式来判断主视角
        if (
          Game.isRecord &&
          Game.myID === undefined &&
          msg.Infos.length == 1 &&
          (Game.isDouDiZhu || Game.isShanHeTu)
        ) {
          tracker.setTrackerMySeatID(msg.Infos[0].SeatID)
        }

        msg.Infos.forEach(({ SeatID, CharacterID }) => {
          Game.setGeneral(SeatID, CharacterID)
        })

        break

      // 国战 设置武将
      case 'GsCGuoZhanSetCharacter':
        msg.GeneralData?.forEach(({ index, cardID }) => {
          Game.setGeneral(SeatID, cardID, index)
        })
        break

      // 每轮开始
      case 'MsgGameTurnNtf':
        handleGameTurn(msg)
        break

      // 每回合开始阶段
      case 'GsCGamephaseNtf':
        handleGamePhase(msg)
        break

      // 更新状态的消息
      case 'GsCUpdateRoleDataExNtf':
        handleUpdateRoleDataExNtf(msg)
        break

      // TODO
      case 'GsCUpdateHpNtf': {
        // recordHpColorChange(msg)
        // 顺机
        break
      }

      case 'GsCTriggerSpellNew':
        handleTriggerSpellNew(msg)
        break

      case 'ClientHappyGetFriendHandcardRep':
        // 昭然 769 我不知道干嘛
        break

      // 转化卡牌
      case 'MsgNtfUseCardType':
        handleUseCard(msg)
        break

      // 使用卡牌
      case 'PubGsCUseCard':
        if (msg.isSend === 1) break
        handleUseCard(msg)
        break

      case 'PubGsCUseSpell':
        handleUseSpell(msg)
        break

      // 询问操作 严教 界强识等
      case 'GsCRoleOptTargetNtf':
        handleRoleOptTargetNtf(msg)
        break

      case 'CGsRoleSpellOptRep':
        handleRoleSpellOptRep(msg)
        break

      case 'PubGsCMoveCard':
        handleMoveCard(msg)
        break

      // 录像牌堆明牌功能
      case 'decodeGameDealPileTopCardList':
        // console.info(msg)
        break

      // 击杀特效
      case 'CClientGameRewardPointNTF':
        handleKillEffect(msg)
        break

      // 皮肤信息
      case 'ClientGeneralSkinRep':
        handleGeneralSkin(msg)
        break

      // 个人信息
      case 'ClientUserbaseinfoRep':
      case 'ClientUserdetailRep':
        handleUserProfileSkin(msg)
        break

      case 'ClientTableinfoRep':
        handleTableInfo()
        break

      case 'ClientModifyTblsetingNtf':
        if (import.meta.env.DEV) console.info(msg)
        break

      // 武将包开启后消息 用于关闭 GeneralOpenResultWindow
      case 'ClientChestOpenReplaceInfoNtf':
        handlePackageOpened()
        break

      case 'decodeServerGeneralWishPoolDataResp':
        handleGeneralWishPool(ProtoObj)
        break

      case 'decodeServerSkinWishPoolDataResp':
        handleSkinWishPool(ProtoObj)
        break

      default:
        break
    }

    // end
  } catch (e) {
    console.error(e)
  }
}

// function resetHpColorTurn() {
//   const seats = {}

//   Game.seatUIs.forEach(({ seatID, seat }) => {
//     if (!seat) return
//     const maxHp = Number(seat.MaxHp)
//     const hp = Number(seat.Hp)
//     const color = hpColor(maxHp, hp)
//     if (!color) return
//     seats[seatID] = { hp, maxHp, color }
//   })

//   Game.setSpellState('hpColor', {
//     turn: Game.turn,
//     currentID: Game.currentID,
//     seats,
//     seen: new Set(),
//     events: []
//   })

//   drawHpColorTips()
// }

// function recordHpColorChange(arg) {
//   let state = Game.getSpellState('hpColor')
//   if (!state || state.turn != Game.turn || state.currentID != Game.currentID) resetHpColorTurn()
//   state = Game.getSpellState('hpColor')

//   const seatID = Number(arg.SeatID)
//   let prev = state.seats[seatID]
//   if (!prev) {
//     const seat = Game.getSeatUI(seatID)?.seat
//     if (!seat) return
//     const hp = arg.isMaxHp ? Number(seat.Hp) : Number(arg.HP)
//     const maxHp = arg.isMaxHp ? Number(arg.HP) : Number(seat.MaxHp)
//     const color = hpColor(maxHp, hp)
//     if (!color) return
//     state.seats[seatID] = { hp, maxHp, color }
//     drawHpColorTips()
//     return
//   }

//   const hp = arg.isMaxHp ? prev.hp : Number(arg.HP)
//   const maxHp = arg.isMaxHp ? Number(arg.HP) : prev.maxHp
//   const color = hpColor(maxHp, hp)
//   if (!color) return
//   state.seats[seatID] = { hp, maxHp, color }
//   if (prev.color != color) {
//     const step = prev.color < color ? 1 : -1
//     const colors = []
//     for (let i = prev.color + step; ; i += step) {
//       if (!state.seen.has(`${seatID}:${i}`)) {
//         state.seen.add(`${seatID}:${i}`)
//         colors.push(i)
//       }
//       if (i == color) break
//     }
//     if (colors.length) {
//       state.events.push({ seatID, colors, name: '灼魂' })
//     }
//   }
//   drawHpColorTips()
// }

// function drawHpColorTips() {
//   const enabled = (Game.generals?.[Game.myID] || []).some(
//     (id) => CharacterConfig.GetInstance().generalDict[id] == '魔张飞'
//   )
//   const state = Game.getSpellState('hpColor')
//   setGeneralTip({
//     key: 'hpColor',
//     seatUis: laya.gamescene?.seatContainer?.seatUIs || [],
//     getText: (ui) => {
//       if (!enabled) return ''
//       const seatID = Number(ui.seat?.index)
//       const seat = state?.seats?.[seatID]
//       const events = (state?.events || []).filter((event) => event.seatID == seatID)
//       return hpColorTipText(seat?.maxHp ?? ui.seat?.MaxHp, events)
//     }
//   })
// }
