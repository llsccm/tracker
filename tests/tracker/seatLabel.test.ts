import { describe, expect, it } from 'vitest'
import { formatPlayerSeatLabel, getDisplayIdLabel } from '@/tracker/helper/seatLabel'

describe('座位标签格式化', () => {
  it('按顺位标签和武将名生成座位覆盖层文字', () => {
    const player = { fixedViewId: 2, generals: [101, 202] }

    expect(
      formatPlayerSeatLabel(player, {
        getGeneralName: (generalID) => ({ 101: '张飞', 202: '关羽' })[generalID]
      })
    ).toBe('张飞 关羽|二号位')
  })

  it('没有已知武将时回退到顺位文字', () => {
    expect(formatPlayerSeatLabel({ fixedViewId: undefined, generals: [0] })).toBe('一号位|一号位')
  })

  it('未知顺位保留数字标签', () => {
    expect(getDisplayIdLabel(9)).toBe('9')
    expect(formatPlayerSeatLabel({ fixedViewId: 9, generals: [] })).toBe('9号位|9号位')
  })
})
