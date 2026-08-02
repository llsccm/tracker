import { describe, expect, it, vi } from 'vitest'
import { bindTabBar, bindUserInfoCopyActions } from '../../src/ui/frameContent'

function createRoot(entries) {
  const elements = new Map(entries)
  return {
    querySelector(selector) {
      return elements.get(selector) ?? null
    }
  }
}

describe('用户信息复制', () => {
  it('点击时读取 HTML 当前数据并直接触发 copy', () => {
    const uuidElement = { textContent: 'id：10001', onclick: null }
    const nicknameElement = { textContent: '昵称：测试：昵称', onclick: null }
    const root = createRoot([
      ['#uuid', uuidElement],
      ['#nickName', nicknameElement]
    ])
    const copy = vi.fn()

    bindUserInfoCopyActions({ root, copy })

    uuidElement.textContent = 'id：10002'
    uuidElement.onclick()
    nicknameElement.onclick()

    expect(copy.mock.calls).toEqual([['10002'], ['测试：昵称']])
    expect(uuidElement.textContent).toBe('id：10002')
    expect(nicknameElement.textContent).toBe('昵称：测试：昵称')
  })

  it('支持键盘 Enter 与 Space 键触发复制', () => {
    const uuidElement = { textContent: 'id：10001', onkeydown: null }
    const root = createRoot([['#uuid', uuidElement]])
    const copy = vi.fn()

    bindUserInfoCopyActions({ root, copy })

    const preventDefault = vi.fn()
    uuidElement.onkeydown({ key: 'Enter', preventDefault })
    expect(preventDefault).toHaveBeenCalled()
    expect(copy).toHaveBeenCalledWith('10001')

    uuidElement.onkeydown({ key: ' ', preventDefault })
    expect(copy).toHaveBeenCalledWith('10001')
    expect(copy).toHaveBeenCalledTimes(2)
  })
})

describe('Tab 栏绑定', () => {
  it('在指定 root 内绑定 tab 切换', () => {
    function createMockElement(id, classes, dataset = {}) {
      const classListSet = new Set(classes)
      const listeners = {}
      return {
        id,
        dataset,
        classList: {
          add(cls) { classListSet.add(cls) },
          remove(cls) { classListSet.delete(cls) },
          contains(cls) { return classListSet.has(cls) }
        },
        addEventListener(event, fn) {
          listeners[event] = fn
        },
        click() {
          if (listeners.click) listeners.click()
        }
      }
    }

    const btn1 = createMockElement('btn1', ['tab-btn', 'active'], { tab: 'panel1' })
    const btn2 = createMockElement('btn2', ['tab-btn'], { tab: 'panel2' })
    const panel1 = createMockElement('panel1', ['tab-panel', 'active'])
    const panel2 = createMockElement('panel2', ['tab-panel'])

    const root = {
      querySelectorAll(selector) {
        if (selector === '.tab-btn') return [btn1, btn2]
        if (selector === '.tab-panel') return [panel1, panel2]
        return []
      },
      querySelector(selector) {
        if (selector === '#panel2') return panel2
        if (selector === '#panel1') return panel1
        return null
      }
    }

    bindTabBar({ root })

    btn2.click()

    expect(btn1.classList.contains('active')).toBe(false)
    expect(panel1.classList.contains('active')).toBe(false)
    expect(btn2.classList.contains('active')).toBe(true)
    expect(panel2.classList.contains('active')).toBe(true)
  })
})
