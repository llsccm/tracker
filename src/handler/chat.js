// import { laya } from '../runtime/gameAdapter'
// import { extractChatRoomId, getChatRoomLinkText } from '../utils/chatRoomLink'

const POWER_SLOGAN_TEXTS = new Set([
  '中原人杰地灵，天下归心！',
  '一统中原，天下归心！',
  '赴此雄途，一统山河！',
  '对酒当歌，人生几何！',
  '周公吐哺，天下归心。',
  '雄踞北方，睥睨天下！',
  '兵锋四向，所向披靡！',
  '势贯长虹，锐不可当！',
  '魏武挥鞭，龙骧虎战！',
  '魏风烈烈，霸业千秋！',
  '枕山河之固，展霸业鸿图！',
  '执戟兴邦，志在八方！',
  '魏骑驰骋，踏破山河！',
  '枕山河之固，扬魏武雄风！',
  '魏德昭彰，恩威并施！',
  '志在魏邦，雄图万里！',
  '战合肥，破成都，胜者为王！',
  '外驱胡虏，内平吴蜀！',
  '魏武藏奇略，霸业定乾坤！',
  '诸公半虎狼，魏旗不留藏!',
  '长驱蹈匈奴，左顾凌鲜卑！',
  '扇挥白羽迥，甲锁黄金明！',
  '魏光璀璨耀星河',
  '魏恩广布润人心',
  '护魏山河，霸业千秋！',
  '舳舻千里，旌旗蔽空',
  '受禅汉庭，魏起征程！',
  '奇谋鬼才，算无遗策！',
  '魏威如岳，气吞山河！',
  '大魏雄师，势不可挡！',
  '匡扶汉室，入主中原',
  '忠义为先，蜀汉必兴！',
  '鞠躬尽瘁，死而后已！',
  '惟贤惟德，方能匡复汉室！',
  '能进能退，方能百战不殆！',
  '蜀风烈烈，其志昭昭！',
  '天地英雄气，千秋尚凛然',
  '蜀道崎岖，壮志不屈！',
  '蜀锦为裳，剑指北方！',
  '血染征袍，荡涤乱世！',
  '汉业兴亡惟我在！',
  '蜀汉精忠，义贯长虹！',
  '壮志盈怀，忠义为先！',
  '蜀汉英魂，壮志凌云！',
  '蜀汉兴邦，志在四方',
  '犯我大吴疆土，虽远必诛',
  '上有天堂，下有苏杭！',
  '羽扇纶巾，计定天下！',
  '何人敢犯大吴疆土',
  '赴汤蹈火，在所不辞！',
  '犯大吴疆土者，吾必击而破之！',
  '江东子弟，何惧于天下！',
  '天下英雄谁敌手？',
  '英雄何不带吴钩！',
  '东吴水师，横行江海！',
  '吴钩似霜，斩破千障！',
  '吴营谋深，弹指乾坤！',
  '天险固垒，欲攻则锐！',
  '智谋如渊，踏浪焚天！',
  '江东子弟多才俊，谁怕！'
])

const HALL_CHAT_REPEAT_WINDOW = 15 * 1000
const hallChatRepeatMap = new Map()
const BLOCKED_CHAT_CONTENT_PATTERN =
  /((?:桃|烧)[bB8]|桃花|鲜花|菜篮子|0\.5(?:一|个)|女大(?:学生|妹妹)?|可[约玥]|福利|交友|进[群裙]|加[群裙]|群聊|裙聊|私聊|绿泡泡|[加嘉家].{0,2}[vV微薇].{0,2}[心芯新]|开放啪|代练|代打|陪玩|接单|带打|包上分|上分|(?:出|卖|收|回收).{0,3}号|成品号|收[^徒]*$|[帮代带].*[玩练打]|出.{0,3}的|[加家+＋十].{0,3}我)/

function normalizeHallChatMsg(text) {
  if (typeof text != 'string' || !text) return ''
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/#[0-9]+/g, '')
    .replace(/[0-9]+/g, '')
    .replace(/[ \t\r\n\u00a0❤♥♡❥ⅤⅴvVⅠⅰiI丨|]/g, '')
    .replace(/[.,，。!！?？:：;；'"“”‘’_\-+＋=~～*＊/\\()[\]（）【】<>《》]/g, '')
}

function isPurePlaceholderChatMsg(text) {
  if (typeof text != 'string' || !text) return false
  const cleaned = text.replace(/\s/g, '')
  if (!cleaned) return false
  return /^[:：=＝\-—_·.。•＊*#■□▢▣▤▥▦▧▨▩▪▫◆◇◈◼◻◾◽█▌▐▓▒░]+$/.test(cleaned)
}

function shouldBlockHallChat({ ProtoObj, chatMsg, channel, hallChatRepeatBlocked }) {
  if (ProtoObj.Channel == 2 && chatMsg && POWER_SLOGAN_TEXTS.has(chatMsg)) return true

  const isBlockedProtocolMessage =
    ProtoObj.chatMsg?.startsWith('oldback@') || ProtoObj.MsgType == 26 || ProtoObj.MsgKind == 2
  if (isBlockedProtocolMessage) return true

  const isRestrictedHallMessage =
    channel == 7 &&
    (ProtoObj.officeLevel == null || ProtoObj.officeLevel <= 6 || isPurePlaceholderChatMsg(chatMsg))
  if (isRestrictedHallMessage || hallChatRepeatBlocked) return true

  return BLOCKED_CHAT_CONTENT_PATTERN.test(ProtoObj.chatMsg || '')
}

function updateHallChatRepeatState(chatMsg, channel) {
  if (channel != 7 || !chatMsg) return false
  const key = normalizeHallChatMsg(chatMsg)
  if (!key) return false

  const now = Date.now()
  const prev = hallChatRepeatMap.get(key)
  let blocked = false
  if (prev && now - prev.time <= HALL_CHAT_REPEAT_WINDOW) {
    prev.time = now
    prev.count += 1
    blocked = prev.count >= 3
  } else {
    hallChatRepeatMap.set(key, { time: now, count: 1 })
  }
  if (hallChatRepeatMap.size > 200) {
    for (const [name, item] of hallChatRepeatMap) {
      if (now - item.time > HALL_CHAT_REPEAT_WINDOW) hallChatRepeatMap.delete(name)
    }
  }
  return blocked
}

// function handleInfoChatCommand(rawChatMsg, arg) {
//   const msg = atob(rawChatMsg.slice(5))
//   delete arg.data.protoObj
//   const [tag, seatID, key, value] = msg.split(':').map((s) => (isNaN(Number(s)) ? s : Number(s)))
//   // console.info(msg, { [tag]: seatID, [key]: value });

//   if (tag == 'mainSeatID') {
//     const index = laya.order.indexOf(seatID)

//     if (index >= 0) {
//       laya.order.splice(index, 1)
//       laya.order.push(seatID)
//       laya.seatUIs()
//     }

//     wait(() => Game.myID >= 0).then(() => {
//       if (Game.seatUIs[0]?.seat?.[key] == value)
//         laya.chat(`sub-SeatID:${Game.myID}  :${key}:${value}`, 'INFO')
//     })
//   } else if (tag === 'sub-SeatID') {
//     const index = laya.order.indexOf(seatID)

//     if (index >= 0) {
//       laya.order.splice(index, 1)
//       laya.order.splice(-1, 0, seatID)
//       laya.seatUIs()
//     }
//   }
// }

export function handleChatMessage(msg, ProtoObj) {
  // 消息处理
  if (!ProtoObj) return
  if (ProtoObj.scene == 11) ProtoObj.scene = 2
  // const rawChatMsg = ProtoObj.chatMsg || ProtoObj.ChatMsg || ''
  // const roomId = extractChatRoomId(rawChatMsg)

  // if (roomId) {
  //   ProtoObj.ChatMsg = rawChatMsg.replace(roomId, getChatRoomLinkText(roomId))
  //   ProtoObj.chatMsg = ProtoObj.ChatMsg
  // }

  const chatMsg = ProtoObj.chatMsg || ProtoObj.ChatMsg || ''
  const channel = ProtoObj.Channel || ProtoObj.channel
  const hallChatRepeatBlocked = updateHallChatRepeatState(chatMsg, channel)

  if (shouldBlockHallChat({ ProtoObj, chatMsg, channel, hallChatRepeatBlocked })) {
    delete msg.data.protoObj
    return
  }

  // if (rawChatMsg?.startsWith('INFO:')) {
  //   // 指令消息
  //   handleInfoChatCommand(rawChatMsg, msg)
  // }
}

// 跑马灯消息处理
export function handleBroadMsg(ProtoObj) {
  if (!ProtoObj) return
  if (Array.isArray(ProtoObj.msgList)) {
    ProtoObj.msgList.length = 0
  }
}
