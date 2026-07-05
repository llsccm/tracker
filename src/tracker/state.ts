import { createBrowserStorageAdapter, createConfigStore } from './configStore'
import type { ConfigEffects } from './configStore'

interface GlobalState {
  isFrameAdd: boolean
  inviteName: string
  goods: unknown[]
  lotteries: unknown[]
  closeIframe: boolean
  recGoods: Record<string, unknown>
}

interface RogueMapState {
  difficulty: number
  itemId: unknown[]
  res: unknown[]
  general: number
}

interface UIState {
  seatWidthPercent: number
  firstUpdateSeatUI: boolean
  scoreFrameTotal: number
  scoreFrameIndex: number
  paddingLeft: number
  paddingRight: number
  paddingTop: number
  paddingBottom: number
  paddingLeftTopExtra: number
  selectStarted: boolean
  leftRightTop: number
  stackCardAreaHeight: number
  stackCardAreaY: number
  MAX_SEAT_WIDTH: number
  inPopFirstTarget: boolean
  unscaledWidth: number
  unscaledHeight: number
  MAX_HEIGHT: number
  MAX_WIDTH: number
  scale: number
  selfSeatUiUnscaledHeight: number
  rightBarWidth: number
  nativeSeatRects: unknown[]
  gameRoundRect: unknown
  seatUIs: unknown[]
  cities: unknown[]
  friendGeneral: number
  ORDER_LABELS: string[]
}

function getBrowserStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

function getBrowserEventTarget(): Window | null {
  return typeof window === 'undefined' ? null : window
}

const effectRegistry: ConfigEffects = {
  padding: (value) => {
    if (typeof window !== 'undefined') {
      window.padding = value
    }
  }
}

const globalConfig = createConfigStore({
  storage: createBrowserStorageAdapter(getBrowserStorage()),
  eventTarget: getBrowserEventTarget(),
  effects: effectRegistry
})

const globalState: GlobalState = {
  isFrameAdd: false,
  inviteName: '',
  goods: [],
  lotteries: [],
  closeIframe: false,
  recGoods: {}
}

const rogueMap: RogueMapState = {
  difficulty: 0,
  itemId: [],
  res: [],
  general: 0
}

const UI: UIState = {
  seatWidthPercent: 0.3,
  firstUpdateSeatUI: false,
  scoreFrameTotal: 10,
  scoreFrameIndex: 0,
  paddingLeft: 10,
  paddingRight: 15,
  paddingTop: 30,
  paddingBottom: 0,
  paddingLeftTopExtra: 0,
  selectStarted: false,
  leftRightTop: 20,
  stackCardAreaHeight: 0,
  stackCardAreaY: 0,
  MAX_SEAT_WIDTH: 149,
  inPopFirstTarget: false,
  unscaledWidth: 146,
  unscaledHeight: 172,
  MAX_HEIGHT: 180,
  MAX_WIDTH: 150,
  scale: 1,
  selfSeatUiUnscaledHeight: 178,
  rightBarWidth: 221,
  nativeSeatRects: [],
  gameRoundRect: null,
  seatUIs: [], // 描绘明牌框
  cities: [], // 描绘山河图 城市
  friendGeneral: 0,
  ORDER_LABELS: ['', '一', '二', '三', '四', '五', '六', '七', '八']
}

export { globalConfig, globalState, rogueMap, UI }
