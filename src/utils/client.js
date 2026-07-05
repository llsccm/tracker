import { addTooltip } from './notification.js'

window.XC = new EventTarget()
window.XC.moveType = {
  0: '预操作',
  1: '摸牌',
  2: '使用',
  3: '打出',
  4: '弃置',
  5: ('选择/洛神', '获得'),
  6: ('判定/弹窗', '获得'),
  7: '弹窗放回',
  8: ('标记/移动/交给', '获得'),
  9: '置入',
  10: '闪电转移',
  11: '交换',
  12: '重铸',
  13: '拼点',
  14: '判定后',
  15: ('移动到(延时锦囊/操控牌堆/场外)', '移动'),
  16: '使用后',
  17: '打出后',
  18: '获得',
  19: ('移动(拼点后/弹窗弃置/标记传递)', '移动'),
  20: '锻造',
  21: '展示',
  22: '替换装备',
  255: '系统'
}
window.XC.Rpvp = [
  2009, 2021, 2036, 2037, 2042, 2043, 2048, 2049, 2051, 2059, 2060, 2069, 2070, 2076, 2077, 2078,
  2088, 2093, 2094, 2095, 2096, 2098, 2099, 2100, 2101, 2103, 2104, 2120, 2121, 2122, 2143, 2150,
  2154, 2162, 2163, 2164, 2165, 2174, 2196, 2197, 2198, 2209, 2210, 2226, 2227, 2249, 2250, 2251,
  2261, 2262, 2263, 2287, 2288, 2289, 2294, 2295, 2297, 2315, 2317, 2319, 2320, 3022, 3030, 3048,
  3082, 3095, 3148, 3176, 3180, 3219, 3230, 3292
]

export const localGet = function (key, value = null, local = true) {
  let localString
  if (!localString && typeof localStorage !== 'undefined') localString = localStorage.getItem(key)
  if (!localString) return value

  try {
    // 某些情况会出现获取到undefined
    return JSON.parse(localString)
  } catch (e) {
    console.error(e)
    addTooltip(`获取"${key}"出现了问题，已恢复默认值`)
    localSet(key, value, local)
    return value
  }
}

export const localSet = async function (key, value) {
  if (typeof localStorage !== 'undefined') localStorage.setItem(key, JSON.stringify(value))
}

export const localDel = async function (key) {
  if (typeof localStorage !== 'undefined') localStorage.removeItem(key)
}
