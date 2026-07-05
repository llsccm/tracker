// 定义日期字符串

export function dateFunction(timestamp, days) {
  // 将字符串timestamp转换为 Date 对象
  const dateObj = new Date(parseInt(timestamp))

  // 减去5天
  dateObj.setDate(dateObj.getDate() - days)

  // 手动格式化输出日期，保持原始时间不受时区影响
  const year = dateObj.getFullYear()
  const month = String(dateObj.getMonth() + 1).padStart(2, '0') // 月份是从0开始的，所以要加1
  const day = String(dateObj.getDate()).padStart(2, '0')

  // 拼接成所需的格式
  return [`${year}-${month}-${day}`, dateObj]
}
export const getTomorrow = (today) => {
  const d = new Date(`${today.slice(0, 4)}-${today.slice(4, 6)}-${today.slice(6, 8)}`)
  d.setDate(d.getDate() + 1)
  return d.toISOString().slice(0, 10).replace(/-/g, '')
}
export const formatDate = (dateStr) =>
  `${dateStr.slice(0, 4)}年${dateStr.slice(4, 6)}月${dateStr.slice(6, 8)}日`

export const getToday = () => new Date().toISOString().slice(0, 10).replace(/-/g, '')
