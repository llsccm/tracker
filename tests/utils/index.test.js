import { describe, expect, it } from 'vitest'
import { n2N } from '@/utils'

describe('n2N', () => {
  it('A 为 false 时保留 1 的数字类型', () => {
    expect(n2N(1, false)).toBe(1)
  })
})
