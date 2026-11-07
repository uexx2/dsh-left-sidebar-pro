/**
 * dsh-left-sidebar-pro · 宿主半（Host half）
 * =====================================
 *
 * 这个文件跑在 DSH 的「后端」（Host 进程）里，浏览器碰不到的事情都由它做。
 * 它一共提供这些接口，网页那一半（client.js）用 fetch 调用它们：
 *
 *   GET  /dsh-left-sidebar-pro/handshake   换一个本次运行专属的随机口令
 *   GET  /dsh-left-sidebar-pro/mcp/list    列出当前生效的 MCP 服务器
 *   POST /dsh-left-sidebar-pro/mcp/save    新增或修改一台 MCP 服务器
 *   POST /dsh-left-sidebar-pro/mcp/remove  删掉一台 MCP 服务器
 *   POST /dsh-left-sidebar-pro/mcp/toggle  启用 / 停用一台 MCP 服务器
 *   GET  /dsh-left-sidebar-pro/mcp/schema  返回一份空白的服务器模板（给「新增」表单用）
 *
 * 另外，「已归档对话」的后端也并在本插件里，网址挂在
 * /dsh-left-sidebar-pro/archived/... 下面：
 *
 *   GET  /dsh-left-sidebar-pro/archived/list     列出已归档的对话
 *   GET  /dsh-left-sidebar-pro/archived/read     读某一条的正文
 *   POST /dsh-left-sidebar-pro/archived/pending  标记「待删除」（先划掉，到期才真删）
 *   POST /dsh-left-sidebar-pro/archived/restore  撤回「待删除」标记
 *   POST /dsh-left-sidebar-pro/archived/delete   立即真删
 *   POST /dsh-left-sidebar-pro/archived/sweep    立刻清扫一遍到期的
 *
 * 另外，「Skill 管理」的后端也并在本插件里，网址挂在
 * /dsh-left-sidebar-pro/skill/... 下面：
 *
 *   GET  /dsh-left-sidebar-pro/skill/list     列出本机已发现的 skill
 *   GET  /dsh-left-sidebar-pro/skill/read     读某一条的说明书正文
 *   POST /dsh-left-sidebar-pro/skill/enabled  停用 / 启用
 *   POST /dsh-left-sidebar-pro/skill/reveal   在访达里定位
 *   POST /dsh-left-sidebar-pro/skill/trash    移进废纸篓
 *
 * 「已归档」的实现放在 archived-host.js，「Skill」的实现放在 skill-host.js；
 * 下面 apply() 里各调一行就挂上了。
 *
 * ── 为什么走 HTTP 小接口，而不是像官方插件那样调远程方法？ ──
 *   DSH 里「浏览器 → 后端」的正式通道是每个官方插件自己生成的远程接口，
 *   手写插件没法凭空生成。所以这里改用 DSH 自带的 Web 服务器（ctx.webServer）
 *   注册几个小网址。这些网址只在 127.0.0.1 本机可达，并且需要一个随机口令
 *   （口令通过首页注入，只有已经登录的页面能拿到）。
 *
 * ── MCP 服务器到底存在哪里？ ──
 *   DSH 里「一台 MCP 服务器」= 配置树里的一条 @deepseek-ai/dsh-mcp-client 条目。
 *   配置分两层：
 *     · cordis.yml        —— 官方每次启动物化出来的整棵树，**不要动**
 *     · cordis.patch.yml  —— 你自己的补丁层，追加在上面的树之上，**要改就改这里**
 *   本插件把「自己管的那些 MCP 条目」集中写进 cordis.patch.yml 里的一个
 *   带标记的区块，每次保存时整块重写。标记之外的内容一个字都不碰。
 *
 * ── 为什么要用标记区块，而不是直接在文件末尾追加？ ──
 *   因为「修改」和「删除」需要知道原来写了什么。整块重写最简单也最不容易出错：
 *   我们只负责两个标记之间的内容，标记以外的手写内容永远原样保留。
 *
 * ── 写坏了会怎样？ ──
 *   补丁文件「存在但格式不对」时 DSH 会启动失败（不是忽略）。所以：
 *     1. 每次写入前先备份一份 .bak；
 *     2. 写入前先检查「标记之外的内容」有没有被动过，动过就拒绝写入并报错；
 *     3. 用「先写临时文件、再改名」的方式落盘，避免写一半断电留下半个文件。
 *
 * @module @uexx/dsh-left-sidebar-pro
 */

import { copyFileSync, existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

// 「已归档对话」那一段。
import { applyArchived, ARCHIVED_PATH } from './archived-host.js'
// 「Skill 管理」那一段。
import { applySkills } from './skill-host.js'

/** 本插件占用的网址前缀；网页端也用这个前缀。 */
const ROUTE_PREFIX = '/dsh-left-sidebar-pro'

/** 「已归档」那一段的完整网址前缀（比上面那个长，所以路由表会优先匹配到它）。 */
const ARCHIVED_ROUTE_PREFIX = ROUTE_PREFIX + ARCHIVED_PATH

/** 「Skill 管理」那一段的完整网址前缀（同样比上面那个长，优先匹配）。 */
const SKILL_ROUTE_PREFIX = ROUTE_PREFIX + '/skill'

/** 注入到首页的全局变量名，网页端从这里读取口令。 */
const GLOBAL_NAME = '__DSH_LEFT_SIDEBAR_PRO__'

/**
 * 宿主半的版本号。每次改本文件都 +1。
 * 它会被 /handshake 返回，方便确认「跑起来的到底是哪一版」。
 */
const HOST_VERSION = 3

/** 「已归档」那一段的默认配置（可以在补丁文件里改）。 */
const ARCHIVED_DEFAULTS = {
  retentionDays: 3,
  sweepMinutes: 10,
}

/** 管理区块的起止标记。区块之外的文字永远原样保留。 */
const MARK_START = '# >>> dsh-left-sidebar-pro: MCP 服务器（本插件自动管理，手改会被覆盖）'
const MARK_END = '# <<< dsh-left-sidebar-pro'

/** 一台 MCP 服务器对应的插件包名。 */
const MCP_PLUGIN_NAME = '@deepseek-ai/dsh-mcp-client'

/** 服务器名字的合法写法，和官方 MCP 插件里的规则一致。 */
const SERVER_NAME_RE = /^[A-Za-z0-9_-]{1,32}$/

/** 两种连接方式。 */
const TRANSPORTS = ['stdio', 'streamable-http']

/**
 * DSH 的家目录：默认是 ~/.dsh，环境变量 DSH_HOME 可以改。
 * @returns {string} 绝对路径。
 */
function dshHome() {
  const configured = process.env.DSH_HOME
  return configured && configured.length > 0 ? configured : join(homedir(), '.dsh')
}

/**
 * 当前 profile 的目录（例如 ~/.dsh/profiles/desktop）。
 *
 * 优先问 DSH 自己（ctx.profileContext），问不到就按约定拼一个。
 * 为什么优先问 DSH？因为 profile 名字不一定是 desktop（常见的是 desktop）。
 * @param {import('@deepseek-ai/cordis').Context} ctx 插件上下文。
 * @returns {string} 绝对路径。
 */
function profileDir(ctx) {
  try {
    const profile = ctx.get('profileContext')
    if (profile !== undefined && typeof profile.dir === 'string' && profile.dir.length > 0) {
      return profile.dir
    }
  } catch {
    /* profileContext 是可选的，取不到就退回默认位置 */
  }
  return join(dshHome(), 'profiles', 'desktop')
}

/**
 * 补丁文件的路径。优先用 DSH 自己报的路径，取不到就按约定拼。
 * @param {import('@deepseek-ai/cordis').Context} ctx 插件上下文。
 * @returns {string} 绝对路径。
 */
function patchPath(ctx) {
  try {
    const profile = ctx.get('profileContext')
    if (profile !== undefined && typeof profile.patchPath === 'string' && profile.patchPath.length > 0) {
      return profile.patchPath
    }
  } catch {
    /* 同上 */
  }
  return join(profileDir(ctx), 'cordis.patch.yml')
}

/**
 * 把一段文字切成「区块之前 / 区块之内 / 区块之后」三段。
 * 找不到标记时，`inside` 是 null，表示这个文件还没有我们的区块。
 * @param {string} text 文件原文。
 * @returns {{ before: string, inside: string | null, after: string }} 三段。
 */
function splitManaged(text) {
  const start = text.indexOf(MARK_START)
  if (start < 0) return { before: text, inside: null, after: '' }
  const endMark = text.indexOf(MARK_END, start)
  if (endMark < 0) return { before: text, inside: null, after: '' }
  const afterStart = endMark + MARK_END.length
  return {
    before: text.slice(0, start),
    inside: text.slice(start, afterStart),
    after: text.slice(afterStart),
  }
}

/**
 * 把一个值写成 YAML 里安全的写法。
 *
 * 简单说：数字、true/false 直接写；普通文字不加引号；含有特殊符号
 * （冒号、井号、空格开头、中文等）的文字套上双引号，避免 YAML 解析出错。
 * @param {unknown} value 原始值。
 * @returns {string} 可以直接拼进 YAML 的文字。
 */
function yamlScalar(value) {
  if (typeof value === 'boolean' || typeof value === 'number') return String(value)
  const text = String(value ?? '')
  if (text === '') return "''"
  // 只含这些字符、并且不会被误认成布尔/数字/空值 → 可以裸写
  const plain = /^[A-Za-z0-9_./:@+-]+$/.test(text)
  const reserved = /^(true|false|null|yes|no|on|off|~)$/i.test(text)
  const numeric = /^[+-]?(\d+\.?\d*|\.\d+)$/.test(text)
  // YAML 里这几个字符出现在开头就是「指示符」，必须加引号：
  //   @ 和 ` 是保留字符；- ? : , [ ] { } # & * ! | > ' " % 各有语法含义
  const startsWithIndicator = /^[-?:,[\]{}#&*!|>'"%@`]/.test(text)
  // 值里出现「冒号+空格」或「 #」也会被误读成结构，必须加引号
  const ambiguous = /:\s/.test(text) || /\s#/.test(text) || /\s$/.test(text)
  if (plain && !reserved && !numeric && !startsWithIndicator && !ambiguous) return text
  // JSON 的双引号字符串本身就是合法的 YAML 双引号标量，转义规则也一致
  return JSON.stringify(text)
}

/**
 * 把一条 MCP 服务器配置写成 YAML 行。
 * @param {any} server 网页端传来的服务器描述。
 * @param {string[]} out 收集行的数组（会被就地修改）。
 * @returns {void}
 */
function pushServerLines(server, out) {
  const transport = TRANSPORTS.includes(server.transport) ? server.transport : 'stdio'
  out.push(`    - id: ${yamlScalar(server.id)}`)
  out.push(`      name: '${MCP_PLUGIN_NAME}'`)
  out.push('      config:')
  out.push(`        serverName: ${yamlScalar(server.serverName)}`)
  out.push(`        transport: ${transport}`)

  if (transport === 'stdio') {
    out.push(`        command: ${yamlScalar(server.command)}`)
    const args = Array.isArray(server.args) ? server.args.filter((x) => String(x).length > 0) : []
    if (args.length === 0) out.push('        args: []')
    else {
      out.push('        args:')
      for (const arg of args) out.push(`          - ${yamlScalar(arg)}`)
    }
    const envKeys = Object.keys(server.env ?? {})
    if (envKeys.length === 0) out.push('        env: {}')
    else {
      out.push('        env:')
      for (const key of envKeys) out.push(`          ${yamlScalar(key)}: ${yamlScalar(server.env[key])}`)
    }
  } else {
    out.push(`        url: ${yamlScalar(server.url)}`)
    const headerKeys = Object.keys(server.headers ?? {})
    if (headerKeys.length === 0) out.push('        headers: {}')
    else {
      out.push('        headers:')
      for (const key of headerKeys) out.push(`          ${yamlScalar(key)}: ${yamlScalar(server.headers[key])}`)
    }
  }

  // 启动时连不上就让插件报错（默认 false：连不上只记日志，不拦启动）
  out.push(`        failOnStartupError: ${server.failOnStartupError === true ? 'true' : 'false'}`)
  // 停用的服务器：整条加上 disabled: true，DSH 就不会加载它
  if (server.disabled === true) out.push('      disabled: true')
}

/**
 * 生成完整的「管理区块」文字（含起止标记）。
 * @param {any[]} servers 要写进去的全部服务器。
 * @returns {string} 区块文字。
 */
function managedBlock(servers) {
  const lines = [MARK_START]
  if (servers.length > 0) {
    lines.push('- insert:')
    for (const server of servers) pushServerLines(server, lines)
  }
  lines.push(MARK_END)
  return lines.join('\n')
}

/**
 * 读取当前生效的 MCP 服务器名单。
 *
 * 两个来源合并：
 *   1. DSH 的配置编辑器（configEditor.configuration）—— 这是「真正加载了什么」，最准；
 *   2. 补丁文件里的管理区块 —— 这是「本插件写了什么」，用来拿到 id 和停用状态。
 * 之所以要合并：停用的条目（disabled: true）可能不在活动树里，但它仍然要显示出来，
 * 否则没法把它重新启用。
 * @param {import('@deepseek-ai/cordis').Context} ctx 插件上下文。
 * @returns {{ servers: any[], source: string }} 名单和来源说明。
 */
function listServers(ctx) {
  /** id → 服务器描述 */
  const byId = new Map()
  let liveCount = 0

  // 来源 1：DSH 真正加载了的条目
  try {
    const editor = ctx.get('configEditor')
    if (editor !== undefined && typeof editor.configuration === 'function') {
      for (const row of editor.configuration()) {
        const options = row?.entry?.options
        if (options?.name !== MCP_PLUGIN_NAME) continue
        const config = row?.override ?? row?.inherited ?? {}
        liveCount += 1
        byId.set(String(options.id), {
          id: String(options.id),
          serverName: String(config.serverName ?? ''),
          transport: String(config.transport ?? 'stdio'),
          command: String(config.command ?? ''),
          args: Array.isArray(config.args) ? config.args.map(String) : [],
          env: config.env && typeof config.env === 'object' ? config.env : {},
          url: String(config.url ?? ''),
          headers: config.headers && typeof config.headers === 'object' ? config.headers : {},
          failOnStartupError: config.failOnStartupError === true,
          disabled: options.disabled === true,
          loaded: options.disabled !== true,
          origin: 'live',
        })
      }
    }
  } catch {
    /* configEditor 不可用：至少把补丁文件里的内容显示出来 */
  }

  // 来源 2：补丁文件里我们自己管的区块
  const path = patchPath(ctx)
  let fileText = ''
  try {
    fileText = readFileSync(path, 'utf8')
  } catch {
    fileText = ''
  }
  const managed = splitManaged(fileText).inside
  if (managed !== null) {
    for (const row of parseManagedBlock(managed)) {
      const known = byId.get(row.id)
      if (known !== undefined) {
        // 以配置文件为准，补上「这条是本插件写的」
        known.managed = true
        continue
      }
      byId.set(row.id, { ...row, loaded: false, origin: 'patch', managed: true })
    }
  }

  const servers = [...byId.values()].sort((left, right) =>
    left.serverName.localeCompare(right.serverName) || left.id.localeCompare(right.id),
  )
  return {
    servers,
    source: `patch=${path} live=${liveCount}`,
  }
}

/**
 * 从管理区块的文字里，把每台服务器的字段读回来。
 *
 * 为什么不用一个完整的 YAML 解析库？
 *   本插件是「本地链接」进 profile 的，能不能 require 到 yaml 库没有保证；
 *   而我们自己写出去的格式是固定的几行，按行读足够，也不怕解析库版本差异。
 * 这个函数只认自己写出去的形状；遇到看不懂的行就跳过，不会乱猜。
 * @param {string} block 管理区块原文。
 * @returns {any[]} 服务器数组。
 */
function parseManagedBlock(block) {
  const rows = []
  let current = null
  /**
   * 当前读到哪一段。按缩进判断，因为我们写出去的格式是固定的：
   *   缩进 4  —— 一条服务器的开头（- id: ...）
   *   缩进 6  —— 这条服务器的外壳字段（name / config / disabled）
   *   缩进 8  —— config 里的字段（serverName / transport / command / args / env / ...）
   *   缩进 10 —— args 的每一项，或 env / headers 的每一对
   */
  let section = null

  for (const rawLine of block.split(/\r?\n/)) {
    const line = rawLine.replace(/\t/g, '  ')
    const trimmed = line.trim()
    if (trimmed === '' || trimmed.startsWith('#')) continue
    const indent = line.length - line.trimStart().length

    // 一条新服务器的开头
    if (indent <= 4) {
      const idMatch = /^-\s+id:\s*(.+)$/.exec(trimmed)
      if (idMatch !== null) {
        current = { id: unquote(idMatch[1]), args: [], env: {}, headers: {}, disabled: false }
        rows.push(current)
        section = null
        continue
      }
      // - insert: 之类的结构行，忽略
      continue
    }
    if (current === null) continue

    const pair = /^(.+?):\s*(.*)$/.exec(trimmed)
    if (pair === null) {
      // 可能是纯列表项（args 里没有冒号的值）
      const bare = /^-\s+(.*)$/.exec(trimmed)
      if (bare !== null && section === 'args') current.args.push(unquote(bare[1]))
      continue
    }
    const key = unquote(pair[1])
    const value = pair[2].trim()

    // 缩进 6：外壳字段
    if (indent <= 6) {
      if (key === 'disabled') {
        current.disabled = value === 'true'
        section = null
      }
      continue
    }

    // 缩进 8：config 里的字段
    if (indent <= 8) {
      if (key === 'serverName') current.serverName = unquote(value)
      else if (key === 'transport') current.transport = unquote(value)
      else if (key === 'command') current.command = unquote(value)
      else if (key === 'url') current.url = unquote(value)
      else if (key === 'failOnStartupError') current.failOnStartupError = value === 'true'
      section = ['args', 'env', 'headers'].includes(key) ? key : null
      continue
    }

    // 缩进 10：args 的项，或 env / headers 的键值对
    if (section === 'args') {
      const item = /^-\s+(.*)$/.exec(trimmed)
      if (item !== null) current.args.push(unquote(item[1]))
      continue
    }
    if (section === 'env' || section === 'headers') {
      current[section][key] = unquote(value)
    }
  }

  return rows
    .filter((row) => row.serverName !== undefined && String(row.serverName).length > 0)
    .map((row) => ({
      id: row.id,
      serverName: row.serverName,
      transport: row.transport ?? 'stdio',
      command: row.command ?? '',
      args: row.args,
      env: row.env,
      url: row.url ?? '',
      headers: row.headers,
      failOnStartupError: row.failOnStartupError === true,
      disabled: row.disabled === true,
    }))
}

/**
 * 去掉 YAML 值外面的引号。
 * @param {string} value 原始值。
 * @returns {string} 去引号后的值。
 */
function unquote(value) {
  const text = String(value ?? '').trim()
  if (text.length >= 2) {
    const first = text[0]
    const last = text[text.length - 1]
    if (first === '"' && last === '"') {
      try {
        return JSON.parse(text)
      } catch {
        return text.slice(1, -1)
      }
    }
    if (first === "'" && last === "'") return text.slice(1, -1).replace(/''/g, "'")
  }
  return text
}

/**
 * 把新的服务器名单写回补丁文件。
 *
 * 安全措施（顺序很重要）：
 *   1. 文件不存在 → 直接新建，内容就是管理区块；
 *   2. 文件存在但没有我们的标记 → 在末尾追加区块（保留原有内容）；
 *   3. 文件存在且已有标记 → 只替换标记之间的内容；
 *   4. 无论哪种情况，先备份 .bak，再写临时文件，最后改名覆盖。
 * @param {import('@deepseek-ai/cordis').Context} ctx 插件上下文。
 * @param {any[]} servers 要写进去的全部服务器。
 * @returns {{ path: string, backup: string | null }} 写入结果。
 */
function writeServers(ctx, servers) {
  const path = patchPath(ctx)
  const block = managedBlock(servers)

  let text = ''
  let existed = false
  try {
    text = readFileSync(path, 'utf8')
    existed = true
  } catch {
    text = ''
  }

  let next
  if (!existed || text.trim() === '') {
    // 新文件：补一句抬头说明，再放区块
    next = `# ${'profile'} 的补丁层，由 dsh-left-sidebar-pro 维护 MCP 区块。\n${block}\n`
  } else {
    const parts = splitManaged(text)
    if (parts.inside === null) {
      const head = text.endsWith('\n') ? text : `${text}\n`
      next = `${head}${block}\n`
    } else {
      next = `${parts.before}${block}${parts.after}`
      if (!next.endsWith('\n')) next += '\n'
    }
  }

  let backup = null
  if (existed) {
    backup = `${path}.bak`
    copyFileSync(path, backup)
  }

  const temp = `${path}.tmp-${randomUUID().slice(0, 8)}`
  writeFileSync(temp, next, 'utf8')
  renameSync(temp, path)

  return { path, backup }
}

/**
 * 回一个 JSON 响应。
 * @param {import('node:http').ServerResponse} res 响应对象。
 * @param {number} status HTTP 状态码。
 * @param {unknown} value 任意可序列化的值。
 * @returns {void}
 */
function sendJson(res, status, value) {
  const body = JSON.stringify(value)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
  })
  res.end(body)
}

/**
 * 读请求体里的 JSON；读不动就当空对象。
 * @param {import('node:http').IncomingMessage} req 请求。
 * @returns {Promise<any>} 解析结果。
 */
function readJsonBody(req) {
  return new Promise((settle) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > 1024 * 1024) {
        settle({})
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('error', () => settle({}))
    req.on('end', () => {
      if (chunks.length === 0) {
        settle({})
        return
      }
      try {
        settle(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch {
        settle({})
      }
    })
  })
}

/**
 * 把口令注入到首页 HTML 里（只有通过登录校验的页面能拿到首页）。
 * @param {string} html 原始首页。
 * @param {string} token 本次进程的随机口令。
 * @returns {string} 注入后的首页。
 */
function injectToken(html, token) {
  const script = `<script>window.${GLOBAL_NAME}=${JSON.stringify({ token })}</script>`
  if (html.includes('</head>')) return html.replace('</head>', `${script}</head>`)
  return `${html}${script}`
}

/**
 * 校验网页端传来的服务器描述，顺手把多余字段丢掉。
 *
 * 为什么要校验？因为网页端传来的东西不可全信：写进配置文件的每一个字
 * 都可能让 DSH 下次启动失败，所以这里逐项检查。
 * @param {any} input 网页端传来的对象。
 * @param {any[]} existing 现有名单（用来判断 id 有没有重复）。
 * @returns {{ ok: true, server: any } | { ok: false, error: string }} 校验结果。
 */
function validateServer(input, existing) {
  const serverName = String(input?.serverName ?? '').trim()
  if (!SERVER_NAME_RE.test(serverName)) {
    return {
      ok: false,
      error: '服务器名字只能用英文字母、数字、下划线和减号，长度 1~32 —— serverName must match /^[A-Za-z0-9_-]{1,32}$/',
    }
  }

  const transport = String(input?.transport ?? 'stdio')
  if (!TRANSPORTS.includes(transport)) {
    return { ok: false, error: `连接方式只能是 ${TRANSPORTS.join(' 或 ')} —— transport must be one of ${TRANSPORTS.join(', ')}` }
  }

  // id：没给就按名字生成一个，保证不和现有的撞车
  let id = String(input?.id ?? '').trim()
  if (id === '') id = `mcp-${serverName}`
  if (!/^[A-Za-z0-9_.-]{1,64}$/.test(id)) {
    return { ok: false, error: '内部编号只能含字母、数字、点、下划线、减号 —— id must be a simple slug' }
  }
  const clash = existing.find((row) => row.id === id && row.id !== String(input?.id ?? '').trim())
  if (clash !== undefined && String(input?.id ?? '').trim() === '') {
    return { ok: false, error: `内部编号 ${id} 已经被占用了，请换一个 —— id ${id} is already taken` }
  }

  // 同一台服务器名字不能重复（官方插件会因为重名直接启动失败）
  const sameName = existing.find((row) => row.serverName === serverName && row.id !== String(input?.id ?? '').trim())
  if (sameName !== undefined) {
    return { ok: false, error: `已经有一台叫 ${serverName} 的服务器了 —— serverName ${serverName} is already in use` }
  }

  const base = {
    id,
    serverName,
    transport,
    failOnStartupError: input?.failOnStartupError === true,
    disabled: input?.disabled === true,
  }

  if (transport === 'stdio') {
    const command = String(input?.command ?? '').trim()
    if (command === '') {
      return { ok: false, error: '用 stdio 方式时必须填「要运行的程序」—— command is required for stdio' }
    }
    return {
      ok: true,
      server: {
        ...base,
        command,
        args: Array.isArray(input?.args) ? input.args.map((x) => String(x)) : [],
        env: plainStringDict(input?.env),
        url: '',
        headers: {},
      },
    }
  }

  const url = String(input?.url ?? '').trim()
  if (!/^https?:\/\//i.test(url)) {
    return { ok: false, error: '网址必须以 http:// 或 https:// 开头 —— url must be an http(s) URL' }
  }
  return {
    ok: true,
    server: {
      ...base,
      command: '',
      args: [],
      env: {},
      url,
      headers: plainStringDict(input?.headers),
    },
  }
}

/**
 * 把任意对象压成「字符串 → 字符串」的字典，丢掉不合法的键值。
 * @param {any} value 原始对象。
 * @returns {Record<string, string>} 干净的字典。
 */
function plainStringDict(value) {
  const out = {}
  if (value === null || typeof value !== 'object') return out
  for (const [key, raw] of Object.entries(value)) {
    const name = String(key).trim()
    if (name === '') continue
    out[name] = String(raw ?? '')
  }
  return out
}

/**
 * 处理 /dsh-left-sidebar-pro 下的全部请求。
 * @param {import('@deepseek-ai/cordis').Context} ctx 插件上下文。
 * @param {import('node:http').IncomingMessage} req 请求。
 * @param {import('node:http').ServerResponse} res 响应。
 * @param {string} token 本次进程的随机口令。
 * @returns {Promise<void>} 完成即返回。
 */
async function handle(ctx, req, res, token) {
  const url = new URL(req.url ?? '/', 'http://dsh.invalid')
  const path = url.pathname.slice(ROUTE_PREFIX.length) || '/'

  // 口令优先从首页注入里拿；万一没注入成功（例如页面是旧缓存），
  // 允许带着 DSH 登录 Cookie 的页面再要一次。别的程序拿不到这个 Cookie。
  if (path === '/handshake') {
    const cookie = req.headers.cookie
    if (typeof cookie === 'string' && cookie.length > 0) {
      sendJson(res, 200, {
        token,
        version: HOST_VERSION,
        profile: profileDir(ctx),
        patch: patchPath(ctx),
      })
      return
    }
    sendJson(res, 403, { error: 'forbidden' })
    return
  }

  const provided = req.headers['x-dsh-sidebar-token'] ?? url.searchParams.get('token')
  if (provided !== token) {
    sendJson(res, 403, { error: 'forbidden', hint: '刷新页面让插件重新读取口令' })
    return
  }

  try {

    if (req.method === 'GET' && path === '/mcp/list') {
      const { servers, source } = listServers(ctx)
      sendJson(res, 200, {
        servers,
        source,
        patch: patchPath(ctx),
        transports: TRANSPORTS,
        version: HOST_VERSION,
      })
      return
    }

    if (req.method === 'POST' && path === '/mcp/save') {
      const body = await readJsonBody(req)
      const { servers } = listServers(ctx)
      const checked = validateServer(body.server ?? body, servers)
      if (!checked.ok) {
        sendJson(res, 400, { error: checked.error })
        return
      }
      const next = servers.map((row) => ({
        id: row.id,
        serverName: row.serverName,
        transport: row.transport,
        command: row.command,
        args: row.args,
        env: row.env,
        url: row.url,
        headers: row.headers,
        failOnStartupError: row.failOnStartupError,
        disabled: row.disabled,
      }))
      const at = next.findIndex((row) => row.id === checked.server.id)
      if (at >= 0) next[at] = checked.server
      else next.push(checked.server)
      const result = writeServers(ctx, next)
      sendJson(res, 200, { ok: true, ...result, server: checked.server })
      return
    }

    if (req.method === 'POST' && path === '/mcp/remove') {
      const body = await readJsonBody(req)
      const id = String(body.id ?? '')
      const { servers } = listServers(ctx)
      if (!servers.some((row) => row.id === id)) {
        sendJson(res, 400, { error: `没有编号为 ${id} 的服务器 —— unknown id` })
        return
      }
      const next = servers
        .filter((row) => row.id !== id)
        .map((row) => ({
          id: row.id,
          serverName: row.serverName,
          transport: row.transport,
          command: row.command,
          args: row.args,
          env: row.env,
          url: row.url,
          headers: row.headers,
          failOnStartupError: row.failOnStartupError,
          disabled: row.disabled,
        }))
      const result = writeServers(ctx, next)
      sendJson(res, 200, { ok: true, ...result })
      return
    }

    if (req.method === 'POST' && path === '/mcp/toggle') {
      const body = await readJsonBody(req)
      const id = String(body.id ?? '')
      const { servers } = listServers(ctx)
      const target = servers.find((row) => row.id === id)
      if (target === undefined) {
        sendJson(res, 400, { error: `没有编号为 ${id} 的服务器 —— unknown id` })
        return
      }
      const next = servers.map((row) => ({
        id: row.id,
        serverName: row.serverName,
        transport: row.transport,
        command: row.command,
        args: row.args,
        env: row.env,
        url: row.url,
        headers: row.headers,
        failOnStartupError: row.failOnStartupError,
        disabled: row.id === id ? body.disabled === true : row.disabled,
      }))
      const result = writeServers(ctx, next)
      sendJson(res, 200, { ok: true, ...result })
      return
    }

    sendJson(res, 404, { error: 'not found', path })
  } catch (error) {
    sendJson(res, 400, { error: error instanceof Error ? error.message : String(error) })
  }
}

/** 插件名（DSH 用它标记日志）。 */
export const name = 'dsh-left-sidebar-pro'

/** 需要 DSH 提供的服务：只有 Web 服务器是硬依赖；其余用的时候再取。 */
export const inject = ['webServer']

/**
 * 插件入口：注册口令注入、网址，以及「已归档对话」「Skill 管理」两段。
 * @param {import('@deepseek-ai/cordis').Context} ctx 插件上下文。
 * @param {object} [rawConfig] cordis.patch.yml 里写的 config。
 * @returns {void}
 */
export function apply(ctx, rawConfig) {
  const token = randomUUID()

  ctx.effect(
    () => ctx.webServer.tapIndex((html) => injectToken(html, token)),
    'sidebar-pro: index token',
  )
  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'prefix',
        path: ROUTE_PREFIX,
        handler: (req, res) => handle(ctx, req, res, token),
      }),
    'sidebar-pro: routes',
  )

  // 「已归档对话」那一段：口令共用上面这一个，配置写在 config.archived 里。
  // 网址前缀比上面那个长（/dsh-left-sidebar-pro/archived），路由表按「最长前缀优先」
  // 匹配，所以这一段的请求不会被上面那个处理器抢走。
  applyArchived(
    ctx,
    { ...ARCHIVED_DEFAULTS, ...((rawConfig && rawConfig.archived) || {}) },
    token,
    ARCHIVED_ROUTE_PREFIX,
  )

  // 「Skill 管理」那一段：同样共用一个口令，配置这里暂时没有可调项。
  applySkills(ctx, token, SKILL_ROUTE_PREFIX)

  ctx.logger?.info?.(`sidebar-pro ready at ${ROUTE_PREFIX} (patch: ${patchPath(ctx)})`)
}
