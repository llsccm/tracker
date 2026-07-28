import { describe, expect, it, vi } from 'vitest'
import { bindUserInfoCopyActions } from '../../src/ui/frameContent'

function createRoot(entries) {
  const elements = new Map(entries)
  return {
    querySelector(selector) {
      return elements.get(selector) ?? null
    }
  }
}

describe('用户信息复制', () => {
  it('点击时读取 HTML 当前数据并恢复原文本', async () => {
    const uuidElement = { textContent: 'id：10001', onclick: null }
    const nicknameElement = { textContent: '昵称：测试：昵称', onclick: null }
    const root = createRoot([
      ['#uuid', uuidElement],
      ['#nickName', nicknameElement]
    ])
    const copy = vi.fn()
    const timers = []

    bindUserInfoCopyActions({
      root,
      copy,
      setTimer(callback) {
        timers.push(callback)
      }
    })

    uuidElement.textContent = 'id：10002'
    await uuidElement.onclick()
    await nicknameElement.onclick()

    expect(copy.mock.calls).toEqual([['10002'], ['测试：昵称']])
    expect(uuidElement.textContent).toBe('复制成功')
    expect(nicknameElement.textContent).toBe('复制成功')

    timers.forEach((callback) => callback())

    expect(uuidElement.textContent).toBe('id：10002')
    expect(nicknameElement.textContent).toBe('昵称：测试：昵称')
  })

  it('恢复提示时不覆盖期间写入的新 HTML 数据', async () => {
    const uuidElement = { textContent: 'id：10001', onclick: null }
    const root = createRoot([['#uuid', uuidElement]])
    const timers = []

    bindUserInfoCopyActions({
      root,
      copy: vi.fn(),
      setTimer(callback) {
        timers.push(callback)
      }
    })

    await uuidElement.onclick()
    uuidElement.textContent = 'id：10003'
    timers[0]()

    expect(uuidElement.textContent).toBe('id：10003')
  })
})
