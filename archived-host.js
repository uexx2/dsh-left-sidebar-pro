/**
 * 已归档对话 · 宿主半（Host half，本插件的一部分）
 * =====================================================================
 *
 * 这一段由 index.js 在启动时调用 applyArchived() 挂上；文件单独放一个，
 * 是为了让「已归档」的读写逻辑保持独立、好测好改。
 *
 * 它负责浏览器碰不到的那些事：
 *   1. 把已经归档的对话列出来（标题、所在文件夹、时间、是否已标记待删除）；
 *   2. 把某一条已归档对话的正文读出来，交给网页显示；
 *   3. 「确认删除」时先**只做标记**（网页上把那一行划掉），到期（默认 3 天）才真正删文件；
 *   4. 标记期间可以「恢复」：恢复就是把这个标记去掉，文件一个都不动；
 *   5. 定时检查有没有到期的，到期的才把本机记录文件真正删掉。
 *
 * 标记存在哪儿？
 *   ~/.dsh/archived-panel/trash.json —— 小账本（并入本插件后路径没变，
 *   所以以前已经划掉的记录，照样认得）。
 *
 * 网址长什么样？
 *   挂在主插件的前缀下面：/dsh-left-sidebar-pro/archived/list、/read、/pending、
 *   /restore、/delete、/sweep。路由表按「最长前缀优先」匹配，所以这一段
 *   不会被主插件自己的 /dsh-left-sidebar-pro 处理器抢走。
 *   口令和首页注入都由 index.js 统一负责（共用同一个随机口令），
 *   请求头也叫 x-dsh-sidebar-token —— 这一段自己不再注入任何东西。
 *
 * 会话文件放在哪里？
 *   ~/.dsh/sessions/<把文件夹路径转义后的名字>/<会话 id>/session.v4.jsonl.zstd
 *   这个 .zstd 文件是“每写一段就追加一个 zstd 帧”，所以要一帧一帧解开，
 *   不能用一次性解压。
 *
 * 删除会不会影响 DSH 正在显示的列表？
 *   删文件的同时会请 DSH 的“工作区注册表”重新扫描一遍磁盘，这样侧边栏里那条
 *   记录会立刻消失，不需要重启。
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { zstdDecompressSync } from 'node:zlib'

/** 本段占用的「子路径」；真正注册的前缀由 index.js 传进来（/dsh-left-sidebar-pro/archived）。 */
const SUB_PATH = '/archived'

/** zstd 帧的魔数（每个压缩帧都以这 4 个字节开头）。 */
const ZSTD_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])

/** 单条对话最多返回多少条消息，避免一条超长对话把浏览器卡住。 */
const MAX_ENTRIES = 600

/** 单条对话正文最多多少字符。 */
const MAX_CHARS = 400000

/** 一天有多少毫秒。 */
const DAY_MS = 24 * 60 * 60 * 1000

/** 本段的可调参数。想改就改 cordis.patch.yml 里 sidebar-pro 那条 config 的 archived 段。 */
const DEFAULTS = {
  /** 标记“待删除”之后保留几天，默认 3 天；填 0 表示下次检查就真删。 */
  retentionDays: 3,
  /** 每隔多少分钟检查一次有没有到期的，默认 10 分钟。 */
  sweepMinutes: 10,
  /** 小账本放在哪里；留空表示 ~/.dsh/archived-panel/trash.json。 */
  statePath: null,
}


/**
 * DSH 的家目录：默认是 ~/.dsh，环境变量 DSH_HOME 可以改。
 * @returns {string} 绝对路径。
 */
function dshHome() {
  const configured = process.env.DSH_HOME
  return configured && configured.length > 0 ? configured : join(homedir(), '.dsh')
}

/**
 * 把任意字符串转义成一个安全的文件名片段（和 DSH 自己的规则一致）。
 * 会话 id 里如果出现 `/`、`..` 之类，会被转义成 `~XXXX`，防止越权访问别的目录。
 * @param {string} raw 原始字符串。
 * @returns {string} 可安全用作单个路径段的字符串。
 */
function encodeSegment(raw) {
  if (raw.length === 0) throw new Error('cannot encode an empty path segment')
  if (raw === '.') return '~002E'
  if (raw === '..') return '~002E~002E'
  let out = ''
  for (let i = 0; i < raw.length; i += 1) {
    const code = raw.charCodeAt(i)
    const ch = String.fromCharCode(code)
    if (ch !== '~' && /^[A-Za-z0-9._-]$/.test(ch)) out += ch
    else out += `~${code.toString(16).toUpperCase().padStart(4, '0')}`
  }
  return out
}

/**
 * 安全地读一个目录；不存在或没权限时返回空数组，绝不抛错。
 * @param {string} path 目录路径。
 * @returns {string[]} 目录项名字。
 */
function safeReaddir(path) {
  try {
    return readdirSync(path)
  } catch {
    return []
  }
}

/**
 * 只从 DSH 的工作区注册表读已归档名单；读不到时返回 null。
 * 自动删除前一定要用这个：注册表读不到时宁可不删，也不能误删。
 * @param {import('@deepseek-ai/cordis').Context} ctx 插件上下文。
 * @returns {string[] | null} 会话 id 数组，或 null。
 */
function registryArchivedIds(ctx) {
  try {
    const registry = ctx.get('workspaceRegistry')
    const ids = registry && registry.archivedSessionIds
    if (Array.isArray(ids)) return ids.map(String)
  } catch {
    /* 注册表暂时不可用 */
  }
  return null
}

/**
 * 读出所有已归档的会话 id。
 * 首选 DSH 的工作区注册表（内存里的权威答案）；拿不到时退回读磁盘上的
 * storages/workspace.json，保证界面始终有东西可显示。
 * @param {import('@deepseek-ai/cordis').Context} ctx 插件上下文。
 * @returns {string[]} 会话 id 数组。
 */
function archivedIds(ctx) {
  const authoritative = registryArchivedIds(ctx)
  if (authoritative !== null) return authoritative
  try {
    const raw = JSON.parse(readFileSync(join(dshHome(), 'storages', 'workspace.json'), 'utf8'))
    const ids = raw && raw.global && raw.global.archivedSessionIds
    if (Array.isArray(ids)) return ids.map(String)
  } catch {
    /* 文件不存在或格式不对 */
  }
  return []
}

/**
 * 找到一条会话在本机上的目录。
 * @param {string} home DSH 家目录。
 * @param {string} id 会话 id。
 * @returns {{ dir: string, projectDir: string } | undefined} 目录信息。
 */
function findSessionDir(home, id) {
  const root = join(home, 'sessions')
  let segment
  try {
    segment = encodeSegment(id)
  } catch {
    return undefined
  }
  for (const project of safeReaddir(root)) {
    const dir = join(root, project, segment)
    if (existsSync(dir)) return { dir, projectDir: join(root, project) }
  }
  return undefined
}

/**
 * 把一整个文件里的 zstd 帧全部解开。
 *
 * ── 为什么不是「按魔数逐帧解」？ ──
 *   这里的写法是：从头找每个帧的魔数，然后
 *   `zstdDecompressSync(raw.subarray(该帧起点))`。**那是错的**：
 *   Node 的 zstdDecompressSync 会把缓冲区里从该点开始的**所有**帧依次解开，
 *   所以从第 2 帧开始解，得到的是「第 2 帧到结尾」的全部内容 —— 于是
 *   每条消息都会被重复解出来（N 个帧就重复 N 遍），正文页面上看着就是
 *   「同一句话说了好几遍」。并进本插件时实测抓到的，顺手修正。
 *
 * ── 正确做法 ──
 *   直接一次性解整个文件：Node 会依次解开里面所有帧并拼接（实测如此），
 *   既不重复也不漏。万一尾部有半截帧（文件正在写入）导致整块解不开，
 *   就退回去掉尾部那一帧再试，一直退到能解开为止 —— 保证至少能读出完整的那部分。
 * @param {Buffer} raw 文件原始字节。
 * @returns {Buffer} 解开后的文本字节。
 */
function decompressAll(raw) {
  if (raw.length === 0) return Buffer.alloc(0)

  // ── 为什么不再「整块丢给 zstdDecompressSync」？──
  //
  // 会话日志是**一帧一帧追加**写出来的，一个文件里有很多帧。
  // 有的 Node 运行时会「把缓冲区里所有帧一次解开」，有的则直接抛错。
  // DSH 桌面版内嵌的那个 Node 就属于后者 —— 于是老代码走到 catch 里，
  // 用「砍掉最后一帧再试」的办法一路砍到只剩第一帧，
  // 结果只解出「会话头」那一帧：标题、创建时间都在，**正文一条都没有**。
  // 老代码会出现「点进去没有文字内容」的正是这个：只解出会话头那一帧。
  //
  // 现在的做法：先用魔数把文件切成一段段「候选帧」，再**一段一段单独解**。
  // 单独一帧是完整的帧，任何运行时都能解。万一压缩数据里恰好出现魔数
  // （极少见），就把下一段并进来重试一次，直到解出来为止。
  const starts = []
  let at = raw.indexOf(ZSTD_MAGIC, 0)
  if (at < 0) return Buffer.alloc(0)
  while (at >= 0) {
    starts.push(at)
    at = raw.indexOf(ZSTD_MAGIC, at + 4)
  }

  const parts = []
  let index = 0
  while (index < starts.length) {
    let cursor = index
    let end = cursor + 1 < starts.length ? starts[cursor + 1] : raw.length
    let decoded = null
    while (cursor < starts.length) {
      try {
        decoded = zstdDecompressSync(raw.subarray(starts[index], end))
        break
      } catch {
        cursor += 1
        if (cursor >= starts.length) break
        end = cursor + 1 < starts.length ? starts[cursor + 1] : raw.length
      }
    }
    // 解不出来（例如正在写入的半截帧）就跳过这一段，别把整条日志废掉
    if (decoded !== null) parts.push(decoded)
    index = cursor + 1
  }
  return Buffer.concat(parts)
}

/**
 * 解开一个会话日志文件里的全部 zstd 帧，返回事件数组。
 * 文件是“一帧一帧追加”写出来的，这里一次性把所有帧解开（见 decompressAll 的说明）。
 * @param {string} file 日志文件的绝对路径。
 * @returns {{ events: any[], error?: string }} 事件数组或错误说明。
 */
function readEvents(file) {
  if (typeof zstdDecompressSync !== 'function') {
    return { events: [], error: 'this Node runtime has no zstd support' }
  }
  let raw
  try {
    raw = readFileSync(file)
  } catch (error) {
    return { events: [], error: String(error && error.message ? error.message : error) }
  }
  const text = decompressAll(raw).toString('utf8')
  const events = []
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (trimmed.length === 0) continue
    try {
      events.push(JSON.parse(trimmed))
    } catch {
      /* 半截行（正在写入）忽略 */
    }
  }
  return { events }
}

/**
 * 把消息里的文字块拼成一段纯文本，图片/工具调用等先忽略。
 * @param {any} content 消息的 content 数组。
 * @returns {string} 纯文本。
 */
function textOfBlocks(content) {
  if (!Array.isArray(content)) return ''
  const chunks = []
  for (const block of content) {
    if (!block || typeof block !== 'object') continue
    if (block.type === 'text' && typeof block.text === 'string') chunks.push(block.text)
  }
  return chunks.join('\n').trim()
}

/**
 * 从投影缓存里读标题（最快，且不用解压日志）。
 * @param {string} home DSH 家目录。
 * @param {string} id 会话 id。
 * @returns {string | null} 标题。
 */
function cachedTitle(home, id) {
  const file = join(home, 'storages', 'session_projcache', 'sessions', `${id}.json`)
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'))
    const title = parsed && parsed.record && parsed.record.rows && parsed.record.rows.title
    const value = title && title.val
    if (typeof value === 'string' && value.trim().length > 0) return value.trim()
  } catch {
    /* 没有缓存就用日志里的标题 */
  }
  return null
}

/**
 * 从日志事件里取最后一个标题事件。
 * @param {any[]} events 事件数组。
 * @returns {string | null} 标题。
 */
function loggedTitle(events) {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i]
    if (event && event.type === 'session/title') {
      const title = event.data && event.data.title
      if (typeof title === 'string' && title.trim().length > 0) return title.trim()
    }
  }
  return null
}

//#region 待删除小账本

/**
 * 小账本文件路径。
 * @param {string} home DSH 家目录。
 * @param {object} cfg 插件配置。
 * @returns {string} 绝对路径。
 */
function trashPath(home, cfg) {
  return cfg.statePath && String(cfg.statePath).length > 0
    ? String(cfg.statePath)
    : join(home, 'archived-panel', 'trash.json')
}

/**
 * 读小账本；文件不存在或坏了都返回空账本。
 * @param {string} home DSH 家目录。
 * @param {object} cfg 插件配置。
 * @returns {{ version: number, pending: Record<string, object> }} 账本。
 */
function readTrash(home, cfg) {
  try {
    const parsed = JSON.parse(readFileSync(trashPath(home, cfg), 'utf8'))
    if (parsed && typeof parsed === 'object' && parsed.pending && typeof parsed.pending === 'object') {
      return { version: 1, pending: parsed.pending }
    }
  } catch {
    /* 第一次运行没有这个文件 */
  }
  return { version: 1, pending: {} }
}

/**
 * 写小账本（先写临时文件再改名，避免写到一半断电留下半截文件）。
 * @param {string} home DSH 家目录。
 * @param {object} cfg 插件配置。
 * @param {object} trash 账本内容。
 * @returns {void}
 */
function writeTrash(home, cfg, trash) {
  const file = trashPath(home, cfg)
  mkdirSync(dirname(file), { recursive: true })
  const temporary = `${file}.${process.pid}.tmp`
  writeFileSync(temporary, JSON.stringify(trash, null, 2))
  renameSync(temporary, file)
}

/**
 * 把几条会话标记成“待删除”。
 * @param {string} home DSH 家目录。
 * @param {object} cfg 插件配置。
 * @param {string[]} ids 会话 id。
 * @param {number} now 当前时间戳（毫秒）。
 * @returns {object} 更新后的账本。
 */
function markPending(home, cfg, ids, now) {
  const trash = readTrash(home, cfg)
  const days = Math.max(0, Number(cfg.retentionDays) || 0)
  for (const id of ids) {
    const described = describeSession(home, id)
    trash.pending[id] = {
      markedAt: now,
      dueAt: now + days * DAY_MS,
      title: described.title,
      cwd: described.cwd,
      project: described.project ?? null,
    }
  }
  writeTrash(home, cfg, trash)
  return trash
}

/**
 * 取消“待删除”标记（也就是恢复）。
 * @param {string} home DSH 家目录。
 * @param {object} cfg 插件配置。
 * @param {string[]} ids 会话 id。
 * @returns {object} 更新后的账本。
 */
function clearPending(home, cfg, ids) {
  const trash = readTrash(home, cfg)
  for (const id of ids) delete trash.pending[id]
  writeTrash(home, cfg, trash)
  return trash
}

//#endregion

/**
 * 汇总一条已归档会话的元信息。
 * @param {string} home DSH 家目录。
 * @param {string} id 会话 id。
 * @returns {object} 供网页显示的记录。
 */
function describeSession(home, id) {
  const found = findSessionDir(home, id)
  if (found === undefined) {
    return { id, title: null, cwd: null, project: null, createdAt: null, updatedAt: null, bytes: 0, missing: true }
  }
  const file = join(found.dir, 'session.v4.jsonl.zstd')
  const { events } = readEvents(file)
  const header = events.find((event) => event && event.type === 'session')
  let bytes = 0
  try {
    bytes = readFileSync(file).length
  } catch {
    bytes = 0
  }
  const times = events.map((event) => (typeof event.time === 'number' ? event.time : 0))
  const created = header && typeof header.createdAt === 'number' ? header.createdAt : null
  const last = times.length > 0 ? Math.max(...times) : null
  const projectName = found.projectDir.split('/').pop() || ''
  return {
    id,
    title: cachedTitle(home, id) || loggedTitle(events) || null,
    cwd: header && typeof header.cwd === 'string' ? header.cwd : null,
    project: projectName,
    createdAt: created,
    updatedAt: last && last > 0 ? last : created,
    bytes,
    missing: false,
  }
}

/**
 * 把一条会话切成“谁说了什么”的清单，供网页阅读。
 * @param {string} home DSH 家目录。
 * @param {string} id 会话 id。
 * @returns {object} 标题、目录和消息清单。
 */
function readTranscript(home, id) {
  const found = findSessionDir(home, id)
  if (found === undefined) return { id, missing: true, entries: [] }
  const file = join(found.dir, 'session.v4.jsonl.zstd')
  const { events, error } = readEvents(file)
  if (error !== undefined) return { id, missing: false, error, entries: [] }
  const header = events.find((event) => event && event.type === 'session')
  const entries = []
  let chars = 0
  for (const event of events) {
    if (entries.length >= MAX_ENTRIES || chars >= MAX_CHARS) break
    if (!event || typeof event !== 'object') continue
    let role = null
    let text = ''
    if (event.type === 'user/message') {
      role = 'user'
      text = textOfBlocks(event.data && event.data.content)
    } else if (event.type === 'assistant/message') {
      role = 'assistant'
      text = textOfBlocks(event.data && event.data.message && event.data.message.content)
    } else {
      continue
    }
    if (text.length === 0) continue
    chars += text.length
    entries.push({ role, text, time: typeof event.time === 'number' ? event.time : null })
  }
  return {
    id,
    missing: false,
    title: cachedTitle(home, id) || loggedTitle(events) || null,
    cwd: header && typeof header.cwd === 'string' ? header.cwd : null,
    createdAt: header && typeof header.createdAt === 'number' ? header.createdAt : null,
    entries,
    truncated: entries.length >= MAX_ENTRIES || chars >= MAX_CHARS,
  }
}

/**
 * 真正删除一条会话的本地文件：会话目录 + 投影缓存。
 * 只有“到期自动删除”才会走到这里，恢复流程绝不调用它。
 * @param {string} home DSH 家目录。
 * @param {string} id 会话 id。
 * @returns {{ id: string, ok: boolean, removed: string[], error?: string }} 结果。
 */
function deleteSessionFiles(home, id) {
  const removed = []
  const found = findSessionDir(home, id)
  if (found !== undefined) {
    try {
      rmSync(found.dir, { recursive: true, force: true })
      removed.push(found.dir)
    } catch (error) {
      return { id, ok: false, removed, error: String(error && error.message ? error.message : error) }
    }
  }
  for (const name of [`${id}.json`, `${encodeSegment(id)}.json`]) {
    const file = join(home, 'storages', 'session_projcache', 'sessions', name)
    if (!existsSync(file)) continue
    try {
      rmSync(file, { force: true })
      removed.push(file)
    } catch {
      /* 缓存删不掉不算失败，下次启动会忽略 */
    }
  }
  return { id, ok: true, removed }
}

/**
 * 让 DSH 的侧边栏立刻忘掉被删掉的会话：重新扫描磁盘上的会话头，
 * 再把它从“已归档”集合里摘掉。
 * @param {import('@deepseek-ai/cordis').Context} ctx 插件上下文。
 * @param {string[]} ids 已经从磁盘删掉的会话 id。
 * @returns {Promise<void>} 完成即返回；任何失败都被吞掉（删除本身已完成）。
 */
async function refreshRegistry(ctx, ids) {
  try {
    const registry = ctx.get('workspaceRegistry')
    if (!registry) return
    if (typeof registry.replaceHeaderIndex === 'function' && typeof registry.listStoredHeaders === 'function') {
      await registry.replaceHeaderIndex(await registry.listStoredHeaders())
    }
  } catch {
    /* 刷新失败只影响列表显示，不影响已删除的文件 */
  }
  try {
    const registry = ctx.get('workspaceRegistry')
    if (registry && typeof registry.unarchiveSession === 'function') {
      for (const id of ids) await registry.unarchiveSession(id)
    }
  } catch {
    /* 同上 */
  }
}

/**
 * 把因为这次删除而变空的工作区注册摘掉。
 *
 * 为什么需要：DSH 左边的列表列的是「工作区」（你加进来的文件夹），对话删了工作区还在，
 * 分组标题就会一直挂在侧边栏上。这里把「刚被我们删空了」的工作区取消注册——
 * 注意只是从侧边栏列表里摘掉，**磁盘上的文件夹和里面的东西一个都不会动**。
 *
 * 两条保护：
 *   - 只处理「原来的成员里包含这次删掉的 id」的工作区，绝不误伤本来就空的工作区；
 *   - 默认工作区（default-workspace）不摘，因为 DSH 一旦删掉它就不再自动创建默认工作区了。
 *
 * @param {import('@deepseek-ai/cordis').Context} ctx 插件上下文。
 * @param {string[]} deletedIds 这次真的删掉的会话 id。
 * @returns {Promise<Array<{ id: string, title: string, path: string }>>} 被摘掉的工作区。
 */
async function pruneEmptiedWorkspaces(ctx, deletedIds) {
  const pruned = []
  if (deletedIds.length === 0) return pruned
  const gone = new Set(deletedIds)
  try {
    const registry = ctx.get('workspaceRegistry')
    if (!registry || typeof registry.list !== 'function' || typeof registry.delete !== 'function') return pruned
    const defaultId = registry.state && registry.state.defaultWorkspaceId
    for (const entity of registry.list()) {
      if (entity.id === defaultId) continue
      const record = entity.record || {}
      const saved = Array.isArray(record.sessionIds) ? record.sessionIds : []
      if (!saved.some((id) => gone.has(id))) continue
      const live = Array.isArray(entity.sessionIds) ? entity.sessionIds : saved
      if (live.length > 0) continue
      const removed = await registry.delete(entity.id)
      if (removed) pruned.push({ id: entity.id, title: entity.title, path: entity.path })
    }
  } catch (error) {
    ctx.logger?.warn?.(`archived-panel: 清理空工作区失败：${String(error && error.message ? error.message : error)}`)
  }
  return pruned
}

/**
 * 删除落地之后的收尾：让 DSH 的列表立刻忘掉这些会话，并摘掉因此变空的工作区分组。
 * @param {import('@deepseek-ai/cordis').Context} ctx 插件上下文。
 * @param {string[]} ids 已经删掉文件的会话 id。
 * @returns {Promise<Array<{ id: string, title: string, path: string }>>} 被摘掉的工作区。
 */
async function settleDeletions(ctx, ids) {
  if (ids.length === 0) return []
  await refreshRegistry(ctx, ids)
  // 通知所有打开的页面：这条会话没了。少了这一步，它的行会掉进「未分组」继续显示，
  // 直到 DSH 重启为止——这正是「删了左边还在」的原因。
  for (const id of ids) {
    try {
      if (typeof ctx.emit === 'function') ctx.emit('api-session/removed', id)
    } catch {
      /* 通知失败只影响这次刷新，下次刷新页面就看不到了 */
    }
  }
  return await pruneEmptiedWorkspaces(ctx, ids)
}

/**
 * 到期清扫：把已经过了保留期的“待删除”真正删掉。
 * 安全规则：只有 DSH 注册表明确说这条还在“已归档”名单里时才删；
 * 如果它被取消归档继续用了，就只清掉标记、保留文件。
 * @param {import('@deepseek-ai/cordis').Context} ctx 插件上下文。
 * @param {string} home DSH 家目录。
 * @param {object} cfg 插件配置。
 * @returns {Promise<{ deleted: string[], restored: string[] }>} 本次动作。
 */
async function sweep(ctx, home, cfg) {
  const now = Date.now()
  const trash = readTrash(home, cfg)
  const entries = Object.entries(trash.pending)
  if (entries.length === 0) return { deleted: [], restored: [] }
  const stillArchived = registryArchivedIds(ctx)
  const deleted = []
  const restored = []
  for (const [id, entry] of entries) {
    if (stillArchived !== null && !stillArchived.includes(id)) {
      delete trash.pending[id]
      restored.push(id)
      continue
    }
    if (typeof entry.dueAt !== 'number' || entry.dueAt > now) continue
    const result = deleteSessionFiles(home, id)
    if (result.ok) {
      delete trash.pending[id]
      deleted.push(id)
    }
  }
  if (deleted.length > 0 || restored.length > 0) writeTrash(home, cfg, trash)
  const prunedWorkspaces = await settleDeletions(ctx, deleted)
  return { deleted, restored, prunedWorkspaces }
}

/**
 * 读一个请求的 JSON 主体（最多 1MB）。
 * @param {import('node:http').IncomingMessage} req 请求。
 * @returns {Promise<any>} 解析后的对象。
 */
async function readJsonBody(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > 1_000_000) throw new Error('request body too large')
    chunks.push(chunk)
  }
  if (chunks.length === 0) return {}
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

/**
 * 回一个 JSON 响应。
 * @param {import('node:http').ServerResponse} res 响应对象。
 * @param {number} status HTTP 状态码。
 * @param {any} value 任意可序列化的值。
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
 * 从请求体里取一组会话 id。
 * @param {any} body 请求体。
 * @returns {string[]} 会话 id 数组（可能是空的）。
 */
function idsOf(body) {
  return Array.isArray(body && body.ids) ? body.ids.map(String) : []
}

/**
 * 处理已归档这一组网址下的全部请求（/dsh-left-sidebar-pro/archived/...）。
 * @param {import('@deepseek-ai/cordis').Context} ctx 插件上下文。
 * @param {import('node:http').IncomingMessage} req 请求。
 * @param {import('node:http').ServerResponse} res 响应。
 * @param {string} token 本次进程的随机口令（由 index.js 统一生成）。
 * @param {object} cfg 本段的配置。
 * @param {string} prefix 本段注册的网址前缀。
 * @returns {Promise<void>} 完成即返回。
 */
async function handleArchived(ctx, req, res, token, cfg, prefix) {
  const url = new URL(req.url ?? '/', 'http://dsh.invalid')
  const path = url.pathname.slice(prefix.length) || '/'
  const home = dshHome()
  // 「换口令」那一步由 index.js 统一处理（/dsh-left-sidebar-pro/handshake），这里只管业务。
  const provided = req.headers['x-dsh-sidebar-token'] ?? url.searchParams.get('token')
  if (provided !== token) {
    sendJson(res, 403, { error: 'forbidden', hint: 'reload the page so the plugin can read its token' })
    return
  }
  try {
    if (req.method === 'GET' && path === '/list') {
      // 顺手清扫一次：到期的东西不用等定时器，打开面板就没了。
      const swept = await sweep(ctx, home, cfg)
      const trash = readTrash(home, cfg)
      const now = Date.now()
      const days = Math.max(0, Number(cfg.retentionDays) || 0)
      const sessions = archivedIds(ctx).map((id) => {
        const described = describeSession(home, id)
        const entry = trash.pending[id]
        return {
          ...described,
          pending: entry !== undefined,
          markedAt: entry ? entry.markedAt : null,
          dueAt: entry ? entry.dueAt : null,
          remainingMs: entry && typeof entry.dueAt === 'number' ? Math.max(0, entry.dueAt - now) : null,
        }
      })
      sessions.sort((left, right) => (right.updatedAt ?? 0) - (left.updatedAt ?? 0))
      sendJson(res, 200, { home, sessions, retentionDays: days, swept })
      return
    }
    if (req.method === 'GET' && path === '/read') {
      const id = url.searchParams.get('id')
      if (!id) {
        sendJson(res, 400, { error: 'missing id' })
        return
      }
      sendJson(res, 200, readTranscript(home, id))
      return
    }
    if (req.method === 'POST' && path === '/pending') {
      const ids = idsOf(await readJsonBody(req))
      if (ids.length === 0) {
        sendJson(res, 400, { error: 'missing ids' })
        return
      }
      const trash = markPending(home, cfg, ids, Date.now())
      sendJson(res, 200, {
        pending: ids.map((id) => ({ id, dueAt: trash.pending[id] ? trash.pending[id].dueAt : null })),
        retentionDays: Math.max(0, Number(cfg.retentionDays) || 0),
      })
      return
    }
    if (req.method === 'POST' && path === '/restore') {
      const ids = idsOf(await readJsonBody(req))
      if (ids.length === 0) {
        sendJson(res, 400, { error: 'missing ids' })
        return
      }
      clearPending(home, cfg, ids)
      sendJson(res, 200, { restored: ids })
      return
    }
    // 「立即删除」：不想等保留期，现在就把文件删掉（网页端会要求点两次才走到这里）。
    if (req.method === 'POST' && path === '/delete') {
      const ids = idsOf(await readJsonBody(req))
      if (ids.length === 0) {
        sendJson(res, 400, { error: 'missing ids' })
        return
      }
      const results = []
      const deleted = []
      for (const id of ids) {
        const result = deleteSessionFiles(home, id)
        results.push(result)
        // 只有真的删成功了才把标记也清掉；失败就留着，方便再点一次。
        if (result.ok) deleted.push(id)
      }
      if (deleted.length > 0) {
        clearPending(home, cfg, deleted)
        const prunedWorkspaces = await settleDeletions(ctx, deleted)
        sendJson(res, 200, { results, prunedWorkspaces })
        return
      }
      sendJson(res, 200, { results, prunedWorkspaces: [] })
      return
    }
    if (req.method === 'POST' && path === '/sweep') {
      sendJson(res, 200, await sweep(ctx, home, cfg))
      return
    }
    sendJson(res, 404, { error: 'unknown endpoint' })
  } catch (error) {
    sendJson(res, 500, { error: String(error && error.message ? error.message : error) })
  }
}

/** 本段占用的网址前缀（相对主插件的 /dsh-left-sidebar-pro）。 */
export const ARCHIVED_PATH = SUB_PATH

/**
 * 把「已归档」这一段挂到 DSH 上。
 *
 * 为什么口令要从外面传进来、而不是自己造一个？
 *   因为并入主插件之后就只有一个随机口令了：网页端拿它调所有接口，
 *   注入首页、握手也都由 index.js 一处负责，少一套东西就少一处出错的地方。
 * @param {import('@deepseek-ai/cordis').Context} ctx 插件上下文。
 * @param {object} [rawConfig] 这一段自己的配置（cordis.patch.yml 里的 archived 段）。
 * @param {string} token 本次进程的随机口令。
 * @param {string} routePrefix 注册用的网址前缀（例如 /dsh-left-sidebar-pro/archived）。
 * @returns {void}
 */
export function applyArchived(ctx, rawConfig, token, routePrefix) {
  const cfg = { ...DEFAULTS, ...(rawConfig ?? {}) }
  const home = dshHome()
  const retentionDays = Math.max(0, Number(cfg.retentionDays) || 0)
  const sweepMinutes = Math.max(1, Number(cfg.sweepMinutes) || DEFAULTS.sweepMinutes)

  ctx.effect(
    () => ctx.webServer.register({
      kind: 'prefix',
      path: routePrefix,
      handler: (req, res) => handleArchived(ctx, req, res, token, cfg, routePrefix),
    }),
    'sidebar-pro: archived routes',
  )

  // 启动时扫一次（把上次运行期间到期的清掉），之后每 sweepMinutes 分钟扫一次。
  const runSweep = () => {
    sweep(ctx, home, cfg).catch(() => {})
  }
  runSweep()
  ctx.effect(() => {
    const timer = setInterval(runSweep, sweepMinutes * 60 * 1000)
    return () => clearInterval(timer)
  }, 'sidebar-pro: archived sweep timer')

  ctx.logger?.info?.(`sidebar-pro archived ready at ${routePrefix} (保留 ${retentionDays} 天)`)
}
