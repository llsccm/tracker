const ERROR_KEY = 'XC_LAST_ERROR'

function formatErrorTime() {
  return new Date().toLocaleString()
}

function parseStack(stack = '') {
  const match = String(stack || '').match(/(\d+):(\d+)/)
  if (!match) return { line: '', column: '' }
  return { line: match[1], column: match[2] }
}

function buildRecord(error, source = 'unknown', extra = {}) {
  const msg = error?.message || error?.reason?.message || error?.reason || error || '未知错误'
  const stack = error?.stack || error?.reason?.stack || ''
  const { line, column } = parseStack(stack)

  return {
    time: formatErrorTime(),
    source,
    message: String(msg),
    stack: String(stack || ''),
    line,
    column,
    href: location.href,
    ...extra
  }
}

function saveRecord(record) {
  try {
    localStorage.setItem(ERROR_KEY, JSON.stringify(record))
  } catch (e) {
    console.info('[error-notifier] save failed', e)
  }
}

export function notifyScriptError(error, source = 'unknown', extra = {}) {
  const record = buildRecord(error, source, extra)
  saveRecord(record)
  window.__XC_LAST_ERROR__ = record
  return record
}

export function getLastScriptError() {
  try {
    const value = localStorage.getItem(ERROR_KEY)
    return value ? JSON.parse(value) : null
  } catch (e) {
    console.info('[error-notifier] read failed', e)
    return null
  }
}

export function clearLastScriptError() {
  try {
    localStorage.removeItem(ERROR_KEY)
  } catch (e) {
    console.info('[error-notifier] clear failed', e)
  }
}
