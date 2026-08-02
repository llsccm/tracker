import { afterEach, describe, expect, it, vi } from 'vitest'
import { wait } from '@/utils'

describe('wait', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('默认在首次执行前等待 interval', async () => {
    vi.useFakeTimers()
    const callback = vi.fn(() => 'ready')

    const result = wait(callback, 1, 200)

    expect(callback).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(199)
    expect(callback).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    await expect(result).resolves.toBe('ready')
    expect(callback).toHaveBeenCalledTimes(1)
  })

  it('immediate 为 true 时立即执行首次探测', async () => {
    vi.useFakeTimers()
    const callback = vi.fn(() => 'RogueSmallMapScene')

    const result = wait(callback, 20, 200, { immediate: true })

    expect(callback).toHaveBeenCalledTimes(1)
    await expect(result).resolves.toBe('RogueSmallMapScene')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('立即探测未命中时等待后执行剩余次数', async () => {
    vi.useFakeTimers()
    const callback = vi.fn().mockReturnValueOnce(undefined).mockReturnValueOnce('ready')

    const result = wait(callback, 2, 200, { immediate: true })

    expect(callback).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(199)
    expect(callback).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    await expect(result).resolves.toBe('ready')
    expect(callback).toHaveBeenCalledTimes(2)
  })
})
