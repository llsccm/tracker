export const timer = {
  tasks: {},
  corr: 0, // 服务器时间与本地时间差
  shift: 0, // 人为修改本地游戏时间差
  now(real = true) {
    // 当前服务器时间 now(false)本地游戏时间
    return Date.now() + this.corr + (real ? 0 : this.shift)
  },
  sync(arg) {
    // 时间同步
    this.corr = (arg.ServerTime - 8 * 3600) * 1000 - Date.now()
    if (this.shift) arg.ServerTime += (this.shift / 1000) >> 0
  },
  update() {
    // 阶段 5B：状态层不再主动向游戏运行时发送心跳，仅保留本地时间修正入口。
  },
  modify(time = null) {
    // 修改本地游戏时间
    this.shift = !time ? 0 : time - this.now()
    this.update()
  },
  local(time) {
    // 输出当地时间字符串
    const date = new Date(time ?? this.now())
    const timezoneOffset = date.getTimezoneOffset()
    date.setMinutes(date.getMinutes() - timezoneOffset)
    return date.toISOString()
  },
  loop(key, callback, interval, times = Infinity, done) {
    // 循环
    this.clear(key)
    const intervalId = setInterval(() => {
      callback()
      if (--times <= 0) {
        this.clear(key)
        if (typeof done === 'function') done()
      }
    }, interval)
    this.tasks[key] = { intervalId, callback }
    return this.tasks[key].intervalId
  },
  delay(key, callback, timeout) {
    // 延时
    this.clear(key)
    const timeoutId = setTimeout(() => {
      this.clear(key)
      callback()
    }, timeout)
    this.tasks[key] = { timeoutId, callback }
    return this.tasks[key].timeoutId
  },
  set(key, callback, time, interval = 1800000) {
    // 定时
    this.clear(key)
    const now = this.now()
    const left = (time ?? now) - now
    if (left > 1) {
      const timeoutId = setTimeout(
        () => this.set(key, callback, time, interval),
        left < interval ? left : interval
      )
      this.tasks[key] = { timeoutId, callback }
    } else callback()
  },
  trigger(key) {
    // 触发
    if (!this.tasks[key]) return null
    const { timeoutId, callback } = this.tasks[key]
    if (timeoutId) {
      clearTimeout(timeoutId)
      delete this.tasks[key]
    }
    if (typeof callback != 'function') return false
    callback()
    return true
  },
  clear(...keys) {
    // 取消
    if (keys[0] === true) keys = Object.keys(this.tasks)
    keys
      .filter((key) => this.tasks[key])
      .map((key) => {
        if (!this.tasks[key]) return null
        const { intervalId, timeoutId } = this.tasks[key]
        if (timeoutId) clearTimeout(timeoutId)
        if (intervalId) clearInterval(intervalId)
        delete this.tasks[key]
        return key
      })
  }
}
