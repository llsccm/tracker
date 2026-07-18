import { Game } from '@/tracker'
import { POSITION_BOTTOM } from '@/tracker/candidate/cardPositions'
import { tracker } from '@/tracker/runtime/browser'

const PROTOCOL_PILE_ZONE = 1
const PROTOCOL_HAND_ZONE = 5

// 保留协议 Zone 语义，由 Controller 统一换算玩家区域与牌堆端点。
function revealCardsInProtocolZone(id, cardIDs, zone = PROTOCOL_HAND_ZONE, pos = undefined) {
  tracker.revealTrackerCardsInZone({ id, zone, pos }, cardIDs)
}

// Type 级结果不一定绑定单一技能，例如叫分和开局初始牌通知。
function handleResultType({ Datas, SeatID, Type }) {
  switch (Type) {
    // 斗地主叫分结果 Datas: [300] data_count: 1
    case 44:
      if (SeatID !== undefined) {
        tracker.setTrackerFirstHand(SeatID)
      }
      break

    // TODO 初始牌 SpellID == 0
    case 72:
      if (Game.isGameStart && Datas?.length && !Game.round && !Game.phase) {
        const spellCards = Game.getSpellState(3731)
        const prev = Array.isArray(spellCards) ? spellCards : []
        const uniqueIds = new Set(prev.concat(Datas))

        Game.setSpellState(
          3731,
          Array.from(uniqueIds).filter((id) => id > 0)
        ) // 魔吕布 夺炁
      }
      break

    default:
      break
  }
}

// 同一回复会同时携带通用 Type 结果和技能结果，两层语义需要分别分发。
export function handleRoleSpellOptRep(msg = {}) {
  const { Datas, SeatID, SpellID, Type } = msg
  handleResultType(msg)

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

    // 鹰视
    case 7009:
      if (Type === 30 && Array.isArray(Datas) && Datas.length > 0) {
        revealCardsInProtocolZone(255, Datas, PROTOCOL_PILE_ZONE)
      }
      break

    // 嚣翻
    case 3336:
      if (Type === 50 && Array.isArray(Datas)) {
        revealCardsInProtocolZone(255, [...Datas].reverse(), PROTOCOL_PILE_ZONE, POSITION_BOTTOM)
      }
      break

    // 郭照 椒遇
    case 3571:
      if (Type === 10) Game.getSpellState(SpellID)?.add?.(Datas[0])
      break

    // 裴秀地图结果暂由地图消息链消费。
    case 4021:
    case 4022:
    default:
      break
  }
}
