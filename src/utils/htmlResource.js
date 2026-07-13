export const INTERFACE_HTML_URL = import.meta.env.DEV
  ? 'http://127.0.0.1:5500/html/iframe.html'
  : 'https://www.desuwa.link/sgs/iframe.html'

export async function loadInterfaceHtml(force = false) {
  const response = await fetch(INTERFACE_HTML_URL, { cache: force ? 'reload' : 'default' })

  if (!response.ok) {
    throw new Error(`加载小抄界面失败：${response.status} ${response.statusText}`)
  }

  return response.text()
}
