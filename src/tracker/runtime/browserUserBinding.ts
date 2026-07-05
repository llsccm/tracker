import { toClipboard } from '@/utils/clipboard'
import type { UserModel } from '../userModel'

type CopyFunction = (value: unknown) => Promise<void> | void
type TimerFunction = typeof setTimeout

interface UserDomBindingOptions {
  document?: Document | null
  copy?: CopyFunction
  setTimer?: TimerFunction | null
}

async function copyToClipboard(value: unknown): Promise<void> {
  toClipboard(value, false)
}

function getDefaultDocument(): Document | null {
  return typeof document === 'undefined' ? null : document
}

function getDefaultTimer(): TimerFunction | null {
  return typeof setTimeout === 'undefined' ? null : setTimeout
}

function bindCopyAction(
  element: HTMLElement,
  getValue: () => unknown,
  label: () => string,
  { copy = copyToClipboard, setTimer = getDefaultTimer() }: UserDomBindingOptions = {}
): void {
  element.onclick = async function () {
    await copy(getValue())
    element.innerText = '复制成功'
    setTimer?.(() => {
      element.textContent = label() + getValue()
    }, 500)
  }
}

export function updateUserDom(
  user: UserModel,
  property: PropertyKey,
  value: unknown,
  options: UserDomBindingOptions = {}
): void {
  const doc = options.document ?? getDefaultDocument()
  if (!doc) return

  if (property === 'userID') {
    const uuidEl = doc.getElementById('uuid')
    if (!uuidEl) return

    uuidEl.innerText = 'id：' + value
    bindCopyAction(
      uuidEl,
      () => user.userID,
      () => 'id：',
      options
    )
  }

  if (property === 'nickname') {
    const nickNameEl = doc.getElementById('nickName')
    if (!nickNameEl) return

    nickNameEl.textContent = '昵称：' + user.nickname
    bindCopyAction(
      nickNameEl,
      () => user.nickname,
      () => '昵称：',
      options
    )
  }
}
