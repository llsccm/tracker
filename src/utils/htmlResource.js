export const INTERFACE_HTML_URL = 'https://www.desuwa.link/sgs/iframe.html'

export async function loadInterfaceHtml(force = false) {
  const response = await fetch(INTERFACE_HTML_URL, { cache: force ? 'reload' : 'default' })

  if (!response.ok) {
    throw new Error(`加载小抄界面失败：${response.status} ${response.statusText}`)
  }

  return response.text()
}
