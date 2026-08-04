import { CardConfig } from './config'
import { initFrame } from './dom'
import { drawCard } from './draw'
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
  handleUpdateRoleDataExNtf
} from './handler'
import { handleRecordStartGame } from './handler/StartGame'
import { laya } from './runtime/gameAdapter'
import { Game, globalConfig, UI, user } from './tracker'
import { tracker } from './tracker/runtime/browser'
import { setSuitRecord, wait } from './utils'
import { addTooltip } from './utils/notification'
import { handleBroadMsg } from './handler/chat'

const ALLOWED_CLASSES = new Set([
  'ClientLoginRep',
  'ClientUserDataCounterNtf',
  'SmsgUpdateTaskListToClient',
  'ClientGuildMemberChangeNtf'
])

// const DOUDIZHU_MSGS = new Set([
//   'decodeMsgGameStart',
//   'decodeMsgBroadcastMoveCard',
//   'decodeSNoticeOp',
//   'MsgGameOver'
// ])

const ShanHeTu_regex = /\[\d+\]$/

export function logic(msg) {
  try {
    if (!msg) return
    if (msg.startsWith?.('socket连接关闭')) return
    if (msg.className === undefined && msg.ClassName === undefined) return

    const className = msg.ClassName || msg.className || msg.toString()
    const { ProtoObj, SeatID } = msg

    if (!isRetainedLogicMessage(className)) return

    if (user.userID === 0 && ALLOWED_CLASSES.has(className)) {
      //渠道服没有localStorage.SGS_LASTLOGIN_ACCOUNT，而是localStorage.LastUserName
      const frameReady = initFrame()
      user.userID = msg.userID
      user.nickname = msg.Nickname || user.nickname || ''
      console.info('[logic] userID: %s', msg.userID)
      frameReady
        .then(() => {
          const uuidElement = document.getElementById('uuid')
          if (uuidElement) uuidElement.textContent = 'id：' + user.userID

          const nicknameElement = document.getElementById('nickName')
          if (nicknameElement) nicknameElement.textContent = '昵称：' + user.nickname
        })
        .catch((error) => {
          console.error('[logic] initFrame failed:', error)
        })
    }

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
        if (!globalConfig.skipAdWindowSwitch) break
        wait(() => laya.GetWindow('AdPushWindow'))
          .then((win) => win?.Close())
          .catch((err) => {
            console.error(err)
          })

        break

      // 断线重连
      case 'MsgReconnectGame':
        Game.isDuanXian = true
        addTooltip('断线重连，本局游戏中小抄记录可能不准')
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

      // 用于判断模式 此消息会触发两次
      case 'decodeGameRecordInitInfo':
        if (import.meta.env.DEV) console.info(msg)
        Game.init()
        if (!ProtoObj?.matchName) break

        if (ProtoObj.matchName === '斗地主') {
          Game.isDouDiZhu = true
          Game.needShowName = true
          return
        }

        if (ProtoObj.matchName === '新欢乐排位' || ProtoObj.matchName.includes('cmk')) {
          Game.needShowName = true
          return
        }

        if (ProtoObj.matchName === '单骑无双') {
          Game.isRoguelike1v1 = true
          return
        }

        // 长安行[20610702]
        if (ShanHeTu_regex.test(ProtoObj.matchName) || ProtoObj.matchName.includes('山河图')) {
          Game.isShanHeTu = true
          return
        }

        // 身份演武军争

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
        if (Game.needShowName) laya.showName()
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
        // 此消息会触发两次
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

        if (
          msg.SpellID == 3821 &&
          msg.MurderSeatID == Game.myID &&
          Number(msg.Damage) > 0 &&
          !msg.isTreatment
        ) {
          const state =
            Game.spellSpace[3821] || (Game.spellSpace[3821] = { used: new Set(), pending: [] })
          const handNames = new Set(
            (laya.gamescene?.SelfSeatUi?.cardContainer?.cardUis || [])
              .map((ui) => {
                const cardId = Number(ui?.Card?.CardId ?? 0)
                return CardConfig.GetInstance().getCard(cardId)?.name || ''
              })
              .filter(Boolean)
          )
          //
          ;(state.pending || []).forEach((name) => {
            if (name && !handNames.has(name)) state.used.add(name)
          })
          state.pending = []
        }

        break
      }

      case 'GsCTriggerSpellNew':
        handleTriggerSpellNew(msg)
        break

      case 'ClientHappyGetFriendHandcardRep':
        // 昭然 769 我不知道干嘛
        break

      case 'MsgNtfUseCardType':
        //使用虚拟/转化牌
        if (msg.castSeatId == Game.myID && msg.useType == 1 && !msg.isSend) {
          // 战法计数
          Game.record({ use: msg.spellId })
        }
        break

      case 'PubGsCUseCard':
        //使用卡牌

        if (SeatID == Game.myID && msg.useType == 1 && !msg.isSend) {
          // 战法计数
          Game.record({ use: msg.spellID })
        }

        if (Game.myID == SeatID) drawCard([msg.CardID])

        // 权变花色 官方已实现 这里废弃

        if (
          Game.currentID == SeatID &&
          Game.getSeatUI(Game.currentID)?.seat?.HasSkill(491) &&
          msg.useType == 1 &&
          !msg.isSend
        ) {
          setSuitRecord(CardConfig.GetInstance().getCard(msg.CardID).cn)
        }

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
        if (globalConfig.blockKillEffectSwitch) msg.Type = 0
        break

      // 皮肤信息
      case 'ClientGeneralSkinRep':
        // 屏蔽动态
        if (globalConfig.blockSkinStateSwitch) {
          const GeneralSkinList = msg.GeneralSkinList || []
          GeneralSkinList.forEach((GeneralSkin) => {
            if (!GeneralSkin) return
            // 只显示主视角动态皮肤
            if (Game.myGenerals.includes(GeneralSkin?.GeneralID)) return
            GeneralSkin.state = 0
          })
        }

        break

      case 'ClientTableinfoRep':
        wait(() => laya.blockPowerSlogan()).catch((err) => {
          console.error(err)
        })
        break

      case 'ClientModifyTblsetingNtf':
        if (import.meta.env.DEV) console.info(msg)
        break

      // 武将包开启后消息 用于关闭 GeneralOpenResultWindow
      case 'ClientChestOpenReplaceInfoNtf':
        if (!globalConfig.skipPackageWindowSwitch) break
        wait(() => laya.GetWindow('GeneralOpenResultWindow'))
          .then((win) => win?.Close())
          .catch((err) => {
            console.error(err)
          })
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

//   Game.spellSpace.hpColor = {
//     turn: Game.turn,
//     currentID: Game.currentID,
//     seats,
//     seen: new Set(),
//     events: []
//   }

//   drawHpColorTips()
// }

// function recordHpColorChange(arg) {
//   let state = Game.spellSpace.hpColor
//   if (!state || state.turn != Game.turn || state.currentID != Game.currentID) resetHpColorTurn()
//   state = Game.spellSpace.hpColor

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
//   const state = Game.spellSpace.hpColor
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
