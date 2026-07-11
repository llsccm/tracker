const retainedLogicMessages = new Set([
  // 生命周期与基础身份：只用于初始化用户身份、重建小窗和基础时间同步。
  'ClientLoginRep',
  'ClientUserDataCounterNtf',
  'SmsgUpdateTaskListToClient',
  'ClientGuildMemberChangeNtf',
  'MsgReconnectGame',
  'MsgHeartAliveRep',

  // 聊天输出/聊天消息兼容：仅保留消息文本过滤、房间号链接化与基础输出兼容。
  'decodeSSCChatmsgNtf',
  'decodeClientActSysBroadMsgListResp',

  // 屏蔽特效
  'CClientGameRewardPointNTF',
  'ClientGeneralSkinRep',

  // 山河图展示：仅绘制/隐藏山河图信息，不触发自动操作。
  'decodeRogueLikeDataSync',
  'ClientActivitysetDataRep',
  'decodeRougeBaseInfoRep',

  // 牌局与座位状态：维护记牌器座位、轮次、牌堆初始化与游戏结束清理。
  'MsgGameShowFigure',
  'decodeGsClientUserSeatFlagNtf',
  'GsCModifyUserseatNtf',
  'GsCUpdateRoleDataNtf',
  'MsgGameOver',
  'ClientLeavetableRep',
  'MsgGamePlayCardNtf',
  'SmsgGameSetCharacter',
  'GsCGuoZhanSetCharacter',
  'GsCFirstPhaseRole',
  'MsgGameTurnNtf',
  'GsCGamephaseNtf',
  'GsCUpdateRoleDataExNtf',
  'MsgGameRoundNtf',
  'ClientRecommendShopItemRep',

  // 记牌器核心消息：维护已知牌、牌区移动、手牌展示、点数推理和小抄辅助结果。
  'GsCUpdateHpNtf',
  'GsCTriggerSpellNew',
  'ClientHappyGetFriendHandcardRep',
  'MsgNtfUseCardType',
  'PubGsCUseCard',
  'PubGsCUseSpell',
  'GsCRoleOptTargetNtf',
  'CGsRoleSpellOptRep',
  'PubGsCMoveCard'
])

export function isRetainedLogicMessage(className) {
  return retainedLogicMessages.has(className)
}
