/**
 * Skill 管理 · 宿主半（Host half，本插件的一部分）
 * =====================================================================
 *
 * 这一段由 index.js 在启动时调用 applySkills() 挂上；文件单独放一个，
 * 是为了让 Skill 的读写逻辑保持独立、好测好改。
 *
 * 它负责浏览器碰不到的那些事：
 *   1. 列出本机全部已发现的 skill（问 DSH 自己的登记处，不自己扫磁盘）；
 *   2. 读某一个 skill 的完整说明书正文；
 *   3. 停用 / 启用（改说明书开头的 YAML 开关，文件本身不动）；
 *   4. 在「访达」里定位到它的文件；
 *   5. 移进 macOS 的废纸篓。
 *
 * 网址长什么样？
 *   挂在主插件的前缀下面：/dsh-left-sidebar-pro/skill/list、/read、/enabled、
 *   /reveal、/trash。路由表按「最长前缀优先」匹配，所以这一段不会被主插件
 *   自己的 /dsh-left-sidebar-pro 处理器抢走。
 *   口令和首页注入都由 index.js 统一负责（共用同一个随机口令），
 *   请求头优先认 x-dsh-sidebar-token（主插件的叫法），也兼容旧的 x-dsh-skill-token。
 */

import { existsSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve, sep } from 'node:path'
import { randomUUID } from 'node:crypto'

/**
 * 宿主半的版本号。每次改本文件都 +1。
 * 它会被 /handshake 返回，方便确认「跑起来的到底是哪一版」。
 */
const HOST_VERSION = 2

/** 单个 skill 的说明书最多返回多少字符，避免一个超大文件把浏览器卡住。 */
const MAX_CONTENT_CHARS = 300000

/** 停用 skill 时写进前置信息的两行。 */
const DISABLE_LINES = ['disable-model-invocation: true', 'user-invocable: false']

/** 前置信息里与开关有关的键名（新旧拼法都算，旧的会被清掉）。 */
const INVOCATION_KEY = /^\s*(disable-model-invocation|user-invocable|disableModelInvocation|userInvocable)\s*:/

/**
 * DSH 的家目录：默认是 ~/.dsh，环境变量 DSH_HOME 可以改。
 * @returns {string} 绝对路径。
 */
function dshHome() {
  const configured = process.env.DSH_HOME
  return configured && configured.length > 0 ? configured : join(homedir(), '.dsh')
}

/**
 * macOS 的废纸篓目录。
 * @returns {string} 绝对路径。
 */
function trashDir() {
  return join(homedir(), '.Trash')
}

/**
 * 「应用安装包」的根目录，例如 /Applications/DeepSeek Harness.app/。
 * 装在这里面的 skill 是 DSH 自带的，不能改也不能删。
 * @returns {string} 以路径分隔符结尾的前缀；判断不出来时返回空串。
 */
function appRoot() {
  const exec = process.execPath ?? ''
  const marker = `${sep}Contents${sep}MacOS${sep}`
  const at = exec.indexOf(marker)
  if (at === -1) return ''
  return exec.slice(0, at) + sep
}

/**
 * 判断一个路径是不是在应用安装包里面。
 * @param {string} target 绝对路径。
 * @returns {boolean} true 表示只读。
 */
function insideApp(target) {
  const root = appRoot()
  return root.length > 0 && (target === root.slice(0, -1) || target.startsWith(root))
}

/**
 * 判断这个 skill 能不能被本面板修改。
 *
 * 只按「位置」判断，不去真的试写权限：DSH 自己的文件系统沙箱会让
 * 权限探测误报（明明能写却报 EPERM），按位置判断更稳。真的写不动时，
 * 操作会返回一句明确的错误，页面会照实显示。
 * @param {string} path 说明书文件路径。
 * @param {string} source skill 的来源标识。
 * @returns {boolean} true 表示可以停用 / 删除。
 */
function canEdit(path, source) {
  if (path.length === 0) return false
  if (source === 'bundled') return false
  if (insideApp(path)) return false
  return existsSync(path)
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
 * 取所有工作区的路径和名字，用来把「项目里的 skill」也列出来。
 * @param {import('@deepseek-ai/cordis').Context} ctx 插件上下文。
 * @returns {Array<{ id: string, path: string, title: string }>} 工作区数组。
 */
function workspaces(ctx) {
  try {
    const registry = ctx.get('workspaceRegistry')
    if (registry === undefined || typeof registry.list !== 'function') return []
    return registry
      .list()
      .filter((item) => item && typeof item.path === 'string')
      .map((item) => ({ id: String(item.id ?? ''), path: item.path, title: String(item.title ?? item.path) }))
  } catch {
    return []
  }
}

/**
 * 把 skill 的调用策略翻成页面要的三个字段。
 * @param {any} invocation skill 上的 invocation 字段。
 * @returns {{ model: boolean, user: boolean, state: string }} 策略摘要。
 */
function policyOf(invocation) {
  const model = invocation?.modelInvocable !== false
  const user = invocation?.userInvocable !== false
  const state = model && user ? 'on' : model || user ? 'partial' : 'off'
  return { model, user, state }
}

/** 合法的 skill 名字：小写字母、数字、中间用减号连接。 */
const SKILL_NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/**
 * 从某个目录往上找「项目根」：第一个包含 .git 的目录。
 * 和 DSH 官方 skill 提供者的算法一致，这样才不会找错地方。
 * @param {string} start 起始目录。
 * @returns {string} 项目根目录。
 */
function findProjectRoot(start) {
  const origin = resolve(start)
  let current = origin
  for (;;) {
    if (existsSync(join(current, '.git'))) return current
    const parent = dirname(current)
    if (parent === current) return origin
    current = parent
  }
}

/**
 * 本机上所有会放 skill 的目录。
 * @param {import('@deepseek-ai/cordis').Context} ctx 插件上下文。
 * @returns {Array<{ path: string, source: string, workspace: string }>} 根目录列表。
 */
function skillRoots(ctx) {
  const roots = [
    { path: join(dshHome(), 'skills'), source: 'user-dsh', workspace: '' },
    { path: join(homedir(), '.agents', 'skills'), source: 'user-agents', workspace: '' },
  ]
  for (const workspace of workspaces(ctx)) {
    const projectRoot = findProjectRoot(workspace.path)
    roots.push({ path: join(projectRoot, '.dsh', 'skills'), source: 'project-dsh', workspace: workspace.title })
    roots.push({ path: join(projectRoot, '.agents', 'skills'), source: 'project-agents', workspace: workspace.title })
  }
  return roots
}

/**
 * 去掉 YAML 值外面的引号。
 * @param {string} value 原始值。
 * @returns {string} 去引号后的值。
 */
function unquote(value) {
  const trimmed = value.trim()
  if (trimmed.length >= 2) {
    const first = trimmed[0]
    const last = trimmed[trimmed.length - 1]
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return trimmed.slice(1, -1)
    }
  }
  return trimmed
}

/**
 * 从前置信息里取一个顶层字段的值（支持 `|` / `>` 这种多行写法）。
 * @param {string[]} lines 前置信息按行拆开。
 * @param {string} key 字段名。
 * @returns {string | undefined} 字段值；没有这个字段时是 undefined。
 */
function scalarField(lines, key) {
  const safe = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const pattern = new RegExp(`^${safe}\\s*:\\s*(.*)$`)
  for (let index = 0; index < lines.length; index += 1) {
    const match = pattern.exec(lines[index])
    if (match === null) continue
    const inline = match[1].trim()
    if (inline.startsWith('|') || inline.startsWith('>')) {
      const collected = []
      for (let next = index + 1; next < lines.length; next += 1) {
        if (lines[next].trim() === '') {
          collected.push('')
          continue
        }
        if (!/^\s/.test(lines[next])) break
        collected.push(lines[next].replace(/^\s+/, ''))
      }
      return collected.join('\n').trim()
    }
    return unquote(inline)
  }
  return undefined
}

/**
 * 从前置信息里取一个布尔字段。
 * @param {string[]} lines 前置信息按行拆开。
 * @param {string} key 字段名。
 * @returns {boolean | undefined} true / false；没写就是 undefined。
 */
function booleanField(lines, key) {
  const raw = scalarField(lines, key)
  if (raw === undefined) return undefined
  const value = raw.toLowerCase()
  if (value === 'true' || value === '1' || value === 'yes') return true
  if (value === 'false' || value === '0' || value === 'no') return false
  return undefined
}

/**
 * 读一个 skill 说明书文件，解析出页面要显示的字段。
 * @param {string} file 说明书文件路径。
 * @param {{ source: string, workspace: string }} root 它属于哪个根目录。
 * @returns {any | null} 解析结果；不是合法 skill 时返回 null。
 */
function readSkillFile(file, root) {
  let raw = ''
  try {
    raw = readFileSync(file, 'utf8')
  } catch {
    return null
  }
  const parts = splitFrontmatter(raw)
  if (parts === null) return null
  const lines = parts.frontmatter.split(/\r?\n/)
  const name = scalarField(lines, 'name')
  const description = scalarField(lines, 'description')
  if (name === undefined || description === undefined) return null
  if (!SKILL_NAME_RE.test(name)) return null

  const disableModel = booleanField(lines, 'disable-model-invocation')
  const userInvocable = booleanField(lines, 'user-invocable')
  const policy = policyOf({
    modelInvocable: disableModel !== true,
    userInvocable: userInvocable !== false,
  })

  return {
    key: file,
    name,
    description,
    whenToUse: scalarField(lines, 'whenToUse') ?? '',
    source: root.source,
    provider: 'filesystem',
    path: file,
    dir: dirname(file),
    policy,
    editable: canEdit(file, root.source),
    workspaces: root.workspace.length > 0 ? [root.workspace] : [],
  }
}

/**
 * 扫一个根目录，把里面的 skill 都读出来。
 * 目录型：`<根>/<名字>/SKILL.md`；平铺型：`<根>/<名字>.md`。
 * @param {{ path: string, source: string, workspace: string }} root 根目录。
 * @returns {any[]} 这个根目录里的 skill。
 */
function scanRoot(root) {
  let entries = []
  try {
    entries = readdirSync(root.path, { withFileTypes: true })
  } catch {
    return []
  }
  const found = []
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue
    let file = ''
    if (entry.isDirectory()) file = join(root.path, entry.name, 'SKILL.md')
    else if (entry.isFile() && entry.name.endsWith('.md')) file = join(root.path, entry.name)
    else continue
    if (!existsSync(file)) continue
    const row = readSkillFile(file, root)
    if (row !== null) found.push(row)
  }
  found.sort((left, right) => left.name.localeCompare(right.name))
  return found
}

/**
 * 收集全部 skill：
 *   1. 直接扫本机的标准 skill 目录（个人级 + 各个工作区的项目级）——
 *      这些是能改能删的，也是「Skill 管理」真正要管的东西；
 *   2. 再问一次 DSH 的登记处，把没有实体文件的（DSH 自带包里的）补进来，
 *      这些只读。
 * 为什么要自己扫目录？因为 DSH 把本地 skill 的发现放在「每个 Agent 预设的作用域」里，
 * 主机这一层看到的名单是空的——只有 Agent 自己能看到。面板是全局的，
 * 所以这里按官方同一套规则（同样的目录、同样的项目根查找）自己扫一遍。
 * @param {import('@deepseek-ai/cordis').Context} ctx 插件上下文。
 * @returns {Promise<{ rows: any[], complete: boolean }>} 合并后的名单。
 */
async function collectSkills(ctx) {
  const rows = new Map()
  let complete = true

  for (const root of skillRoots(ctx)) {
    for (const row of scanRoot(root)) rows.set(row.key, row)
  }

  const skills = ctx.get('skills')
  if (skills !== undefined) {
    try {
      const listed = await skills.snapshot({})
      if (listed?.complete === false) complete = false
      for (const item of listed?.skills ?? []) {
        if (!item || typeof item.name !== 'string') continue
        const path = typeof item.path === 'string' ? item.path : ''
        // 已经有实体文件的，上面扫目录时已经收进来了，跳过。
        if (path.length > 0 && rows.has(path)) continue
        if (path.length === 0 && [...rows.values()].some((row) => row.name === item.name)) continue
        const key = path.length > 0 ? path : `name:${item.name}`
        if (rows.has(key)) continue
        rows.set(key, {
          key,
          name: item.name,
          description: typeof item.description === 'string' ? item.description : '',
          whenToUse: typeof item.whenToUse === 'string' ? item.whenToUse : '',
          source: typeof item.source === 'string' ? item.source : 'unknown',
          provider: typeof item.provider === 'string' ? item.provider : 'unknown',
          path,
          dir: path.length > 0 ? dirname(path) : '',
          policy: policyOf(item.invocation),
          editable: canEdit(path, typeof item.source === 'string' ? item.source : 'unknown'),
          workspaces: [],
        })
      }
    } catch {
      // 登记处暂时读不动：至少把扫出来的目录内容显示出来。
      complete = false
    }
  }

  const sorted = [...rows.values()].sort((left, right) => left.name.localeCompare(right.name))
  return { rows: sorted, complete }
}

/**
 * 把说明书拆成「前置信息」和「正文」两段。
 * @param {string} raw 文件原文。
 * @returns {{ head: string, frontmatter: string, tail: string } | null} 拆解结果；没有前置信息时是 null。
 */
function splitFrontmatter(raw) {
  const match = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(\r?\n|$)/.exec(raw)
  if (match === null) return null
  const start = match.index
  const end = start + match[0].length
  return {
    head: raw.slice(0, start),
    frontmatter: match[1],
    tail: raw.slice(end),
  }
}

/**
 * 在名单里按路径找一个 skill；找不到就抛错（防止网页端乱传路径来删别的文件）。
 * @param {any[]} rows 上一次 /list 得到的名单。
 * @param {string} path 网页端传来的文件路径。
 * @returns {any} 命中的那一行。
 */
function requireRow(rows, path) {
  const target = resolve(path)
  const row = rows.find((item) => item.path.length > 0 && resolve(item.path) === target)
  if (row === undefined) throw new Error('unknown skill path')
  return row
}

/**
 * 停用或启用一个 skill：改的是它说明书开头那两行开关。
 * @param {string} path SKILL.md（或平铺的 .md）路径。
 * @param {boolean} enabled true = 启用，false = 停用。
 * @returns {{ path: string, enabled: boolean }} 改完的結果。
 */
function setEnabled(path, enabled) {
  const raw = readFileSync(path, 'utf8')
  const parts = splitFrontmatter(raw)
  if (parts === null) throw new Error('这个 skill 的说明书没有 YAML 前置信息，无法自动停用')

  const kept = parts.frontmatter
    .split(/\r?\n/)
    .filter((line) => !INVOCATION_KEY.test(line))
  if (!enabled) kept.push(...DISABLE_LINES)

  const next = `${parts.head}---\n${kept.join('\n')}\n---\n${parts.tail}`
  writeFileSync(path, next, 'utf8')
  return { path, enabled }
}

/**
 * 让 DSH 忘掉缓存的 skill 名单，这样刚改的开关立刻生效。
 * @param {import('@deepseek-ai/cordis').Context} ctx 插件上下文。
 * @returns {void}
 */
function invalidate(ctx) {
  try {
    const skills = ctx.get('skills')
    if (skills !== undefined && typeof skills.invalidateCache === 'function') skills.invalidateCache()
  } catch {
    /* 缓存接口是可选的 */
  }
}

/**
 * 把整个 skill 移到 macOS 废纸篓（同名时加时间戳，绝不覆盖）。
 * @param {any} row 名单里的一行。
 * @returns {{ moved: string, to: string }} 移动结果。
 */
function moveToTrash(row) {
  // 目录型 skill：动的是整个文件夹；平铺 .md：只动那一个文件。
  const isFlatFile = basename(row.path) !== 'SKILL.md'
  const victim = isFlatFile ? row.path : row.dir
  if (!existsSync(victim)) throw new Error('文件已经不在了')

  const trash = trashDir()
  let target = join(trash, basename(victim))
  if (existsSync(target)) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    target = join(trash, `${basename(victim)}-${stamp}`)
  }
  statSync(trash) // 废纸篓不存在就直接抛错，不猜
  renameSync(victim, target)
  return { moved: victim, to: target }
}

/**
 * 在「访达」里定位到这个 skill 的文件。
 * 优先用 macOS 的 `open -R`（选中文件）；失败就退回打开所在文件夹。
 * @param {string} path 文件路径。
 * @returns {Promise<void>} 不管成功与否都不抛错。
 */
function reveal(path) {
  return new Promise((settle) => {
    const args = existsSync(path) ? ['-R', path] : [dirname(path)]
    const child = spawn('open', args, { detached: true, stdio: 'ignore' })
    child.on('error', () => {
      const fallback = spawn('open', [dirname(path)], { detached: true, stdio: 'ignore' })
      fallback.on('error', () => settle())
      fallback.on('close', () => settle())
    })
    child.on('close', () => settle())
    // 不等子进程真正退出，最多等一小会儿
    setTimeout(settle, 1500)
  })
}

/**
 * 处理挂载点下的全部请求。
 * @param {import('@deepseek-ai/cordis').Context} ctx 插件上下文。
 * @param {import('node:http').IncomingMessage} req 请求。
 * @param {import('node:http').ServerResponse} res 响应。
 * @param {string} token 本次进程的随机口令。
 * @param {string} routePrefix 挂载点的网址前缀（由 index.js 传进来）。
 * @returns {Promise<void>} 完成即返回。
 */
async function handle(ctx, req, res, token, routePrefix) {
  const url = new URL(req.url ?? '/', 'http://dsh.invalid')
  const path = url.pathname.slice(routePrefix.length) || '/'

  // 口令优先从首页注入里拿；万一没注入成功（例如页面是旧缓存），
  // 允许带着 DSH 登录 Cookie 的页面再要一次。别的程序拿不到这个 Cookie。
  if (path === '/handshake') {
    const cookie = req.headers.cookie
    if (typeof cookie === 'string' && cookie.length > 0) {
      sendJson(res, 200, { token, version: HOST_VERSION, home: dshHome() })
      return
    }
    sendJson(res, 403, { error: 'forbidden' })
    return
  }

  const provided = req.headers['x-dsh-sidebar-token'] ?? req.headers['x-dsh-skill-token'] ?? url.searchParams.get('token')
  if (provided !== token) {
    sendJson(res, 403, { error: 'forbidden', hint: '刷新页面让插件重新读取口令' })
    return
  }

  const skills = ctx.get('skills')
  if (skills === undefined) {
    sendJson(res, 503, { error: 'skills service unavailable' })
    return
  }

  try {
    if (req.method === 'GET' && path === '/list') {
      const { rows, complete } = await collectSkills(ctx)
      sendJson(res, 200, {
        skills: rows,
        complete,
        home: dshHome(),
        trash: trashDir(),
        version: HOST_VERSION,
      })
      return
    }

    if (req.method === 'GET' && path === '/read') {
      const file = url.searchParams.get('path') ?? ''
      const wanted = url.searchParams.get('name') ?? ''
      const { rows } = await collectSkills(ctx)
      // 有实体文件的按路径找；DSH 自带、没有文件的按名字找。
      const row = file.length > 0
        ? rows.find((item) => item.path.length > 0 && resolve(item.path) === resolve(file))
        : rows.find((item) => item.name === wanted)
      if (row === undefined) {
        sendJson(res, 400, { error: 'unknown skill' })
        return
      }
      let content = ''
      if (row.path.length > 0) {
        try {
          content = readFileSync(row.path, 'utf8')
        } catch {
          content = ''
        }
      } else {
        try {
          const definition = await skills.get(row.name)
          content = typeof definition?.content === 'string' ? definition.content : ''
        } catch {
          content = ''
        }
      }
      const parts = content.length > 0 ? splitFrontmatter(content) : null
      sendJson(res, 200, {
        name: row.name,
        path: row.path,
        content: content.slice(0, MAX_CONTENT_CHARS),
        truncated: content.length > MAX_CONTENT_CHARS,
        body: parts === null ? content : parts.tail,
        frontmatter: parts === null ? '' : parts.frontmatter,
      })
      return
    }

    if (req.method === 'POST' && path === '/enabled') {
      const body = await readJsonBody(req)
      const { rows } = await collectSkills(ctx)
      const row = requireRow(rows, String(body.path ?? ''))
      if (!row.editable) {
        sendJson(res, 403, { error: '这个 skill 是只读的（DSH 自带或没有写权限）' })
        return
      }
      const result = setEnabled(row.path, body.enabled === true)
      invalidate(ctx)
      sendJson(res, 200, { ok: true, ...result })
      return
    }

    if (req.method === 'POST' && path === '/reveal') {
      const body = await readJsonBody(req)
      const { rows } = await collectSkills(ctx)
      const row = requireRow(rows, String(body.path ?? ''))
      await reveal(row.path)
      sendJson(res, 200, { ok: true })
      return
    }

    if (req.method === 'POST' && path === '/trash') {
      const body = await readJsonBody(req)
      const { rows } = await collectSkills(ctx)
      const row = requireRow(rows, String(body.path ?? ''))
      if (!row.editable) {
        sendJson(res, 403, { error: '这个 skill 是只读的（DSH 自带或没有写权限）' })
        return
      }
      const result = moveToTrash(row)
      invalidate(ctx)
      sendJson(res, 200, { ok: true, ...result })
      return
    }

    sendJson(res, 404, { error: 'not found', path })
  } catch (error) {
    sendJson(res, 400, { error: error instanceof Error ? error.message : String(error) })
  }
}

/**
 * 把「Skill 管理」这一段挂到主插件上。
 *
 * 和 archived 那一段一个做法：口令由 index.js 统一生成并注入首页，
 * 这里只在 Web 服务器上注册一条更长的前缀路由。
 * @param {import('@deepseek-ai/cordis').Context} ctx 插件上下文。
 * @param {string} token 本次进程的随机口令（和主插件共用）。
 * @param {string} routePrefix 挂载点网址前缀，例如 /dsh-left-sidebar-pro/skill。
 * @returns {void}
 */
export function applySkills(ctx, token, routePrefix) {
  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'prefix',
        path: routePrefix,
        handler: (req, res) => handle(ctx, req, res, token, routePrefix),
      }),
    'sidebar-pro: skill routes',
  )

  ctx.logger?.info?.(`sidebar-pro skills ready at ${routePrefix}`)
}
