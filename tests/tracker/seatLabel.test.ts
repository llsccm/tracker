import { describe, expect, it } from 'vitest'
import { formatPlayerSeatLabel, getDisplayIdLabel } from '@/tracker/helper/seatLabel'
import { updateSeatLabel } from '@/tracker/view/PlayerHandView'

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

  it('将格式化标签写入对应的座位覆盖层', () => {
    let propertyName = ''
    let propertyValue = ''
    const doc = {
      getElementById: (id: string) => {
        if (id !== '2') return null
        return {
          style: {
            setProperty: (name: string, value: string) => {
              propertyName = name
              propertyValue = value
            }
          }
        }
      }
    } as unknown as Document

    updateSeatLabel(doc, { fixedViewId: 2, generals: [] }, ['', '甲', '乙'])

    expect(propertyName).toBe('--No-content')
    expect(propertyValue).toBe('"乙号位|乙号位"')
  })
})
