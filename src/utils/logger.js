function readDebugLogSwitch() {
  let rawValue
  try {
    if (typeof localStorage === 'undefined') return false
    rawValue = localStorage.getItem('DEBUG_LOG_SWITCH')
  } catch {
    return false
  }

  if (rawValue === null) return false

  try {
    return Boolean(JSON.parse(rawValue))
  } catch {
    return false
  }
}

function isLoggerEnabled() {
  return Boolean(import.meta.env.DEV || readDebugLogSwitch())
}

function createLogger(scope) {
  const prefix = `[DXC][${scope}]`

  const print = (method, args) => {
    if (!isLoggerEnabled()) return
    const printer = console[method] || console.info
    printer.call(console, prefix, ...args)
  }

  return {
    get enabled() {
      return isLoggerEnabled()
    },
    debug(...args) {
      print('debug', args)
    },
    info(...args) {
      print('info', args)
    },
    warn(...args) {
      print('warn', args)
    },
    group(label, ...args) {
      if (!isLoggerEnabled()) return
      const group = console.groupCollapsed || console.group || console.info
      group.call(console, `${prefix} ${label}`, ...args)
    },
    groupEnd() {
      if (!isLoggerEnabled()) return
      console.groupEnd?.()
    }
  }
}

export const trackerLogger = createLogger('tracker')
