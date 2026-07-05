const CHAT_ROOM_LINK_PREFIX = 'ATtextBagProp*&.!**.%#点击加入'
const CHAT_ROOM_KEYWORD_RE = /(kj|抗金|主忠|演武)/i
const CHAT_ROOM_ID_RE = /\d{3,8}/g
const CHAT_ROOM_MODE_ID = 74
const CHAT_ROOM_SECTION = 4

export function extractChatRoomId(chatMsg) {
  chatMsg = String(chatMsg || '')
  if (!CHAT_ROOM_KEYWORD_RE.test(chatMsg)) return ''
  const ids = chatMsg.match(CHAT_ROOM_ID_RE) || []
  if (!ids.length) return ''
  return ids[0]
}

export function getChatRoomLinkText(roomId) {
  roomId = String(roomId || '').replace(/\D/g, '')
  if (!roomId) return ''
  return `@[点击加入${roomId}]`
}

function parseChatRoomHref(href) {
  href = String(href || '')
  if (!href.startsWith(CHAT_ROOM_LINK_PREFIX)) return ''
  return href.slice(CHAT_ROOM_LINK_PREFIX.length).replace(/\D/g, '')
}

export function createChatRoomLink(laya, wait, redefine) {
  let pendingRoomId = ''
  let itemPatched = false
  let joining = false
  installChatItemLinkPatch()

  function getChatRoomListView() {
    const roomListView = laya.scene?.roomListView
    if (!roomListView) return null
    if (roomListView.modeId != CHAT_ROOM_MODE_ID || roomListView.groupId != CHAT_ROOM_SECTION)
      return null
    const list = roomListView.tableDataList || roomListView.hallManager?.tableList
    if (!Array.isArray(list)) return null
    return roomListView
  }

  function focusChatRoomMode() {
    const ctx = laya.class('GameContext')
    if (ctx) {
      ctx.ReqEnterModeID = CHAT_ROOM_MODE_ID
      ctx.ReqEnterGroupID = CHAT_ROOM_SECTION
      ctx.HallEnterModeID = CHAT_ROOM_MODE_ID
      ctx.HallEnterGroupID = CHAT_ROOM_SECTION
      ctx.SetModeType?.(CHAT_ROOM_MODE_ID, CHAT_ROOM_SECTION)
    }
    const roomListView = laya.scene?.roomListView
    if (!roomListView) return
    roomListView.modeId = CHAT_ROOM_MODE_ID
    roomListView.groupId = CHAT_ROOM_SECTION
    roomListView.onShowOfWindow?.()
    roomListView.hallManager?.EnterPageReq?.(CHAT_ROOM_MODE_ID, CHAT_ROOM_SECTION)
  }

  async function consumePendingRoom() {
    if (!pendingRoomId || joining) return false
    joining = true
    try {
      const roomId = pendingRoomId
      focusChatRoomMode()
      const roomListView = await wait(
        () => {
          if (laya.scene?.SceneName != 'HallScene') return null
          return getChatRoomListView()
        },
        40,
        200
      )
      if (!roomListView) return false
      const tableId = 100000 * (1000 * CHAT_ROOM_SECTION + CHAT_ROOM_MODE_ID) + Number(roomId)
      pendingRoomId = ''
      const roomControler = laya.class('RoomControler')
      if (typeof roomControler?.SendJoinTable != 'function') {
        pendingRoomId = roomId
        return false
      }
      console.info('[chat-room] join room', roomId, tableId, CHAT_ROOM_MODE_ID, CHAT_ROOM_SECTION)
      roomControler.SendJoinTable(tableId, CHAT_ROOM_MODE_ID, 255, 0, '', 0)
      return true
    } finally {
      joining = false
    }
  }

  function installChatItemLinkPatch() {
    if (chatItemLinkPatch()) return
    wait(() => chatItemLinkPatch(), 40, 500)
  }

  function chatItemLinkPatch() {
    if (itemPatched) return true
    const chatViewUI = laya.scene?.chatViewUI || laya.gamescene?.chatViewUI
    if (!chatViewUI || typeof chatViewUI.getHtmlBase != 'function') return false
    const html = chatViewUI.getHtmlBase({
      MessageHtml: `<font color='#FFFFFF'>${CHAT_ROOM_LINK_PREFIX}12345</font>`,
      chatMsg: '12345kj',
      ChannelNum: 7,
      VipLevel: 0,
      OfficerLv: 0
    })
    const proto = html?.__proto__
    if (!proto) return false
    const patched = redefine(proto, 'linkHandler', {
      value: function (href) {
        const roomId = parseChatRoomHref(href)
        if (roomId) {
          requestEnterRoom(roomId)
          return
        }
        return this.__linkHandler?.apply(this, arguments)
      }
    })
    itemPatched = !!(patched || proto.__linkHandler)
    return itemPatched
  }

  function requestEnterRoom(roomId) {
    roomId = String(roomId || '').replace(/\D/g, '')
    if (!roomId) return false
    pendingRoomId = roomId
    console.info('[chat-room] request enter', roomId, laya.scene?.SceneName)
    if (laya.scene?.SceneName == 'HallScene') {
      consumePendingRoom()
      return true
    }
    focusChatRoomMode()
    const sceneManager = laya.class('SceneManager')
    const roomControler = laya.class('RoomControler')
    if (sceneManager?.IsGameScene && typeof roomControler?.SendLeaveTable == 'function') {
      roomControler.SendLeaveTable(1, true)
      return true
    }
    if (typeof sceneManager?.SwitchToHallScene == 'function') {
      sceneManager.SwitchToHallScene()
      return true
    }
    if (typeof sceneManager?.SwitchScene == 'function') {
      sceneManager.SwitchScene('HallScene')
      return true
    }
    return false
  }

  function handleSceneChange() {
    installChatItemLinkPatch()
    if (pendingRoomId && laya.scene?.SceneName == 'HallScene') consumePendingRoom()
  }
  return {
    handleSceneChange,
    requestEnterRoom
  }
}
