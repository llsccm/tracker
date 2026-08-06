import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  CardConfig: {
    GetInstance: vi.fn()
  },
  Game: {
    getSpellState: vi.fn(),
    setSpellState: vi.fn()
  },
  SpellExtendConfig: {
    GetInstance: vi.fn()
  },
  getRenderedMainHandCardIDs: vi.fn(),
  renderPeiXiuMapWindow: vi.fn(),
  subscribeRenderedMainHandCardIDs: vi.fn(),
  unsubscribe: vi.fn(),
  listener: null
}))

vi.mock('@/config', () => ({
  CardConfig: mocks.CardConfig,
  SpellExtendConfig: mocks.SpellExtendConfig
}))
vi.mock('@/tracker', () => ({ Game: mocks.Game }))
vi.mock('@/tracker/view/PlayerHandView', () => ({
  getRenderedMainHandCardIDs: mocks.getRenderedMainHandCardIDs,
  subscribeRenderedMainHandCardIDs: mocks.subscribeRenderedMainHandCardIDs
}))
vi.mock('@/ui/PeiXiuMapWindow', () => ({
  renderPeiXiuMapWindow: mocks.renderPeiXiuMapWindow
}))

import {
  bindPeiXiuHandSuitColorRefresh,
  getRenderedPeiXiuHandSuitColors,
  refreshPeiXiuHandSuitColors,
  unbindPeiXiuHandSuitColorRefresh
} from '@/ui/PeiXiuHandMirror'

describe('裴秀主手牌花色镜像', () => {
  beforeEach(() => {
    unbindPeiXiuHandSuitColorRefresh()
    vi.clearAllMocks()
    mocks.listener = null
    mocks.subscribeRenderedMainHandCardIDs.mockImplementation((listener) => {
      mocks.listener = listener
      return mocks.unsubscribe
    })
  })

  it('重复绑定不会注册多个主手牌监听器，解绑后可以重新绑定', () => {
    bindPeiXiuHandSuitColorRefresh()
    bindPeiXiuHandSuitColorRefresh()

    expect(mocks.subscribeRenderedMainHandCardIDs).toHaveBeenCalledOnce()

    unbindPeiXiuHandSuitColorRefresh()
    expect(mocks.unsubscribe).toHaveBeenCalledOnce()

    bindPeiXiuHandSuitColorRefresh()
    expect(mocks.subscribeRenderedMainHandCardIDs).toHaveBeenCalledTimes(2)
  })

  it('从主视角渲染快照读取有效花色', () => {
    mocks.getRenderedMainHandCardIDs.mockReturnValue([11, 12, 13, 14, 15])
    mocks.CardConfig.GetInstance.mockReturnValue({
      getCardColor: (cardID) => ({ 11: 1, 12: 2, 13: 3, 14: 4, 15: 0 })[cardID]
    })

    expect(getRenderedPeiXiuHandSuitColors()).toEqual([1, 2, 3, 4])
  })

  it('手牌镜像变化后更新裴秀状态并重绘窗口', () => {
    const state = {
      usesMainHandMirror: true,
      result: { complete: true },
      handSuitColors: [1]
    }
    mocks.Game.getSpellState.mockReturnValue(state)
    mocks.getRenderedMainHandCardIDs.mockReturnValue([11, 12])
    mocks.CardConfig.GetInstance.mockReturnValue({
      getCardColor: (cardID) => ({ 11: 1, 12: 4 })[cardID]
    })
    mocks.SpellExtendConfig.GetInstance.mockReturnValue({ PeiXiuBonus: new Map() })

    refreshPeiXiuHandSuitColors()

    expect(mocks.Game.setSpellState).toHaveBeenCalledWith(4022, {
      ...state,
      handSuitColors: [1, 4]
    })
    expect(mocks.renderPeiXiuMapWindow).toHaveBeenCalledWith(
      { ...state, handSuitColors: [1, 4] },
      mocks.SpellExtendConfig.GetInstance.mock.results[0].value.PeiXiuBonus
    )
  })
})
