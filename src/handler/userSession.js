import { initFrame } from '../dom'
import { user } from '../tracker'

const USER_IDENTITY_MESSAGES = new Set([
  'ClientLoginRep',
  'ClientUserDataCounterNtf',
  'SmsgUpdateTaskListToClient',
  'ClientGuildMemberChangeNtf'
])

export function handleUserSession(msg, className) {
  if (user.userID !== 0 || !USER_IDENTITY_MESSAGES.has(className)) return

  // 渠道服没有 localStorage.SGS_LASTLOGIN_ACCOUNT，通过协议同步身份。
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
