import { describe, expect, it, vi } from 'vitest'
import { createConfigStore, createMemoryStorageAdapter } from '@/tracker/configStore'
import { globalConfig } from '@/tracker/state'
import { createUserModel, user } from '@/tracker/user'

describe('state/user Node 导入边界', () => {
  it('globalConfig 在无 localStorage/window 时使用内存存储', () => {
    expect(globalThis.window).toBeUndefined()
    expect(globalThis.localStorage).toBeUndefined()

    expect(globalConfig.padding).toBe(0)
    globalConfig.padding = 12
    expect(globalConfig.padding).toBe(12)
  })

  it('纯配置 store 可使用注入的 storage adapter', () => {
    const storage = createMemoryStorageAdapter({ PADDING: 8 })
    const config = createConfigStore({ storage })

    expect(config.padding).toBe(8)
    expect(config.skipAdWindowSwitch).toBe(true)
    expect(config.skipPackageWindowSwitch).toBe(false)
    config.padding = 16
    config.skipAdWindowSwitch = false
    config.skipPackageWindowSwitch = true
    expect(JSON.parse(storage.getItem('PADDING'))).toBe(16)
    expect(JSON.parse(storage.getItem('SKIP_AD_WINDOW_SWITCH'))).toBe(false)
    expect(JSON.parse(storage.getItem('SKIP_PACKAGE_WINDOW_SWITCH'))).toBe(true)
  })

  it('配置 storage 写入失败时拒绝更新内存态', () => {
    const storage = {
      getItem() {
        throw new Error('storage blocked')
      },
      setItem() {
        throw new Error('storage blocked')
      },
      removeItem() {
        throw new Error('storage blocked')
      }
    }
    const effect = vi.fn()
    const eventTarget = new EventTarget()
    const listener = vi.fn()
    eventTarget.addEventListener('xc:config-change', listener)
    const config = createConfigStore({
      storage,
      eventTarget,
      effects: { padding: effect }
    })

    expect(config.padding).toBe(0)
    expect(() => {
      config.padding = 24
    }).toThrow(TypeError)
    expect(config.padding).toBe(0)
    expect(effect).not.toHaveBeenCalled()
    expect(listener).not.toHaveBeenCalled()
  })

  it('用户数据模型独立创建与独立更新', () => {
    const model = createUserModel()

    model.userID = 10001
    model.nickname = '测试昵称'

    expect(model.userID).toBe(10001)
    expect(model.nickname).toBe('测试昵称')

    expect(() => {
      user.userID = 10002
      user.nickname = 'Node 导入'
    }).not.toThrow()
  })
})
