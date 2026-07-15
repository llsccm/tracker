import { readFileSync } from 'node:fs'
import { defineConfig, loadEnv } from 'vite'
import monkey from 'vite-plugin-monkey'
import { fileURLToPath, URL } from 'node:url'

const packageJson = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8'))

const SCRIPT_ENTRY = 'src/index.js'
const SCRIPT_FILE_NAME = 'daxiaochao.user.js'
const SCRIPT_META_FILE_NAME = 'daxiaochao.meta.js'
const RELEASE_DOWNLOAD_BASE_URL = 'https://github.com/llsccm/tracker/releases/latest/download'
const SCRIPT_MATCH = [
  '*://game.4399iw2.com/yxsgs/*',
  '*://my.4399.com/yxsgs/*',
  '*://*.sanguosha.com/*',
  '*://web.kuaiwan.com/kwsgsn/*',
  '*://wan.baidu.com/microend?gameId=19793595/*',
  '*://www.7k7k.com/special/sgs/?*',
  '*://playgame.iqiyi.com/login/iframe_page_web/top?game_id=146'
]
const SCRIPT_EXCLUDE = [
  'https://game.4399iw2.com/yxxsgs/*',
  '*://*.sanguosha.com/10/*',
  '*://*.sanguosha.com/10th/*',
  'https://wan.baidu.com/*gameId=19793616*',
  '*://h5.7k7k.com/web/H5GAMES.html?gid=960982bec2f555de44ea43ca8a7ef418/*',
  '*://qqgame.qq.com/webappframe/?appid=10951',
  '*://s118.app1107877410.qqopenapp.com/pc/qqLobby_index.php*'
]

export default defineConfig(({ mode }) => {
  // 加载当前模式下的环境变量；缺省时回退到 package.json，避免用户脚本元信息为空。
  const env = loadEnv(mode, process.cwd(), '')
  const version = env.VITE_version || packageJson.version

  console.log(`Build time: ${new Date().toLocaleString()}`)
  console.log(`Build mode: ${mode}`)
  console.log(`Build version: ${version}`)

  return {
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url))
      }
    },
    plugins: [
      monkey({
        entry: SCRIPT_ENTRY,
        userscript: {
          name: '三国杀小抄',
          version,
          author: '三国杀小抄',
          'run-at': 'document-start',
          description: '三国杀小抄',
          icon: 'https://i0.hdslb.com/bfs/new_dyn/17ec41a0ca79633b77399065ab80da3f2138912.png',
          namespace: 'https://greasyfork.org/scripts/448004',
          match: SCRIPT_MATCH,
          exclude: SCRIPT_EXCLUDE,
          downloadURL: `${RELEASE_DOWNLOAD_BASE_URL}/${SCRIPT_FILE_NAME}`,
          updateURL: `${RELEASE_DOWNLOAD_BASE_URL}/${SCRIPT_META_FILE_NAME}`,
          grant: 'none'
        },
        server: {
          mountGmApi: false
        },
        build: {
          metaFileName: SCRIPT_META_FILE_NAME,
          autoGrant: false
        }
      })
    ],
    build: {
      minify: false,
      rollupOptions: {
        output: {
          entryFileNames: SCRIPT_FILE_NAME
        }
      }
    }
  }
})
