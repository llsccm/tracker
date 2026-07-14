import { CardConfig, SpellExtendConfig } from './config'
import { initFrame, resetGameUiState } from './dom'
import { drawCard } from './draw'
import { isRetainedLogicMessage } from './featureFlags'
import {
  handleChatMessage,
  handleDoudizhuMessage,
  handleGameOver,
  handleGamePhase,
  handleGameTurn,
  handleMoveCard,
  handleRogueLike,
  handleRoleOptTargetNtf,
  handleTriggerSpellNew,
  hasRuntime,
  showShanHeTuSponsorPrompt
} from './handler'
import { handleRecordStartGame } from './handler/StartGame'
import { laya } from './runtime/gameAdapter'
import { Game, globalConfig, UI, user } from './tracker'
import { tracker } from './tracker/runtime/browser'
import { POSITION_BOTTOM } from './tracker/candidate/cardPositions'
import {
  getRenderedMainHandCardIDs,
  subscribeRenderedMainHandCardIDs
} from './tracker/view/PlayerHandView'
import { idleCallback, toSuitGlyphHtml } from './utils'
import { addTooltip } from './utils/notification'
import { handleBroadMsg } from './handler/chat'
import { parsePeiXiuRoleData, solvePeiXiuRoleData } from './utils/peixiuRouteFeature'
import { renderPeiXiuMapWindow, setPeiXiuMapWindowVisible } from './ui/PeiXiuMapWindow'

const ALLOWED_CLASSES = new Set([
  'ClientLoginRep',
  'ClientUserDataCounterNtf',
  'SmsgUpdateTaskListToClient',
  'ClientGuildMemberChangeNtf'
])

const DOUDIZHU_MSGS = new Set([
  'decodeMsgGameStart',
  'decodeMsgBroadcastMoveCard',
  'decodeSNoticeOp',
  'MsgGameOver'
])

const PROTOCOL_PILE_ZONE = 1
const PROTOCOL_HAND_ZONE = 5

/**
 * @param {number|string} id
 * @param {number|number[]} cardIDs
 * @param {number} [zone]
 * @param {number} [pos]
 */
function revealCardsInProtocolZone(id, cardIDs, zone = PROTOCOL_HAND_ZONE, pos = undefined) {
  tracker.revealTrackerCardsInZone({ id, zone, pos }, cardIDs)
}

/**
 * @returns {number[]|null}
 */
function getRenderedHandSuitColors() {
  const cardIDs = getRenderedMainHandCardIDs()
  if (cardIDs === null) return null

  const cardConfig = CardConfig.GetInstance()
  return cardIDs
    .map((id) => Number(cardConfig.getCardColor(id)))
    .filter((color) => color >= 1 && color <= 4)
}

function refreshPeiXiuHandSuitColors() {
  const state = Game.getSpellState(4022)
  if (!state?.usesMainHandMirror || !state.result) return

  const handSuitColors = getRenderedHandSuitColors()
  if (handSuitColors === null) return
  if (
    Array.isArray(state.handSuitColors) &&
    state.handSuitColors.length === handSuitColors.length &&
    state.handSuitColors.every((color, index) => color === handSuitColors[index])
  ) {
    return
  }

  const nextState = { ...state, handSuitColors }
  Game.setSpellState(4022, nextState)
  renderPeiXiuMapWindow(nextState, SpellExtendConfig.GetInstance().PeiXiuBonus)
}

subscribeRenderedMainHandCardIDs(refreshPeiXiuHandSuitColors)

/** 牌堆准备好了 */
function readyTrackerGame(cardList = []) {
  const dictCard = CardConfig.GetInstance().cardIDsOrder.filter((id) => cardList.includes(id))
  const paidui = dictCard.concat(cardList.filter((id) => !dictCard.includes(id))).filter(Boolean)

  Game.isGuoZhan = cardList.includes(1150)
  Game.isDouDiZhu = cardList.includes(13005)
  Game.isShanHeTu = cardList.includes(20100)
  Game.isRoguelike1v1 = laya?.scene?.SceneName === 'RogueLike1v1Scene'
  Game.isSWJG = laya?.scene?.SceneName === 'SWJGScene'

  resetGameUiState()
  delete Game.spellSpace[3338] // 百出 每局游戏归零

  laya.ged?.CloseWindow?.('CardConfigWindow')

  Game.resetConfigHandCards()
  tracker.initTrackerDeck(paidui)
}

export function logic(msg) {
  try {
    if (!msg) return
    if (msg.startsWith?.('socket连接关闭')) return
    if (msg.className === undefined && msg.ClassName === undefined) return

    let { ClassName: className } = msg
    const { ProtoObj, SeatID, SrcSeatID, SpellID, Datas, CardIDs, Type } = msg

    if (!className) className = msg.className || msg.toString()

    if (!isRetainedLogicMessage(className)) return

    if (ALLOWED_CLASSES.has(className) && msg?.userID != user.userID) {
      //渠道服没有localStorage.SGS_LASTLOGIN_ACCOUNT，而是localStorage.LastUserName
      user.userID = msg.userID
      console.info('[logic] userID: %s', msg.userID)
      initFrame()
    }

    if (typeof PUERTS_JS_RESOURCES !== 'undefined') {
      if (!hasRuntime()) return
      if (DOUDIZHU_MSGS.has(className)) handleDoudizhuMessage(msg)
      return
    }

    switch (className) {
      case 'ClientLoginRep':
        user.nickname = msg.Nickname || user.nickname || ''
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
        idleCallback(() => {
          handleRogueLike()
        })
        break

      case 'decodeGameRecordInitInfo':
        // 用于判断模式
        // console.info(msg)
        break

      case 'GsCModifyUserseatNtf': // 游戏开始标志 / 游戏结束标志
        // handleStartGame(msg)
        break

      // 播放录像时座位信息
      case 'decodeGsClientUserSeatFlagNtf':
        // 新录像两个消息都有 旧录像只有这个消息
        handleRecordStartGame(msg)
        break

      case 'GsCUpdateRoleDataNtf':
        if (msg.StateID === 47) {
          // console.info(msg)
        }

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

        if (msg.StateID === 66) {
          // 单骑玩家虎符数量
        }

        break

      /** 身份更新 */
      case 'MsgGameShowFigure':
        // Type 1是分配 2是标记/广播
        // Figure: 主公/地主是1 农民是3
        // 统率的主公可能不是先手 但是这里先不管
        // 斗地主全部都是 type1 不能用作主视角判断
        if (msg.Type == 1) {
          // console.info('座位: ' + SeatID + '的身份: ' + msg.Figure)
          if (msg.Figure === 1) tracker.setTrackerFirstHand(SeatID)
        }

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
      case 'ClientLeavetableRep':
        handleGameOver()
        break

      case 'ClientRecommendShopItemRep':
        // 退出录像时清理? 可能还有更好的方法
        if (Game.isGameStart && msg?.userID === user.userID) handleGameOver()
        break

      case 'decodeRougeBaseInfoRep':
        //该class 在 MsgGamePlayCardNtf（游戏初始化） 之前
        UI.friendGeneral = ProtoObj?.friendGeneral?.length ?? UI.friendGeneral
        break

      case 'MsgGamePlayCardNtf':
        //牌堆准备 比 GsCModifyUserseatNtf 晚
        readyTrackerGame(msg.CardList)
        break

      // 选择武将
      case 'SmsgGameSetCharacter':
        // 斗地主是同步选择武将 播放录像时可以用这个方式来判断主视角
        if (Game.isRecord && Game.myID === undefined && Game.isDouDiZhu && msg.Infos.length == 1) {
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

      // TODO
      //出杀次数
      case 'GsCUpdateRoleDataExNtf':
        {
          switch (msg.DataID) {
            case 1:
              if (Game.currentID == SeatID && Array.isArray(Datas)) {
                document.getElementById('sha').innerText =
                  '剩余：' + Math.max(0, Datas[2] - Datas[1])
              }
              break

            case 3571:
              if (Array.isArray(Datas)) {
                // 郭照 椒遇 Datas:[x] 1红2黑
                const colors = Datas[0] == 1 ? [1, 2] : [3, 4]

                const jiaoYuCards = Game.getSpellState(3571)
                Game.setSpellState(
                  3571,
                  new Set(
                    Array.from(jiaoYuCards || []).filter((id) =>
                      colors.includes(CardConfig.GetInstance().getCard(id)?.color)
                    )
                  )
                )
              }
              break

            // 尽览
            case 4022:
              if (Array.isArray(Datas)) {
                const roleData = parsePeiXiuRoleData(Datas)
                if (!roleData) break

                const spellExtendConfig = SpellExtendConfig.GetInstance()
                const mapConfig = spellExtendConfig.PeiXiuCellDic.get(roleData.mapId)
                const solvedState = mapConfig ? solvePeiXiuRoleData(mapConfig, Datas) : null
                const presetRoutes = spellExtendConfig.PeiXiuPresetRoutes.get(roleData.mapId) || []
                const usesMainHandMirror =
                  Game.myID != null && SeatID != null && Number(Game.myID) === Number(SeatID)
                const handSuitColors = usesMainHandMirror ? getRenderedHandSuitColors() : null

                const state = solvedState
                  ? { ...solvedState, presetRoutes, handSuitColors, usesMainHandMirror }
                  : {
                      ...roleData,
                      result: null,
                      presetRoutes,
                      handSuitColors,
                      usesMainHandMirror
                    }

                Game.setSpellState(4022, state)

                if (state.result) {
                  renderPeiXiuMapWindow(state, spellExtendConfig.PeiXiuBonus)
                  setPeiXiuMapWindowVisible(Boolean(globalConfig.peiXiuMapSwitch))
                }
              }

              break

            default:
              break
          }
        }
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
        //昭然
        if (Game.getSeatUI(msg.seatId)?.seat?.HasSkill(769))
          revealCardsInProtocolZone(msg.seatId, msg.Cards)
        break

      case 'MsgNtfUseCardType':
        //使用虚拟/转化牌
        if (msg.castSeatId == Game.myID && msg.useType == 1 && !msg.isSend)
          Game.record({ use: msg.spellId }) // 战法计数
        break

      case 'PubGsCUseCard':
        //使用卡牌

        if (SeatID == Game.myID && msg.useType == 1 && !msg.isSend) {
          // 战法计数
          Game.record({ use: msg.spellID })
        }

        if (Game.myID == SeatID) drawCard([msg.CardID])

        if (
          Game.currentID == SeatID &&
          Game.getSeatUI(Game.currentID)?.seat?.HasSkill(7011) &&
          msg.useType == 1 &&
          msg.fromZone != 1 &&
          !msg.isSend
        ) {
          if (!Game.spellSpace[7011]) Game.spellSpace[7011] = { count: 0, color: new Set() }

          if (CardConfig.GetInstance().getCard(msg.CardID).type != 3) Game.spellSpace[7011].count++

          Game.spellSpace[7011].color.add(CardConfig.GetInstance().getCard(msg.CardID).c)

          setSuitRecord(
            Array.from(Game.spellSpace[7011].color).join(''),
            '[' + Game.spellSpace[7011].count + ']'
          )
        } else if (
          Game.currentID == SeatID &&
          Game.getSeatUI(Game.currentID)?.seat?.HasSkill(491) &&
          msg.useType == 1 &&
          !msg.isSend
        ) {
          setSuitRecord(CardConfig.GetInstance().getCard(msg.CardID).cn)
        }

        break

      case 'PubGsCUseSpell': {
        // 使用技能
        if (Game.myID === SeatID && CardIDs.length === 1) {
          drawCard(CardIDs)
        }

        switch (SpellID) {
          case 3090:
            // 博图计数器
            if (SeatID === Game.currentID && msg.EffectIndex === 1) {
              const prev = Number(Game.spellSpace[3090]) || 0
              Game.spellSpace[3090] = prev + 1
              laya.ged?.event('SET_SEAT_STATE')
            }
            break

          // TODO
          // 国战乱击
          case 2143: {
            if (!Game.spellSpace[2143]) {
              Game.spellSpace[2143] = new Set()
            }

            // 提取单例引用，避免循环内高频调用
            const instance = CardConfig.GetInstance()
            for (const id of CardIDs) {
              Game.spellSpace[2143].add(instance.getCard(id).c)
            }

            setSuitRecord(Array.from(Game.spellSpace[2143]).join(''))
            break
          }

          // TODO
          case 3157: // 夏侯玄-清议
          case 3511: // 李婉-联句
            // 改用 some 替换 filter，实现 O(1) 提前终止与零内存分配
            if ((SrcSeatID === Game.myID || import.meta.env.DEV) && CardIDs.some((id) => id > 0)) {
              Game.setSpellState(SpellID, CardIDs)
            }
            break

          // TODO
          case 3193: // 贵相
          case 3185: // 持纲
          case 3138: // 持纲(旧)
          case 3161: // 醇醪(界)
            Game.phase--
            break

          case 3571:
            // 郭照 椒遇
            if (msg.EffectIndex === 1) {
              Game.setSpellState(3571, new Set())
            }
            break

          // TODO
          // 谋许攸 迁附 控顶
          case 3750:
            if (msg.EffectIndex === 2 && !msg.DestSeatIDs.length) {
              Game.setSpellState(3750, CardIDs)
            }
            break
        }

        break
      }

      // 询问操作 严教 界强识等
      case 'GsCRoleOptTargetNtf':
        handleRoleOptTargetNtf(msg)
        break

      case 'CGsRoleSpellOptRep': {
        switch (Type) {
          // 斗地主叫分结果 Datas: [300] data_count: 1
          case 44:
            if (SeatID !== undefined) {
              tracker.setTrackerFirstHand(SeatID)
            }
            break

          default:
            break
        }

        // 技能操作
        switch (SpellID) {
          // 知己知彼
          case 2022:
            Game.setGeneral(SeatID, Datas[0], Datas[1], true)
            break

          // 族杨修 捷悟
          case 3659:
            revealCardsInProtocolZone(SeatID, Datas)
            break

          // 谋诸葛 知天
          case 3744:
            if (Type !== 73) revealCardsInProtocolZone(255, Datas, PROTOCOL_PILE_ZONE)
            break

          // 诸葛恪 傲才
          case 3868:
            if (Type === 50) revealCardsInProtocolZone(255, Datas, PROTOCOL_PILE_ZONE)
            break

          // TODO 初始牌
          case 0:
            if (Type === 72 && Game.isGameStart && Datas?.length && !Game.round && !Game.phase) {
              const spellCards = Game.getSpellState(3731)
              const prev = Array.isArray(spellCards) ? spellCards : []
              const uniqueIds = new Set(prev.concat(Datas))

              Game.setSpellState(
                3731,
                Array.from(uniqueIds).filter((id) => id > 0)
              ) // 魔吕布 夺炁
            }

            break

          // TODO
          // 鹰视
          case 7009: {
            const count = Number(Game.getSpellState(7009)) - 0.5
            Game.setSpellState(7009, count)
            if (count <= 0) revealCardsInProtocolZone(255, Datas, PROTOCOL_PILE_ZONE)
            break
          }

          // 嚣翻
          case 3336:
            if (Type === 50 && Array.isArray(Datas)) {
              revealCardsInProtocolZone(
                255,
                [...Datas].reverse(),
                PROTOCOL_PILE_ZONE,
                POSITION_BOTTOM
              )
            }
            break

          // TODO
          // 郭照 椒遇
          case 3571:
            if (Type === 10) Game.getSpellState(SpellID)?.add?.(Datas[0])
            break

          // 裴秀
          case 4021:
            // console.info(msg)
            // 绘制裴秀地图 Datas: [12,18] data_count: 2 第一位为地图id 第二位为起始格子
            break

          case 4022:
            // Datas: [2, 0] data_count: 2 第一位为方向
            // 用于触发提示 向东绘制所有地图
            // console.info(msg)
            // 似乎没那么重要
            break

          default:
            break
        }

        break
      }

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

function setSuitRecord(text = '', prefix = '') {
  const target = document.getElementById('suit')
  if (!target) return
  target.innerHTML = prefix + toSuitGlyphHtml(text)
}
