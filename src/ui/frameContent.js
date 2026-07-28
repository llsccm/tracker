import { toClipboard } from '../utils/clipboard'

const USER_INFO_SELECTORS = ['#uuid', '#nickName']

function getUserInfoCopyValue(element) {
  const text = element.textContent ?? ''
  const separatorIndex = text.indexOf('：')
  return separatorIndex === -1 ? text : text.slice(separatorIndex + 1)
}

function copyUserInfo(value) {
  return toClipboard(value, false)
}

function getDefaultRoot() {
  return typeof document === 'undefined' ? null : document
}

function getDefaultTimer() {
  return typeof setTimeout === 'undefined' ? null : setTimeout
}

export function executeEmbeddedScripts(container) {
  // 查找并执行 contentDiv 中的所有 <script> 标签
  const scripts = container.querySelectorAll('script')
  scripts.forEach((oldScript) => {
    const newScript = document.createElement('script')
    if (oldScript.src) {
      // 如果是外部脚本
      newScript.src = oldScript.src
      newScript.async = oldScript.async
    } else {
      // 如果是内联脚本
      newScript.textContent = oldScript.textContent
    }
    // 将新脚本插入到 document.body 中以执行
    document.body.appendChild(newScript)
    // 删除原有的 script 标签，避免重复执行
    oldScript.remove()
  })
}

export function getPanelContentInner(panelContent) {
  if (!panelContent) return null

  let inner = panelContent.querySelector(':scope > .panel-content-inner')
  if (!inner) {
    inner = panelContent.ownerDocument.createElement('div')
    inner.className = 'panel-content-inner'
    while (panelContent.firstChild) {
      inner.appendChild(panelContent.firstChild)
    }
    panelContent.appendChild(inner)
  }

  return inner
}

export function bindPanelHeaders() {
  const panelHeaders = document.querySelectorAll('.panel-header')

  panelHeaders.forEach((header) => {
    const panelContent = header.nextElementSibling
    if (!panelContent?.classList?.contains('panel-content')) return

    getPanelContentInner(panelContent)
    // panelContent.style.removeProperty('max-height')

    header.addEventListener('click', function () {
      this.classList.toggle('active')
      // panelContent.style.removeProperty('max-height')
    })
  })
}

export function bindTabBar() {
  const tabBtns = document.querySelectorAll('.tab-btn')
  const tabPanels = document.querySelectorAll('.tab-panel')

  tabBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      tabBtns.forEach((b) => b.classList.remove('active'))
      tabPanels.forEach((p) => p.classList.remove('active'))

      btn.classList.add('active')
      const target = document.getElementById(btn.dataset.tab)
      if (target) target.classList.add('active')
    })
  })
}

export function bindUserInfoCopyActions({
  root = getDefaultRoot(),
  copy = copyUserInfo,
  setTimer = getDefaultTimer()
} = {}) {
  if (!root) return

  USER_INFO_SELECTORS.forEach((selector) => {
    const element = root.querySelector(selector)
    if (!element) return

    element.onclick = async () => {
      const originalText = element.textContent ?? ''
      await copy(getUserInfoCopyValue(element))
      element.textContent = '复制成功'
      setTimer?.(() => {
        if (element.textContent === '复制成功') element.textContent = originalText
      }, 500)
    }
  })
}

export function initInjectedInterface({ container, expandJiePanel, bindDelegatedTooltips }) {
  executeEmbeddedScripts(container)
  bindPanelHeaders()
  bindTabBar()
  bindUserInfoCopyActions({ root: container })
  expandJiePanel()
  bindDelegatedTooltips()
}
