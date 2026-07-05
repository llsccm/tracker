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

export function initInjectedInterface({ container, expandJiePanel, bindDelegatedTooltips }) {
  executeEmbeddedScripts(container)
  bindPanelHeaders()
  expandJiePanel()
  bindDelegatedTooltips()
}
