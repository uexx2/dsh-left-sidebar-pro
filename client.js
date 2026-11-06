/**
 * dsh-left-sidebar-pro · 网页半（Client half）
 * =======================================
 *
 * 这个文件跑在 DSH 的网页界面里，负责：
 *   1. 把左侧栏重排成「新建任务 + More 分组 + Top 置顶区 + Project」；
 *   2. 提供「MCP 服务器」整页（列出 / 新增 / 修改 / 停用 / 删除）；
 *   3. 提供「已归档对话」整页（看正文 / 取消归档 / 两步确认删除）；
 *   4. 提供「Skill 管理」整页（列表 / 搜索 / 停用启用 / 读说明书 / 定位）；
 *   5. 对话状态点、行内归档、拖拽落点线、展开收起动画。
 *
 * 「已归档对话」和「Skill 管理」都作为 main 座位注册在本插件里；
 * 它们对应的后端分别在 archived-host.js 和 skill-host.js。
 *
 * 真正读写配置文件、会话文件的事情由宿主半（index.js）通过 /dsh-left-sidebar-pro/... 几个网址完成，
 * 这里只负责界面和发请求。
 *
 * ── 为什么侧栏改造用「原生 DOM 注入」而不是座位（slot）注册？ ──
 *   官方左侧栏把「插件 / 自动化任务 / Skill」三行画在它自己的组件里，
 *   没有留出「把它们收进一个分组」的座位。要做出分组的视觉效果，只有两条路：
 *     · 接管整个 sidebar 座位，自己重画一遍（会连带弄坏别的插件往侧栏里注册的东西）；
 *     · 保留官方的那几行，只是把它们藏起来，再在旁边画我们自己的分组。
 *   这里选第二条：官方那三行**仍然留在页面上**（只是看不见），所以点我们的菜单项时，
 *   可以直接调用官方的切换逻辑，行为、快捷键、埋点都和原来一模一样。
 *
 * ── 为什么 MCP 页面用 React，侧栏改造却用原生 DOM？ ──
 *   主面板是官方留好的座位（slot），坐进去最稳；侧栏那几行没有座位，只能自己动手。
 */

window.__ModuleLoader__.load({
  id: '@local/dsh-left-sidebar-pro',
  factory(require) {
    var module = { exports: {} }
    var exports = module.exports

    var React = require('react')
    var h = React.createElement

    //#region 常量

    /** 本插件的语言包命名空间。 */
    var NS = 'sidebarPro'

    /** MCP 管理页在「主面板」里的编号。 */
    var MCP_PANEL_ID = 'sidebar-pro-mcp'

    /** MCP 页在侧栏排序里排第几（官方 插件=0、自动化任务=10、Skill=30）。 */
    var MCP_PANEL_ORDER = 40

    /**
     * 「已归档对话」页在「主面板」里的编号。
     *
     * 注意这个名字：它和侧栏 More 分组里那一行的编号（data-sub="archived"）**故意取成一样**。
     * 因为侧栏那几行的点击就是「按编号切页」，编号一致，点一行就等于切到那一页，
     * 不需要任何特殊照顾。（以前这里是个特例：点它要去点另一个插件画在顶栏的隐藏按钮。）
     */
    var ARCH_PANEL_ID = 'archived'

    /** 「已归档」页在侧栏排序里排第几（排在 MCP 后面）。 */
    var ARCH_PANEL_ORDER = 50

    /** 「已归档」那一段的网址子路径，必须和宿主半 archived-host.js 里的一致。 */
    var ARCH_ROUTE = '/archived'

    /**
     * 我们自己拖拽「工作区」时用的数据类型（MIME）。
     *
     * ── 为什么不能只用 text/plain？（实际使用中「拖不进 Top」的根因）──
     *   官方的对话行**自己也是可拖的**（Rows 里 `draggable = drag !== void 0 && …`），
     *   它的 dragstart 里写着 `dataTransfer.setData('text/plain', node.id)` —— 写的是**对话编号**。
     *   而 React 18+ 把事件委托挂在**根容器**上：同一个 dragstart，我们挂在行上的监听先跑、
     *   React 挂在根上的后跑 —— 于是它把我们写进去的「工作区编号」当场覆盖成「对话编号」。
     *   结果 Top 那边收到的是一串对话编号，查不到对应工作区，就默默不置顶（点了没反应）。
     *   换成一个官方不认识的自定义类型，就没人来覆盖了。
     */
    var DRAG_TYPE = 'application/x-dsp-workspace'

    /** 宿主半的网址前缀，必须和 index.js 里的一致。 */
    var ROUTE = '/dsh-left-sidebar-pro'

    /** 首页注入的口令变量名（宿主半写进去的）。 */
    var GLOBAL_NAME = '__DSH_LEFT_SIDEBAR_PRO__'

    /** 记住「扩展管理」是展开还是收起。 */
    var COLLAPSE_KEY = 'dsh.sidebar-pro.extensions-collapsed'

    //#endregion

    //#region 语言包

    /** 英文文案。 */
    var en = {
      newTask: 'New Chat',
      extensions: 'More',
      expandExtensions: 'Expand More',
      collapseExtensions: 'Collapse More',
      search: 'Search conversations',
      pinned: 'Top',
      unpinBack: 'Move back to Workspaces',
      projects: 'Project',
      sessionsSection: 'Conversations',
      pinAdd: 'Pin a project',
      pinRemove: 'Unpin',
      pinNone: 'No pinned projects yet',
      pinNoneHint: 'Drag here to pin',
      pinAll: 'Every project is already pinned',
      pinPick: 'Choose a project to pin',
      pinExpand: 'Expand this project’s conversations',
      pinCollapse: 'Collapse this project’s conversations',
      expandPinned: 'Expand Pinned',
      collapsePinned: 'Collapse Pinned',
      expandProjects: 'Expand Workspaces',
      collapseProjects: 'Collapse Workspaces',
      dragToPin: 'Drag a workspace here to pin it',
      archived: 'Archived',
      archiveSession: 'Archive conversation',
      // 「取消置顶」这条现在有两种对象：整个项目、单独一条对话。
      // 项目那个沿用 pinRemove（Unpin），对话这里单独给一句更清楚的。
      unpinSession: 'Unpin conversation',
      dragToSort: 'Drag to reorder',
      untitled: 'Untitled',
      noSessions: 'No conversations yet',
      stateRunning: 'Running',
      stateDone: 'Finished, unread',
      stateIdle: 'Idle',
      stateWaitingApproval: 'Waiting for your approval',
      stateWaitingPlan: 'Plan needs your review',
      stateWaitingAnswer: 'Waiting for your answer',
      mcp: 'MCP',
      mcpTitle: 'MCP servers',
      mcpIntro:
        'MCP (Model Context Protocol) lets DSH use tools from outside programs. Each server below is one entry in this profile’s cordis.patch.yml; the tools it provides appear to the Agent as mcp__<name>__<tool>.',
      mcpEmpty: 'No MCP server is configured yet.',
      mcpAdd: 'Add server',
      mcpRefresh: 'Refresh',
      mcpLoading: 'Reading configuration…',
      mcpLoadFailed: 'Could not read the MCP configuration',
      mcpRetry: 'Retry',
      mcpName: 'Name',
      mcpNameHint: 'Letters, digits, underscore and dash, 1–32 characters. Tools show up as mcp__<name>__<tool>.',
      mcpTransport: 'Connection',
      mcpTransportStdio: 'Local program (stdio)',
      mcpTransportHttp: 'Remote address (streamable-http)',
      mcpCommand: 'Program to run',
      mcpCommandHint: 'For example npx, uvx, node, or an absolute path.',
      mcpArgs: 'Arguments',
      mcpArgsHint: 'One argument per line.',
      mcpEnv: 'Environment variables',
      mcpEnvHint: 'One KEY=VALUE per line.',
      mcpUrl: 'Address',
      mcpUrlHint: 'Must start with http:// or https://',
      mcpHeaders: 'Request headers',
      mcpHeadersHint: 'One KEY: VALUE per line.',
      mcpFailFast: 'Refuse to start DSH when this server cannot connect',
      mcpDisabled: 'Disabled (do not load this server)',
      mcpSave: 'Save',
      mcpCancel: 'Cancel',
      mcpEdit: 'Edit',
      mcpRemove: 'Delete',
      mcpRemoveArmed: 'Click again to confirm',
      mcpEnable: 'Enable',
      mcpDisable: 'Disable',
      mcpEnabledTag: 'Enabled',
      mcpDisabledTag: 'Disabled',
      mcpPendingTag: 'Not loaded yet',
      mcpSaved: 'Saved. DSH usually reloads the configuration on its own; restart DSH if it does not.',
      mcpRemoved: 'Deleted.',
      mcpToggled: 'Updated.',
      mcpAdvanced: 'Advanced options',
      mcpWorking: 'Working…',
      mcpWhere: 'Configuration file',
      mcpStdioSummary: 'local program',
      mcpHttpSummary: 'remote address',
    }

    /** 中文文案。 */
    var zh = {
      newTask: 'New Chat',
      extensions: 'More',
      expandExtensions: 'Expand More',
      collapseExtensions: 'Collapse More',
      search: '搜索会话',
      pinned: 'Top',
      unpinBack: '移回工作区（Move back to Workspaces）',
      projects: 'Project',
      sessionsSection: '会话',
      pinAdd: '置顶一个项目',
      pinRemove: '取消置顶',
      pinNone: '还没有置顶的项目',
      pinNoneHint: '拖至此处置顶',
      pinAll: '所有项目都已置顶',
      pinPick: '选择要置顶的项目',
      pinExpand: '展开这个项目的会话',
      pinCollapse: '收起这个项目的会话',
      expandPinned: '展开置顶',
      collapsePinned: '收起置顶',
      expandProjects: '展开工作区',
      collapseProjects: '收起工作区',
      dragToPin: '把工作区拖到这里即可置顶',
      archived: '已归档',
      archiveSession: '归档会话（Archive conversation）',
      unpinSession: '取消置顶对话（Unpin conversation）',
      dragToSort: '按住拖动可调整顺序',
      untitled: '未命名',
      noSessions: '还没有对话',
      stateRunning: '正在运行（Running）',
      stateDone: '已完成未读（Finished, unread）',
      stateIdle: '空闲（Idle）',
      stateWaitingApproval: '等你审批（Waiting for your approval）',
      stateWaitingPlan: '计划待你确认（Plan needs your review）',
      stateWaitingAnswer: '等你回答（Waiting for your answer）',
      mcp: 'MCP',
      mcpTitle: 'MCP 服务器',
      mcpIntro:
        'MCP（Model Context Protocol）让 DSH 能用上别的程序提供的工具。下面每一台服务器，都对应本 profile 的 cordis.patch.yml 里的一条配置；它提供的工具会以 mcp__<名字>__<工具> 的形式出现在智能体手里。',
      mcpEmpty: '还没有配置任何 MCP 服务器。',
      mcpAdd: '新增服务器',
      mcpRefresh: '刷新',
      mcpLoading: '正在读取配置…',
      mcpLoadFailed: '读取 MCP 配置失败',
      mcpRetry: '重试',
      mcpName: '名字',
      mcpNameHint: '只能用英文字母、数字、下划线、减号，1~32 个字符。工具名会变成 mcp__<名字>__<工具>。',
      mcpTransport: '连接方式',
      mcpTransportStdio: '本机程序（stdio）',
      mcpTransportHttp: '远程地址（streamable-http）',
      mcpCommand: '要运行的程序',
      mcpCommandHint: '例如 npx、uvx、node，或者一个完整的路径。',
      mcpArgs: '启动参数',
      mcpArgsHint: '一行一个参数。',
      mcpEnv: '环境变量',
      mcpEnvHint: '一行一个，写成 名字=值。',
      mcpUrl: '网址',
      mcpUrlHint: '必须以 http:// 或 https:// 开头。',
      mcpHeaders: '请求头',
      mcpHeadersHint: '一行一个，写成 名字: 值。',
      mcpFailFast: '连不上时不让 DSH 启动',
      mcpDisabled: '停用（不要加载这台服务器）',
      mcpSave: '保存',
      mcpCancel: '取消',
      mcpEdit: '编辑',
      mcpRemove: '删除',
      mcpRemoveArmed: '再点一次确认删除',
      mcpEnable: '启用',
      mcpDisable: '停用',
      mcpEnabledTag: '已启用',
      mcpDisabledTag: '已停用',
      mcpPendingTag: '尚未加载',
      mcpSaved: '已保存。DSH 一般会自己重新加载配置；如果没有生效，重启一次 DSH。',
      mcpRemoved: '已删除。',
      mcpToggled: '已更新。',
      mcpAdvanced: '高级选项',
      mcpWorking: '处理中…',
      mcpWhere: '配置文件',
      mcpStdioSummary: '本机程序',
      mcpHttpSummary: '远程地址',
    }

    //#endregion

    //#region 图标

    /**
     * 画一个小图标。
     *
     * 为什么自己画而不require官方的图标库？
     *   官方图标库是内部包，手写插件能不能取到没有保证；自己画几个
     *   最省事，而且用的是和官方一样的线条风格（24 格、描边）。
     * @param {string} body 图标的线条内容（SVG 片段）。
     * @param {number} size 边长像素。
     * @returns {object} React 元素。
     */
    function icon(body, size) {
      var edge = size || 16
      return h('svg', {
        width: edge,
        height: edge,
        viewBox: '0 0 24 24',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.7,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        'aria-hidden': 'true',
        focusable: 'false',
        dangerouslySetInnerHTML: { __html: body },
      })
    }

    /** 各图标对应的线条数据。 */
    var ICONS = {
      plus: '<circle cx="12" cy="12" r="9"/><path d="M8 12h8M12 8v8"/>',
      // 「新聊天」用的「方框 + 笔」图标：一个圆角方框，右上角斜插一支笔。
      // 含义是「写一条新消息」，比原来那个「＋」更贴合聊天场景。
      compose:
        '<path d="M12.5 4.5H6.2A2.2 2.2 0 0 0 4 6.7v11.1A2.2 2.2 0 0 0 6.2 20h11.1a2.2 2.2 0 0 0 2.2-2.2v-6.3"/><path d="M17.9 2.9a1.9 1.9 0 0 1 2.7 2.7L12 14.2l-3.4.8.8-3.4z"/>',
      list: '<path d="M9 6h11M9 12h11M9 18h11"/><path d="M4 6h.01M4 12h.01M4 18h.01"/>',
      sparkle:
        '<path d="M12 3.5l1.7 4.3 4.3 1.7-4.3 1.7L12 15.5l-1.7-4.3L6 9.5l4.3-1.7z"/><path d="M18.5 15.5l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z"/>',
      box: '<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M12 12l8-4.5M12 12v9M12 12L4 7.5"/>',
      clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7.5v5l3.2 1.9"/>',
      plug: '<path d="M9 3v5M15 3v5M6.5 8h11v3.5a5.5 5.5 0 01-11 0z"/><path d="M12 17v4"/>',
      search: '<circle cx="11" cy="11" r="7"/><path d="M20.5 20.5L16.6 16.6"/>',
      chevron: '<path d="M9 6l6 6-6 6"/>',
      // 「圆圈里一个叉」—— 用来表示「从置顶移回工作区」。
      // 这个表达方式 macOS 关窗口按钮、iOS 删除项都在用，一眼就懂是「移除」。
      circleX: '<circle cx="12" cy="12" r="9"/><path d="M15 9l-6 6"/><path d="M9 9l6 6"/>',
      trash: '<path d="M4 7h16M9.5 7V4h5v3M6.5 7l1 13h9l1-13"/>',
      pencil: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M14 6l4 4"/>',
      refresh: '<path d="M20 12a8 8 0 1 1-2.3-5.6"/><path d="M20 4v4h-4"/>',
      pin: '<path d="M9.5 3h5l-.7 5.2 2.7 2.7v1.3H7.5v-1.3l2.7-2.7z"/><path d="M12 12.2V21"/>',
      folder: '<path d="M3.5 7.5a1.8 1.8 0 0 1 1.8-1.8h3.3l1.8 1.8h8.3a1.8 1.8 0 0 1 1.8 1.8v7.4a1.8 1.8 0 0 1-1.8 1.8H5.3a1.8 1.8 0 0 1-1.8-1.8z"/>',
      archive: '<rect x="3.5" y="4.5" width="17" height="4" rx="1.2"/><path d="M5.5 8.5v9.3a1.7 1.7 0 0 0 1.7 1.7h9.6a1.7 1.7 0 0 0 1.7-1.7V8.5"/><path d="M10 12.5h4"/>',
      close: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
      // 一个「对话气泡」—— 用来区分「单独置顶的一条对话」和「置顶的整个项目（文件夹）」。
      // 两者都画在 Top 里，光看文字分不出层级，给条对话一个气泡图标就一眼能认。
      chat: '<path d="M20.5 11.7a8.2 8.2 0 0 1-11.9 7.3L3.6 20.4l1.4-4.8A8.2 8.2 0 1 1 20.5 11.7z"/>',
    }

    //#endregion

    //#region 样式

    /**
     * 「已归档对话」整页的样式（dspa = dsh sidebar-pro archived）。
     *
     * 这一页现在是主区域里的整页（不再是顶栏小弹窗），所以整套样式按整页重写：
     * 弹窗那套 fixed 定位、330px 宽度、投影全部去掉，换成和 MCP 页同一套版式
     * （整页留白 + 居中的内容列 + 卡片式列表），看起来才像 DSH 自己的页面。
     *
     * 颜色一律用 DSH 的主题变量（--dsw-...），浅色 / 深色主题都自动跟随。
     */
    var ARCH_CSS = [
      '.dspa-root{height:100%;overflow:auto;padding:24px 28px 48px;color:var(--dsw-alias-label-primary);font-family:var(--dsw-font-family);font-size:14px;line-height:22px}',
      '.dspa-inner{max-width:820px;margin:0 auto}',
      '.dspa-head{display:flex;align-items:flex-start;gap:12px;margin-bottom:6px}',
      '.dspa-h1{flex:1;min-width:0;font-size:20px;font-weight:600;line-height:28px;margin:0}',
      '.dspa-intro{color:var(--dsw-alias-label-secondary);font-size:13px;line-height:20px;margin:0 0 16px}',
      '.dspa-sub{margin-top:4px;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;overflow-wrap:anywhere}',
      '.dspa-bar{display:flex;align-items:center;gap:8px;margin:14px 0}',
      '.dspa-grow{flex:1;min-width:0}',
      '.dspa-btn{box-sizing:border-box;display:inline-flex;align-items:center;gap:6px;height:32px;padding:0 12px;border:.5px solid var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-md);background:0 0;color:var(--dsw-alias-label-primary);font-family:inherit;font-size:13px;line-height:20px;cursor:pointer;white-space:nowrap}',
      '.dspa-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}',
      '.dspa-btn:disabled{opacity:.5;cursor:default}',
      // 「返回列表」是个不那么显眼的动作，去掉边框，别和「打开 / 删除」抢注意力。
      '.dspa-btn[data-kind="back"]{border-color:transparent;padding:0 8px}',
      // 「打开」= 回到对话，用链接色，一眼能认出这是「回去」而不是「删掉」。
      '.dspa-btn[data-kind="open"]{color:var(--dsw-alias-link);border-color:var(--dsw-alias-link)}',
      '.dspa-btn[data-kind="open"]:hover:not(:disabled){background:color-mix(in srgb, var(--dsw-alias-link) 12%, transparent)}',
      '.dspa-btn[data-kind="restore"]{color:var(--dsw-alias-state-business-primary);border-color:var(--dsw-alias-state-business-primary)}',
      '.dspa-btn[data-kind="danger"][data-armed="true"]{color:var(--dsw-alias-state-error-primary);border-color:var(--dsw-alias-state-error-primary)}',
      '.dspa-row{display:flex;align-items:flex-start;gap:10px;box-sizing:border-box;padding:11px 14px;margin-bottom:8px;border:.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-lg);background:var(--dsw-alias-bg-layer-1);cursor:pointer}',
      '.dspa-row:hover{background:var(--dsw-alias-interactive-bg-hover)}',
      '.dspa-row[data-missing="true"]{opacity:.6}',
      // 已标记待删除的行：底色偏红，标题和路径都划掉。
      '.dspa-row[data-pending="true"]{background:color-mix(in srgb, var(--dsw-alias-state-error-primary) 7%, transparent)}',
      '.dspa-row[data-pending="true"] .dspa-title,.dspa-row[data-pending="true"] .dspa-meta{text-decoration:line-through;text-decoration-thickness:1.5px;text-decoration-color:var(--dsw-alias-state-error-primary)}',
      '.dspa-info{flex:1;min-width:0}',
      '.dspa-title{font-weight:510;font-size:14px;line-height:20px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.dspa-meta{margin-top:3px;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;overflow-wrap:anywhere}',
      '.dspa-pending{margin-top:4px;color:var(--dsw-alias-state-error-primary);font-size:12px;line-height:18px}',
      '.dspa-strike{text-decoration:line-through;text-decoration-thickness:1.5px}',
      '.dspa-acts{display:flex;flex:none;flex-wrap:wrap;justify-content:flex-end;gap:6px;max-width:100%}',
      '.dspa-empty{padding:22px 14px;border:.5px dashed var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-lg);color:var(--dsw-alias-label-tertiary);text-align:center}',
      '.dspa-err{margin:8px 0;color:var(--dsw-alias-state-error-primary);font-size:13px;line-height:20px}',
      '.dspa-note{margin-top:22px;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;overflow-wrap:anywhere}',
      '.dspa-msgs{display:flex;flex-direction:column;gap:10px;margin-top:14px}',
      '.dspa-msg{max-width:88%;padding:9px 11px;border-radius:var(--dsw-radius-lg);white-space:pre-wrap;overflow-wrap:anywhere}',
      '.dspa-msg[data-role="user"]{align-self:flex-end;background:var(--dsw-alias-bg-layer-2)}',
      '.dspa-msg[data-role="assistant"]{align-self:flex-start;background:var(--dsw-alias-bg-layer-1);border:.5px solid var(--dsw-alias-border-l2)}',
      '.dspa-role{display:block;margin-bottom:4px;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px}',
      // 底部提示条：删除 / 恢复的结果都在这里报，页面切走了也还看得见。
      '.dspa-toast{position:fixed;left:50%;bottom:28px;transform:translateX(-50%);z-index:60;max-width:70vw;padding:8px 14px;border:.5px solid var(--dsw-alias-settings-card-stroke);border-radius:999px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font-family:var(--dsw-font-family);font-size:12px;line-height:18px;box-shadow:0 8px 28px var(--dsw-alias-bg-mask-drop)}',
    ].join('')

    /**
     * 本插件的样式。
     *
     * 颜色一律用 DSH 的主题变量（--dsw-...），所以浅色 / 深色主题都能自动跟随，
     * 不需要我们自己判断现在是哪种主题。
     */
    var CSS = [
      // ── 侧栏：我们画的那一列 ──
      '.dsp-col{display:flex;flex-direction:column;gap:1px;margin:0 0 10px;flex:none}',
      '.dsp-row{display:flex;align-items:center;gap:10px;width:100%;box-sizing:border-box;height:32px;padding:0 8px;border:none;border-radius:var(--dsw-radius-sm);background:0 0;color:var(--dsw-alias-label-primary);font-family:var(--dsw-font-family);font-size:14px;line-height:22px;text-align:left;cursor:pointer}',
      '.dsp-row:hover{background:var(--dsw-alias-interactive-bg-hover)}',
      '.dsp-row .dsp-ico{flex:none;display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;color:var(--dsw-alias-label-secondary)}',
      '.dsp-row .dsp-label{flex:1;min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}',
      '.dsp-row .dsp-chev{flex:none;display:inline-flex;align-items:center;color:var(--dsw-alias-label-tertiary);transition:transform .18s var(--ds-ease-in-out,cubic-bezier(.4,0,.2,1))}',
      '.dsp-row[aria-expanded="true"] .dsp-chev{transform:rotate(90deg)}',
      // 子项：缩进 + 小一号字，做出「分组里的条目」的层次
      '.dsp-sub{height:30px;padding-left:26px;font-size:13px;color:var(--dsw-alias-label-secondary)}',
      '.dsp-sub:hover{color:var(--dsw-alias-label-primary)}',
      '.dsp-sub[data-active="true"]{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}',
      '.dsp-sub .dsp-ico{width:15px;height:15px}',
      '.dsp-group{display:flex;flex-direction:column;gap:1px;overflow:hidden}',
      // More 分组的收起 / 展开：高度过渡。
      //
      // 为什么用「JS 量高度 + height 过渡」而不是 grid-template-rows？
      // 试过 grid，实测**撑不开**（外高=0）—— 因为父容器是 flex、
      // 自身高度不确定时，grid 的 1fr 算不出具体高度。
      // height 是最直接的：JS 把内容真实高度写成 --dsp-h，样式表用 var() 取值，
      // 收起时归 0，浏览器就能在这两个具体数字之间平滑过渡。
      // More 分组：只留过渡和裁切，高度由 JS 直接设（inline 优先级最高，一定生效）
      //
      // ── 展开 / 收起的手感（设计要求「优化得更顺畅」后调整）──
      // 和以前最大的不同是**展开和收起用两套参数**（以前两边都是 .24s + 同一条 in-out 曲线）：
      //   · 展开用「减速曲线」：起手就有速度、尾巴慢慢贴住 —— 不再有「先愣一下再窜出去」的感觉。
      //   · 收起用「加速曲线」：干脆利落地退场，末尾不会拖一条慢慢缩的尾巴。
      //   · 透明度也分开：展开时慢慢淡入（跟在高度后面一点），
      //     收起时快速淡出（别让人盯着一个已经空了的框慢慢缩完）。
      // 高度仍然由 JS 写 inline style，这套改动只碰「多快、什么曲线、淡入淡出多快」。
      '.dsp-group{overflow:hidden;transition:height var(--dsp-open-dur,.26s) var(--dsp-open-ease,cubic-bezier(.05,.7,.1,1)),opacity var(--dsp-fade-in,.22s) ease-out}',
      '.dsp-group[data-collapsed="true"]{opacity:0;transition:height var(--dsp-close-dur,.2s) var(--dsp-close-ease,cubic-bezier(.3,0,.8,.15)),opacity var(--dsp-fade-out,.12s) ease-in var(--dsp-fade-out-delay,.07s)}',
      // 内容跟着做一点位移 —— 像抽屉滑出来一样。
      // 为什么用 transform 而不是改 padding/margin？transform 不参与布局计算，
      // 不会让邻居抖动，纯观感；而且能吃到显卡合成，动画更稳。
      // （下面这行原本还有一句 flex:none —— 保留着，它是「内容多了不被压扁」的保险。）
      '.dsp-group-inner{display:flex;flex-direction:column;gap:1px;flex:none;transition:transform var(--dsp-open-dur,.26s) var(--dsp-open-ease,cubic-bezier(.05,.7,.1,1))}',
      '.dsp-group[data-collapsed="true"] .dsp-group-inner{transform:translateY(-6px);transition:transform var(--dsp-close-dur,.2s) var(--dsp-close-ease,cubic-bezier(.3,0,.8,.15))}',
      // 这些参数集中放一处方便调（想整体慢一点/快一点，只改这一行）。
      // 每个 var() 使用处都写了「兜底值」：侧栏收成窄条时 [data-dsp] 会摘掉，
      // 没有兜底值的话整条 transition 会失效（宁可退回默认曲线，也不能没动画）。
      '[data-dsp],[data-dsp-rail]{--dsp-open-dur:.26s;--dsp-open-ease:cubic-bezier(.05,.7,.1,1);--dsp-close-dur:.2s;--dsp-close-ease:cubic-bezier(.3,0,.8,.15);--dsp-fade-in:.16s;--dsp-fade-out:.12s;--dsp-fade-out-delay:.07s}',
      // 状态点那个「空闲灰」单独放一个变量，方便一眼找到、一行调深浅。
      //
      // 为什么不用官方那个空闲色（--dsw-alias-state-idle-primary）？
      //   它在浅色主题下是 --dsw-static-neutral-300 = #d4d4d4，是个很浅的灰；
      //   以前我们又把它画成「1.5px 的空心细圈」，在浅色侧栏上几乎看不见
      //   （实际使用中「不够灰、有点看不清」）。
      //   现在改用「说明文字」那一档灰（--dsw-alias-label-caption = #adb2b8），
      //   并且画成实心圆点（官方 StateDot 对这几种状态也都是实心圆）。
      '[data-dsp],[data-dsp-rail]{--dsp-dot-idle:var(--dsw-alias-label-caption)}',


      // ── 侧栏：置顶 / 项目 两个分区 ──
      // 分区标题：小一号、灰色、不可点，只是给下面的内容起个名字
      // 分区标题（置顶 / 工作区）：层级和 New Chat / More 一样（用主文字色），
      // 但字号比它们小一点点，做出「上一级 / 下一级」的层次感。
      // 分区标题（置顶 / 工作区）的字形取值 —— 这组数是照着「中文小字」调出来的：
      //   · 字号 12px：比 New Chat / More（14px）小一档，但中文再小就难认了
      //   · 字重 400：**这是关键**。中文笔画密，小字号再加粗会糊成一团，
      //     所以这里用正常字重，不再用 500
      //   · 颜色：主文字色的 76% 浓度 —— 比主文字淡一档，
      //     又和子项（MCP / 插件）那个中灰不是同一个色，层次分得开
      '.dsp-sect{display:flex;align-items:center;gap:5px;box-sizing:border-box;height:28px;margin:0;padding:0 8px 0 2px;color:var(--dsw-alias-label-secondary);color:color-mix(in srgb,var(--dsw-alias-label-primary) 76%,transparent);font-family:var(--dsw-font-family);font-size:12px;font-weight:400;line-height:18px;flex:none;cursor:pointer;border-radius:var(--dsw-radius-sm);user-select:none}',
      // ── 「Top」这个标题单独调色 / 调字号 ──
      // 设计要求：一眼能看见，但别太违和。
      // 用主题自带的**品牌蓝**——它本来就是强调色，和灰阶区分明显，
      // 又不像纯红纯绿那样扎眼。字号比「工作区」大一档，层级更高。
      '.dsp-sect[data-top="true"]{color:var(--dsw-alias-brand-primary);font-size:13px;font-weight:500}',
      '.dsp-sect[data-top="true"] .dsp-sect-chev{color:var(--dsw-alias-brand-primary)}',
      '.dsp-sect:hover{background:var(--dsw-alias-interactive-bg-hover)}',
      '.dsp-sect-chev{flex:none;display:inline-flex;align-items:center;justify-content:center;width:14px;height:14px;color:var(--dsw-alias-label-tertiary);transition:transform .18s var(--ds-ease-in-out,cubic-bezier(.4,0,.2,1))}',
      '.dsp-sect[data-fold="true"] .dsp-sect-chev{transform:rotate(0deg)}',
      '.dsp-sect[data-fold="false"] .dsp-sect-chev{transform:rotate(90deg)}',
      '.dsp-sect-label{flex:1;min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}',
      '.dsp-sect-act{flex:none;display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;padding:0;border:none;border-radius:var(--dsw-radius-sm);background:0 0;color:var(--dsw-alias-label-tertiary);cursor:pointer}',
      '.dsp-sect-act:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}',
      '.dsp-sect-act[data-on="true"]{color:var(--dsw-alias-label-primary)}',
      // 置顶里的条目：比正式会话行矮一点、字小一点，一眼能看出是「快捷方式」
      '.dsp-pin{display:flex;align-items:center;gap:8px;box-sizing:border-box;width:100%;height:28px;padding:0 8px 0 10px;border:none;border-radius:var(--dsw-radius-sm);background:0 0;color:var(--dsw-alias-label-secondary);font-family:var(--dsw-font-family);font-size:13px;line-height:20px;text-align:left;cursor:pointer}',
      '.dsp-pin:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}',
      '.dsp-pin[draggable="true"]{cursor:grab}',
      '.dsp-pin[data-dragging="true"]{opacity:.45;cursor:grabbing}',
      // 拖动期间把整页锁成「拳头」。
      // 注意：浏览器开始原生拖拽后会自己接管鼠标形状，
      // 有些平台仍会显示系统默认的拖拽光标 —— 那是浏览器行为，网页改不了。
      // 这里能做到的是：只要指针还在页面里，就尽量保持拳头。
      // 拖动期间把光标锁成「握拳」——**只作用在左侧边栏里**。
      //
      // ⚠️ 以前这里是 `html[data-dsp-dragging] *`，作用于**整页**：
      //    一拖动，连右边的对话区、输入框、按钮都变成握拳（右边聊天区不该受影响）。
      //    现在限定在 `[data-slot="sidebar"]` 里面，右边聊天区完全不受影响。
      '[data-dsp-dragging="true"],[data-dsp-dragging="true"] *{cursor:grabbing !important}',
      '.dsp-pin[data-drop="before"]{box-shadow:inset 0 2px 0 0 var(--dsw-alias-state-business-primary)}',
      // More 分组里各项的拖动反馈：正在拖的那项变淡，落点画一条蓝线。
      // 这几条之前漏了 —— 工作区那套有、More 这套没有，所以拖起来「没反应」。
      '.dsp-sub[data-dragging="true"]{opacity:.45}',
      '.dsp-sub[data-drop="before"]{box-shadow:inset 0 2px 0 0 var(--dsw-alias-state-business-primary)}',
      '.dsp-sub[data-drop="after"]{box-shadow:inset 0 -2px 0 0 var(--dsw-alias-state-business-primary)}',
      // ── 拖动时的观感优化 ──
      // 正在拖的那一项：淡下去 + 轻微缩一点，让人知道「它被拿起来了」
      '.dsp-pin[data-dragging="true"],.dsp-row[data-dragging="true"]{opacity:.4;transform:scale(.985);transition:opacity .16s var(--ds-ease-in-out,cubic-bezier(.4,0,.2,1)),transform .16s var(--ds-ease-in-out,cubic-bezier(.4,0,.2,1))}',
      // 可以放的位置：画一条更明显的蓝色落点线（比原来的粗一点、圆头）
      '.dsp-pin[data-drop="before"],.dsp-sub[data-drop="before"]{box-shadow:inset 0 2.5px 0 0 var(--dsw-alias-state-business-primary)}',
      '.dsp-pin[data-drop="after"],.dsp-sub[data-drop="after"]{box-shadow:inset 0 -2.5px 0 0 var(--dsw-alias-state-business-primary)}',
      // 拖拽时整块区域轻微提示（不要闪，用很淡的底色）
      // 注意：这里**不要**给置顶列表加底色。
      // 之前有 `[data-dragging] .dsp-pinlist{background:...}` —— 一开始拖就变灰，
      // 这里不需要（已经有蓝色实线落点线了）。
      // 拖拽时鼠标形状：抓手 / 抓紧
      // 拖动中的行不要有 hover 底色干扰
      '.dsp-pin[data-dragging="true"]:hover{background:transparent}',
      '.dsp-pin[data-drop="after"]{box-shadow:inset 0 -2px 0 0 var(--dsw-alias-state-business-primary)}',
      // 拖东西到置顶区时的「可以放这里」提示。
      // 分两种：列表展开时高亮列表；**收起时列表高度是 0，看不见**，
      // 所以那时改成高亮「置顶」标题行本身（这就是收起时没反馈的原因）。
      // ── 拖东西到 Top 区时的提示框 ──
      // 使用者要「高级一点、融合得进去」，所以：
      //   · 用主题的中性边框色，不用刺眼的品牌蓝
      //   · 1px 细虚线（原来是 1.5px 蓝虚线，太抢眼）
      //   · 配一层极淡的底色，让整块「浮」起来一点
      // 只框住「Top」那一窄栏（标题行），**不要**把下面的项目也框进去 ——
      // 设计要求：往右横着看的那一条亮就行。
      '.dsp-sects[data-over="true"] > .dsp-sect{background:var(--dsw-alias-bg-layer-2);border-radius:var(--dsw-radius-md);outline:1px dashed var(--dsw-alias-border-l2);outline-offset:-1px}',
      // ── Project 那边的「白光」（设计要求：和 Top 一样，范围大小也一致）──
      // Top 的白光只罩住「Top」那一行标题（高度 28px、整条侧栏宽）；
      // Project 这边就照同一套来 —— 罩住官方那一行「Project」标题（sectionHeader 也是 28px 高、同样宽度），
      // 用的底色 / 圆角 / 虚线边框和偏移量都和 Top 那条**逐字一致**。
      // 什么时候亮：拖东西经过工作区那一块时（见 outOver 里的说明）。
      // 白光画在 ::before 上，而不是直接用它自己的背景 + 边框 —— 原因是实测出来的：
      // 官方那一行标题带 `margin-right:-4px`，比正文列**再往右探 4 像素**（贴着滚动条）。
      // 直接拿它的盒子画，白光就会比 Top 那条宽 4 像素、右边多出一截。
      // 这里在 ::before 上写 left:0;right:4px，正好把多出来的收回去，
      // 加上 top/bottom 撑满，盒子就是 293×28 —— 和 Top 白光**像素级一致**。
      // z-index:-1 是必须的：不然这层底色会画在「Project」几个字和右边按钮**上面**，
      // 把字挡住。（父元素写 position:relative;z-index:0 是为了给它一个层叠上下文，
      // 让 -1 只退到文字后面，而不是退到整块侧栏背景后面。）
      '[data-dsp-in="true"] [class*="sectionHeader"]{position:relative;z-index:0}',
      '[data-dsp-in="true"] [class*="sectionHeader"]::before{content:"";position:absolute;left:0;right:4px;top:0;bottom:0;z-index:-1;pointer-events:none;background:var(--dsw-alias-bg-layer-2);border-radius:var(--dsw-radius-md);outline:1px dashed var(--dsw-alias-border-l2);outline-offset:-1px}',
      // 拖东西到 Top 区时**不加任何底色 / 框** ——
      // 已经有蓝色实线落点线了，这个灰底是多余的。
      // （这条规则保留成空壳，是为了以后想加提示时有地方写。）
      // 把置顶项往外拖时，置顶区变淡，暗示「松手就取消置顶」
      // 从置顶往工作区拖时：整个置顶区变淡（表示「要离开这里」）
      // 从 Top 往工作区拖时：整个置顶区变淡（表示「要离开这里」）
      '.dsp-sects[data-out="true"]{opacity:.45}',
      // 工作区那一块：同样不加任何底色（理由同上）
      // 工作区那边画一条蓝线，明确告诉使用者「松手会落在这里」
      // 我们自己的落点线：**画在行内部**的纯横线（不是 Y 字）。
      // [data-row-key] 通配 → 项目行和对话行都能用（拖项目、拖对话都画这条）。
      '[data-row-key][data-out-drop="before"]{box-shadow:inset 0 2.5px 0 0 var(--dsw-alias-state-business-primary)}',
      '[data-row-key][data-out-drop="after"]{box-shadow:inset 0 -2.5px 0 0 var(--dsw-alias-state-business-primary)}',
      // Top 那一栏的行是我们自己画的，没有 data-row-key，
      // 所以落点线要单独写一份（两栏的手感必须一致）。
      '.dsp-sess[data-out-drop="before"],.dsp-pin[data-out-drop="before"]{box-shadow:inset 0 2.5px 0 0 var(--dsw-alias-state-business-primary)}',
      '.dsp-sess[data-out-drop="after"],.dsp-pin[data-out-drop="after"]{box-shadow:inset 0 -2.5px 0 0 var(--dsw-alias-state-business-primary)}',
      // ── Project 这一栏：官方那条 Y 字线**全部关掉**，只留我们自己画的那条 ──
      //
      // 官方在 Project 里一共有三种落点线，全部在这里关掉（选择器都带 [class*="listArea"]，
      // 所以只作用于下面那一栏；Top / More 不受影响）：
      //   ① 项目块：workspaceDropBefore / workspaceDropAfter
      //   ② 对话行：dropBefore / dropAfter（同一项目下不同对话之间那条）
      //   ③ 拖到列表最顶：listTopDropIndicator
      // ⚠️ 官方这三种落点线**全部关掉** —— 它们都是「Y 字形」（三层 background 画的
      //    两个斜角 + 一条横线）。这里**不要 Y 字线**。
      //    我们统一用自己那条纯横线（box-shadow），拖项目和拖对话都画它。
      '[data-dsp] [class*="listArea"] [class*="workspaceDropBefore"]::before,[data-dsp] [class*="listArea"] [class*="workspaceDropAfter"]::after{display:none !important}',
      '[data-dsp] [class*="listArea"] [class*="dropBefore"]::before,[data-dsp] [class*="listArea"] [class*="dropAfter"]::after{display:none !important}',
      '[data-dsp] [class*="listArea"] [class*="listTopDropIndicator"]{display:none !important}',
      '.dsp-pin[data-active="true"]{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}',
      // ── 「在哪边点的，高亮就留在哪边」──
      // 官方的选中底色是跟着「当前打开的是哪个对话」走的。使用者如果是在 **Top** 里点开
      // 那个对话的，底色却跑到 Project 列表里去了，看着就像点错了地方。
      // 所以：从 Top 点开时，给侧栏根节点打 data-dsp-seltop="true"，把官方那一行的底色压掉，
      // 改在 Top 里那一行上显示（.dsp-sess[data-active="true"]）。
      // 只压「选中」这一个属性（官方选中就只改了 background），鼠标划过该有的反馈不动。
      '[data-dsp-seltop="true"] [data-row-key^="session:"][aria-selected="true"]{background:transparent}',
      '.dsp-pin .dsp-ico{flex:none;display:inline-flex;align-items:center;justify-content:center;width:14px;height:14px;color:var(--dsw-alias-label-tertiary)}',
      '.dsp-pin .dsp-label{flex:1;min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}',
      // 空状态提示：只有一行小灰字，不抢注意力
      '.dsp-empty{padding:2px 10px 6px;color:var(--dsw-alias-label-tertiary);font-family:var(--dsw-font-family);font-size:12px;line-height:18px}',
      // ── 藏起官方那两处（有我们自己的菜单时才藏）──
      // 用「侧栏上的标记 + 样式表」来藏，而不是直接改官方元素的 inline style：
      // 官方那两个元素本来就有 display:flex，一旦被我们写成 none，收起成窄条时
      // 就恢复不成图标了。样式表的好处是「标记一去掉，官方原样回来」。
      '[data-dsp-ownmenu] [class*="panelList"],[data-dsp-ownmenu] [class*="newSession"]{display:none}',
      // 置顶 / 项目 这两栏的整体容器
      '.dsp-sects{display:flex;flex-direction:column;gap:1px;flex:none}',
      // 分区收起 / 展开时，列表高度平滑变化（而不是「啪」地消失）
      // 置顶列表：同样用「JS 量高度 + height 过渡」
      // 置顶列表：同上，高度由 JS 直接设
      // 置顶栏：像抽屉一样「从上往下滑」——
      // 高度变化的同时，内容也轻微下移/上移，比单纯变高更有「滑出来」的感觉。
      // Top 整栏的展开 / 收起。
      //
      // 设计要求「Top 的动画也改一下」之后，换成和 More / Project 同一套参数：
      // 展开用减速曲线、收起用加速曲线、淡入淡出分开时序（参数定义见上面 --dsp-open-dur 那一行）。
      //
      // 为什么过渡要挂在 [data-dsp-anim="true"] 上？
      //   页面刚加载时 Top 是收起的话，插件要先把高度量出来再收到 0 ——
      //   如果这时过渡是开着的，使用者会看到「Top 先滑开一下再收回去」。
      //   所以只有**使用者自己点过** Top 标题之后（那一下才打上 data-dsp-anim），才开始做动画。
      '.dsp-pinlist{overflow:hidden}',
      '[data-dsp-anim="true"].dsp-pinlist{transition:height var(--dsp-open-dur,.26s) var(--dsp-open-ease,cubic-bezier(.05,.7,.1,1)),opacity var(--dsp-fade-in,.16s) ease-out}',
      '.dsp-pinlist[data-folded="true"]{opacity:0}',
      '[data-dsp-anim="true"].dsp-pinlist[data-folded="true"]{transition:height var(--dsp-close-dur,.2s) var(--dsp-close-ease,cubic-bezier(.3,0,.8,.15)),opacity var(--dsp-fade-out,.12s) ease-in var(--dsp-fade-out-delay,.07s)}',
      '.dsp-pinlist-inner{transition:transform var(--dsp-open-dur,.26s) var(--dsp-open-ease,cubic-bezier(.05,.7,.1,1))}',
      '.dsp-pinlist[data-folded="true"] .dsp-pinlist-inner{transform:translateY(-6px);transition:transform var(--dsp-close-dur,.2s) var(--dsp-close-ease,cubic-bezier(.3,0,.8,.15))}',
      // flex:none：父容器是 flex，不加的话内容多了会被压扁（同类 bug 踩过三次）
      '.dsp-pinlist-inner{display:flex;flex-direction:column;gap:1px;flex:none}',
      // ── 置顶 / 工作区里那个「文件夹 + 可展开的对话」 ──
      '.dsp-pinwrap{display:flex;flex-direction:column;gap:1px}',
      // 文件夹那一行左边的小三角：收起朝右、展开朝下
      '.dsp-pin-chev{flex:none;display:inline-flex;align-items:center;justify-content:center;width:12px;height:12px;color:var(--dsw-alias-label-tertiary);transition:transform .18s var(--ds-ease-in-out,cubic-bezier(.4,0,.2,1))}',
      '.dsp-pin[data-expanded="false"] .dsp-pin-chev{transform:rotate(0deg)}',
      '.dsp-pin[data-expanded="true"] .dsp-pin-chev{transform:rotate(90deg)}',
      // 置顶项右边那个「移回工作区」按钮：平时淡一点，鼠标划过才明显
      '.dsp-pin-back{flex:none;display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;padding:0;border:none;border-radius:var(--dsw-radius-sm);background:0 0;color:var(--dsw-alias-label-tertiary);cursor:pointer;opacity:0;transition:opacity .16s var(--ds-ease-in-out,cubic-bezier(.4,0,.2,1)),background-color .16s var(--ds-ease-in-out,cubic-bezier(.4,0,.2,1)),color .16s var(--ds-ease-in-out,cubic-bezier(.4,0,.2,1))}',
      '.dsp-pin:hover .dsp-pin-back{opacity:1}',
      // 鼠标划过时变红 —— 红色是「移除」的通用信号，一眼就懂
      '.dsp-pin-back:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-state-error-primary)}',
      // 有按钮的时候，条数让它一点位置（按钮在条数右边）
      '.dsp-pin-back:focus-visible{opacity:1;outline:1.5px solid var(--dsw-alias-state-business-primary);outline-offset:-1px}',
      // 展开出来的对话清单：默认收起（高度 0），展开时用高度过渡平滑撑开
      // flex:none 是关键 —— list 的父元素是 flex 容器，
      // 不加的话 flex-shrink 会把它压扁，我们设的 height 就失效了（对话会消失）。
      '.dsp-sesslist{display:flex;flex-direction:column;gap:1px;flex:none;overflow:hidden;opacity:0;transition:height var(--dsp-open-dur,.26s) var(--dsp-open-ease,cubic-bezier(.05,.7,.1,1)),opacity var(--dsp-fade-in,.16s) ease-out}',
      // 收起时同样「先让卷起来被看见、最后才淡掉」
      '.dsp-pinwrap[data-expanded="false"] .dsp-sesslist{transition:height var(--dsp-close-dur,.2s) var(--dsp-close-ease,cubic-bezier(.3,0,.8,.15)),opacity var(--dsp-fade-out,.12s) ease-in var(--dsp-fade-out-delay,.07s)}',
      // 展开时的不透明度由 data-expanded 控制；高度由 JS 直接设（见 workspaceRow）
      // 内层：装真正的会话行。
      // flex:none 是关键 —— 它是 list（flex 容器）的子项，
      // 不加的话 flex-shrink 会把它压扁，会话行被裁掉（看不见也点不到）。
      '.dsp-sesslist-inner{display:flex;flex-direction:column;gap:1px;flex:none;transition:transform var(--dsp-open-dur,.26s) var(--dsp-open-ease,cubic-bezier(.05,.7,.1,1))}',
      '.dsp-pinwrap[data-expanded="true"] .dsp-sesslist{opacity:1}',
      // 抽屉位移：收起时对话整体往上收 5px（transform 不占布局，纯观感）
      '.dsp-pinwrap[data-expanded="true"] .dsp-sesslist-inner{transform:none}',
      '.dsp-pinwrap[data-expanded="false"] .dsp-sesslist-inner{transform:translateY(-5px);transition:transform var(--dsp-close-dur,.2s) var(--dsp-close-ease,cubic-bezier(.3,0,.8,.15))}',
      // 一条对话：小圆点 + 标题，缩进对齐
      // ── 光标形态：按「能不能展开」区分，而不是按类名一刀切 ──
      //   能展开 / 能拖动的 → 手掌（grab），按住时握拳（grabbing）
      //   只能点击的        → 手指（pointer）
      // 这样 More 标题（可展开）是手掌，MCP / 已归档（只能点）是手指，
      // 和 Top / 工作区的手感一致。
      '[data-foldable="true"]{cursor:grab}',
      '[data-foldable="true"]:active{cursor:grabbing}',
      // 只能点击的：手指
      // More 里的子项（技能 / 插件 / …）是纯点击，不能拖 → 手指。
      // 项目行里「不能折」的那种（默认工作区）也是纯点击 → 手指。
      '.dsp-sub,.dsp-row[data-foldable="false"]{cursor:pointer}',
      // ── 对话行 = 手掌 ──
      //
      // TOP 和 Project 两栏里的对话行也用「手掌」。
      // 之前对话行是「手指」，因为当时觉得它不能展开；但对话**能拖**（能拿起来），
      // 所以它和项目行一样该是手掌：平时张开、按住握拳。
      // 手掌写在下面 .dsp-sess 那条主规则里（这里只补「按住握拳」）。
      '.dsp-sess:active{cursor:grabbing}',
      // 拖动进行中，整页都握拳（覆盖上面所有规则）
      // ── 会话行（Top 里面项目下的对话）的左缩进 ──
      //
      // 对齐要求（按实际像素量的，不是估的）：
      //   ① 状态点（灰/黄/蓝/绿那个小圆点）要和**上面那行文件夹图标的中心**对齐；
      //   ② 对话名字要和**上面项目名的开头**对齐。
      //
      // 项目行 `.dsp-pin` 那串是：左内边距 10 + 小三角 12 + 间距 8 + 文件夹图标 14 + 间距 8
      //   → 项目名从 10+12+8+14+8 = **52px** 开始
      //   → 文件夹图标中心在 10+12+8+7 = **37px**
      // 所以会话行取：左内边距 34 + 点 6 + 间距 12
      //   → 点名从 34 开始、中心在 34+3 = **37px** ✓（和文件夹图标同心）
      //   → 名字从 34+6+12 = **52px** 开始 ✓（和项目名同一条竖线）
      //
      // 为什么点的左边距是 34 而不是 30（图标左边缘）？因为点只有 6px、图标 14px，
      // 两个宽度不一样的东西「对齐」看的是**中心**：按左边缘对反而会偏左 4px。
      // 四种颜色共用这一个定位，所以黄/蓝/绿/灰都在同一条竖线上。
      '.dsp-sess{display:flex;align-items:center;gap:12px;box-sizing:border-box;height:26px;padding:0 8px 0 34px;border-radius:var(--dsw-radius-sm);color:var(--dsw-alias-label-secondary);font-family:var(--dsw-font-family);font-size:12px;line-height:18px;cursor:grab}',
      '.dsp-sess:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}',
      // 选中的那一行：和「鼠标划过」同一种灰底 —— 官方的选中样式就是这一条，保持一致。
      // 什么时候用：使用者是**在 Top 里点的**这条对话（见 4e：在哪边点，高亮就留在哪边）。
      '.dsp-sess[data-active="true"]{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}',
      // 对话行右边的「归档」小按钮：平时藏着，鼠标划到这一行才显形 ——
      // 和官方 Project 列表里的表现一致（官方也是 hover 才出来）。
      // 尺寸、内边距、圆角都对齐 Top 项目行右边那个「移回工作区（叉）」按钮（.dsp-pin-back）：
      // 两个按钮都是 20×20、图标 14px，而且两行的右内边距都是 8px ——
      // 所以它们在侧栏右侧是对得齐的（设计要求：对齐、大小一致）。
      '.dsp-sess-arch{flex:none;display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;padding:0;border:none;border-radius:var(--dsw-radius-sm);background:0 0;color:var(--dsw-alias-label-tertiary);cursor:pointer;opacity:0;transition:opacity .16s var(--ds-ease-in-out,cubic-bezier(.4,0,.2,1)),background-color .16s var(--ds-ease-in-out,cubic-bezier(.4,0,.2,1)),color .16s var(--ds-ease-in-out,cubic-bezier(.4,0,.2,1))}',
      '.dsp-sess:hover .dsp-sess-arch{opacity:1}',
      '.dsp-sess-arch:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}',
      '.dsp-sess-arch:focus-visible{opacity:1;outline:1.5px solid var(--dsw-alias-state-business-primary);outline-offset:-1px}',
      // 状态点：颜色跟官方那套语义对齐
      //   黄 = 有弹窗在等你（审批 / 计划待审 / 等你回答）
      //   蓝 = 正在跑
      //   绿 = 跑完了、你还没看
      //   （空闲 = **不显示点**，见下面那条）
      //
      // ⚠️ 三种亮着的状态**都是实心圆点**，一个都不能画成空心圈。
      //    以前空闲那个是「1.5px 的空心细圈 + 官方那档很浅的灰(#d4d4d4)」，
      //    在浅色侧栏上几乎看不见 —— 实际使用中「不够灰、有点看不清」。
      //    官方 StateDot 对这几种状态也都是实心圆（10px 槽位里画 6px 实心圆）。
      '.dsp-sess-dot{flex:none;width:6px;height:6px;border-radius:50%;background:var(--dsp-dot-idle,var(--dsw-alias-label-caption))}',
      '.dsp-sess-dot[data-state="ongoing"]{background:var(--dsw-alias-state-business-primary);animation:dsp-pulse 1.4s var(--ds-ease-in-out,cubic-bezier(.4,0,.2,1)) infinite}',
      '.dsp-sess-dot[data-state="done"]{background:var(--dsw-alias-state-success-primary)}',
      // 黄点：「有个弹窗在等你」（审批 / 计划待审 / 等你回答）。
      // 官方也是黄的（sessionStatuses() 里这三种情况都返回 state:'warning'），
      // 而且优先级最高 —— 那时候对话可能还在跑，但真正要你动手的是那个弹窗。
      '.dsp-sess-dot[data-state="warning"]{background:var(--dsw-alias-state-warn-primary)}',
      // 空闲（已读、也没什么事在等）→ **不显示点**（是完全没有点，不是灰点）。
      //
      // ⚠️ 为什么用 visibility:hidden 而不是 display:none / 真的不建这个元素？
      //    因为它是那 6px 的**占位**：删掉的话名字会往左跑 18px，就和上面项目名对不齐了
      //    （4i.7 那条对齐就是这么算出来的）。visibility:hidden 既不显示、
      //    又照样占着这 6px，顺便还让它不再弹悬停提示。
      '.dsp-sess-dot[data-state="idle"]{visibility:hidden}',
      // 正在跑的时候轻微呼吸一下，一眼能看出「它在动」
      '@keyframes dsp-pulse{0%,100%{opacity:1}50%{opacity:.45}}',
      '.dsp-sess-title{flex:1;min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}',
      '.dsp-sess-none{padding:2px 8px 6px 24px;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px}',
      // ── Top 里「单独置顶的一条对话」──
      // 它排在所有置顶项目**上面**（见 paintSections 里的顺序说明），
      // 左边缘和项目行对齐（10px），不像文件夹里的对话那样缩进 34px ——
      // 这样一眼就能看出：它是 Top 里独立的一项，不是某个文件夹的子项。
      '.dsp-pinsess{padding:0 8px 0 10px;gap:8px}',
      // 气泡图标：和项目行的文件夹图标一样大（14px），颜色比文字淡一档
      '.dsp-pinsess-ico{flex:none;display:inline-flex;align-items:center;justify-content:center;width:14px;height:14px;color:var(--dsw-alias-label-tertiary)}',
      // 鼠标划到这一行时，右上角的「取消置顶（叉）」才显形 ——
      // 和项目行那个叉的行为完全一致。
      '.dsp-sess:hover .dsp-pin-back{opacity:1}',
      // 鼠标悬停 / 拖动时，行本身的小动效也柔和一点
      '.dsp-row,.dsp-sub,.dsp-pin{transition:background-color .16s var(--ds-ease-in-out,cubic-bezier(.4,0,.2,1)),color .16s var(--ds-ease-in-out,cubic-bezier(.4,0,.2,1)),opacity .16s var(--ds-ease-in-out,cubic-bezier(.4,0,.2,1))}',
      '.dsp-pinlist,.dsp-picker{display:flex;flex-direction:column;gap:1px}',
      // 窄条（收起）状态下这两栏放不下，整个藏掉
      '[data-dsp-rail] .dsp-sects{display:none}',
      // 项目分区：官方那一行的左边写着「工作区」三个字，右边是「视图选项」「添加项目」
      // 两个按钮。我们想把「工作区」改叫「项目」，但**绝不能去搬动这一行**——
      // 试过用负边距把它往上提，结果它被滚动区裁掉，按钮直接消失了。
      // 现在改用最温和的办法：文字不删、位置不动，只是把它「隐身」，
      // 再用 ::before 在同一位置写出「项目」两个字。
      //
      // 还有一个坑：官方那一行是「右对齐」（justify-content:flex-end），
      // 所以标题本来是被挤到右边的。这里让标题吃掉中间的空档（flex:1），
      // 它自然就回到左边、按钮留在右边 —— 和上面「置顶」那一行对齐。
      // 「工作区」这个标题用的是官方那一行，这里只把它的文字换掉。
      // 为了让它和「置顶」看起来是一套，这里把字号 / 颜色 / 粗细调成一致：
      //   · 颜色用主文字色（和 New Chat / More 同级）
      //   · 字号 12px（比 New Chat / More 的 14px 小一点点）
      // 这个标题点了会收起 / 展开 → 手掌（之前写死成 pointer=手指，实际表现不对）
      // 这个标题点了会收起 / 展开 → 手掌。
      // 加 !important：官方那条 [class*="sectionLabel"] 里也有 cursor，
      // 同权重时顺序说了算，加 !important 才稳。
      // ── 兜底：整个侧栏的默认光标 = 手指 ──
      //
      // 手掌和手指切换时仍会闪出鼠标光标。
      // 真正的原因不是哪条规则写错，而是**行与行之间、行与它所属的外壳之间有空隙**
      // （1~8px），那些空隙不属于任何一行，鼠标滑过去没有任何规则命中，
      // 就掉回系统默认箭头 —— 于是手掌 ↔ 手指 的每一次切换都会闪一下箭头。
      //
      // 之前只在 listArea 上兜底，但对话行外面还套着分组外壳，外壳的缝照样漏。
      // 现在把兜底提到**侧栏最外层**：光标是「可继承」的属性，
      // 子孙只要自己没有规则，就会一路继承成「手指」，任何缝里都不会再冒箭头。
      // 权重故意写到最低（只有 [data-dsp] 这一层），
      // 下面「手掌 / 手指 / 握拳」那些规则权重都比它高，照样盖得住。
      '[data-dsp]{cursor:pointer}',
      // 输入框例外：搜索框里要显示「文字光标」（I 形），不能被兜底改成手指。
      '[data-dsp] input,[data-dsp] textarea,[data-dsp] [contenteditable="true"]{cursor:auto}',
      // ── Project 那一栏：缝隙里也用「手掌」，不要手指 ──
      //
      // 从 Project 的默认工作区往下方对话移动时，中间会露出手指；两个项目之间也会。
      // 不需要在界面上做「手指」的过渡效果，直接用「手掌」状态即可。
      //
      // 「中间会露出手指」的位置是哪？不是行本身，而是**行与行之间的缝**：
      //   · 同一个项目里，项目行和它下面第一条对话之间（2px）
      //   · 两个项目之间（4px）
      // 这些缝隙不属于任何一行，落在外层的容器上，而外层容器继承的是
      // 侧栏那一层的兜底「手指」—— 于是手掌 → 手指 → 手掌，中间闪一下。
      //
      // 改法：把 Project 这一整块（官方叫 regionArea）的默认光标也设成手掌。
      // 光标是可继承的，块里面任何没有单独规则的缝隙都会跟着是手掌。
      // 行自己有规则（项目行 / 对话行都是 grab），按钮有自己的 pointer，
      // 所以这条只影响「缝」，不会改掉任何行和按钮。
      '[data-dsp] [class*="regionArea"]{cursor:grab}',
      '[data-dsp] [class*="sectionLabel"]{font-size:0;letter-spacing:0;flex:1;max-width:none;cursor:grab !important;user-select:none}',
      // 官方那些行（工作区 / 对话）都能拖到 Top —— 能「拿起来」就用「手掌」，
      // 按住时握拳。这样和置顶区里的行手感一致。
      // ── 兜底：侧栏里「装行的容器」本身也给一个光标 ──
      //
      // 为什么要这条？因为手掌和手指切换时仍会闪出鼠标光标。
      // 原因不是规则写错，而是**行与行之间那几像素空隙不属于任何一行** ——
      // 鼠标滑过缝隙时没有规则命中，就掉回默认箭头（闪一下）。
      // 这里给容器一个默认「手指」，缝隙里也不会掉成箭头；行自己再各自覆盖成手掌/手指。
      // 只给**容器**兜底，不动子孙（子孙的光标由各自的规则决定，避免权重打架）。
      // 缝隙里显示「手指」而不是默认箭头 —— 就是使用者看到"闪一下箭头"的那个东西。
      '[data-dsp] [data-row-key^="workspace:"]{cursor:grab}',
      '[data-dsp] [data-row-key^="workspace:"]:active{cursor:grabbing}',
      // ── 对话行 = 手掌（后来调整）──
      //
      // TOP 和 Project 两栏里的对话行也用「手掌」：
      // 正常状态下像鼠标放上去一样显示为手掌，捏合点击或长按时变成拳头。
      //
      // 历史：一开始因为「对话不能展开」写成了 pointer；后来发现对话**能拖**，
      //       能拿起来的东西就该是手掌，按住握拳。所以现在改成 grab。
      // 下面 :active 那条负责「按住 = 拳头」；
      // 长按还没开始拖的那一瞬间也由 JS 打的 data-pressing 顶住（见文件末尾）。
      '[data-dsp] [data-row-key^="session:"]{cursor:grab}',
      '[data-dsp] [data-row-key^="session:"]:active{cursor:grabbing}',
      // 「工作区」这个标题：文字部分由 JS 插进去（因为要配一个真 SVG 三角，
      // ::before 里塞不了 SVG）。
      // 标题行高度对齐 Top 的 28px（官方原本是 36px + 4px 下边距，
      // 比 Top 高出 12px，看着就是「空位太大」）。
      // 光标要加在**整行**上，不能只加在文字上 ——
      // 文字只有 18px 高，在 28px 的行里上下各留 5px 空隙，
      // 鼠标经过那 5px 会闪成默认箭头（实际表现是「中间会漏一个鼠标出来」）。
      '[data-dsp] [class*="sectionHeader"]{height:28px;margin-bottom:0;padding-left:0;cursor:grab}',
      // ── 「按下即握拳」：不依赖 :active 的时序 ──
      //
      // 为什么要多这一条？因为手掌和鼠标过渡时会闪出鼠标光标。
      // 原因是：手掌靠 cursor:grab、握拳靠 :active{cursor:grabbing}，
      // 浏览器从「没按下」到「按下」有一瞬间 :active 还没生效 → 掉回默认箭头（闪一下）。
      // 现在按下那一刻由 JS 打一个 data-pressing 属性，光标立刻是握拳，中间不留空档。
      '[data-dsp] [data-pressing="true"]{cursor:grabbing !important}',
      '[data-dsp] [data-pressing="true"] *{cursor:grabbing !important}',
      // 按住时要「握拳」。
      //
      // ⚠️ 这里必须带 !important —— 上面 cursor:grab 那条带了 !important，
      //    不带的话会被它盖住，按下去还是手掌（「捏合失效」就是这个原因）。
      //    同时写在 sectionHeader 和它的子孙上，因为鼠标可能落在任意一层。
      '[data-dsp] [class*="sectionHeader"]:active,[data-dsp] [class*="sectionHeader"]:active *{cursor:grabbing !important}',
      // 但右边的三个按钮（放大镜 / 视图选项 / 添加工作区）还是要「手指」，
      // 它们是纯点击，不能拖也不能展开。
      '[data-dsp] [class*="sectionHeader"] button,[data-dsp] [class*="sectionHeader"] [role="button"]{cursor:pointer}',

      // 文字用 ::after 画（不是 ::before）——
      // 因为 ::before 永远排在真实子元素前面，那样三角就只能落在文字右边。
      // 用 ::after + 给三角 order:-1，三角才会跑到文字左边，和「置顶」一致。
      '[data-dsp] [class*="sectionLabel"]{display:flex;align-items:center}',
      // 「Project」这几个字：字号 / 颜色 / 粗细**完全对齐 Top**。
      //
      // 为什么写在 ::after 上、还要 !important？
      //   ① 官方的文字（「工作区」）是用 font-size:0 藏起来的（那条规则在上面），
      //      字号只能设在显示文字的 ::after 上，设在外面会把官方文字放出来。
      //   ② 官方 sectionHeader 自带 color（灰）和 14px 字号，会被继承下来，
      //      不加 !important 盖不住（实测过）。
      '[data-dsp] [class*="sectionLabel"]::after{content:var(--dsp-proj-label,"Project");font-size:13px !important;font-weight:500 !important;letter-spacing:0;color:var(--dsw-alias-brand-primary) !important}',
      // 那个小三角：和「置顶」用同一个图标、同一个尺寸、同一个旋转动画
      '.dsp-proj-chev{order:-1;display:inline-flex;align-items:center;justify-content:center;width:14px;height:14px;margin-right:5px;color:var(--dsw-alias-label-tertiary);transition:transform .18s var(--ds-ease-in-out,cubic-bezier(.4,0,.2,1))}',
      '.dsp-proj-chev[data-fold="false"]{transform:rotate(90deg)}',
      '.dsp-proj-chev[data-fold="true"]{transform:rotate(0deg)}',
      // 收起「工作区」时，把下面的会话列表藏起来；标题行留着，放大镜照样能点
      // 工作区下面的会话列表：同样用「真实高度」过渡
      // 工作区下面的会话列表：只留过渡和裁切，**高度由 JS 直接设**。
      // 为什么不用样式表控制高度？试过，实测点了不变（样式优先级打架）。
      // inline 高度优先级最高，一定生效。
      // Project 列表的展开 / 收起：**完全由属性驱动**，JS 不碰 inline style。
      //
      // 过渡属性用 height —— 和 More / Top / 会话列表**保持一致**。
      // （之前这里过渡的是 flex，因为它是弹性子项、height 会被忽略；
      //   但那样动画手感和其他三处不一样，使用者一眼就看出来了。
      //   现在同时过渡 height 和 flex，两边都盖住。）
      // Project 列表的展开 / 收起。
      //
      // 为什么过渡的是 flex 而不是 height？
      //   它是官方元素，父容器是弹性容器（display:flex），
      //   在弹性布局里主轴尺寸由 flex-basis 决定，**height 会被忽略**。
      //   所以这里必须过渡 flex —— 过渡 height 是空转的（起点终点都是 auto）。
      //
      // 时长和缓动和 Top 完全一致：尺寸 .24s、淡入淡出 .16s、同一条官方曲线。
      // Project 列表：**纯 CSS 属性驱动**（JS 只改属性，一个字都不碰样式）。
      //
      // 收起 / 展开靠侧栏根节点上的 data-dsp-projfold 切换：
      //   收起 → flex-basis 归零，高度自然为 0
      //   展开 → 恢复成「自动填满剩余空间」
      //
      // 为什么过渡 flex 而不是 height？它是弹性子项，height 会被忽略。
      //
      // ── 展开 / 收起的手感（设计要求「优化得更顺畅」后调整）──
      // 和 More 用同一套参数（展开减速 .26s / 收起加速 .2s / 淡入淡出分开），
      // 这样侧栏里几处开合看起来才是「一套动作」。
      //
      // 另外给内容加了一点位移和一个 `clip-path`：
      //   · 位移：内容像抽屉一样轻微下滑 / 上收，和 Top、More 的手感对齐。
      //   · clip-path：listArea 自己的 overflow 是官方的 visible —— 光靠它，
      //     展开时内容会「整块先冒出来、只有外面的框在长高」，看起来是啪地出现。
      //     这里用 clip-path 从下往上裁，收起时一点点卷回去、展开时一行行露出来。
      //     为什么不用 overflow？因为 overflow 是官方定的值（可能还要负责滚动），
      //     改它风险大；clip-path 只影响显示区域，不碰 overflow。
      //     展开到位时只把**上边**放开 12px（`inset(-12px 0 0 0)`），其余三边不裁。
      //     ⚠️ 上边为什么必须留出这 12px？因为官方在列表里画「拖拽落点蓝线」时，
      //        那条线是画在行**外面**的（`::before{top:-8px}`，高 12px）。
      //        以前上边是 0，等于把线裁掉一半：
      //        拖到默认工作区上面时，落点蓝线会被上面的东西遮住、显示不全。
      //        留 12px 后线完整可见；而且这 12px 只影响「能不能看见」，
      //        不影响布局和点击（clip-path 不参与排版）。
      '[data-dsp] [class*="listArea"]{min-height:0;cursor:grab;clip-path:inset(-12px 0 0 0);transition:flex var(--dsp-open-dur,.26s) var(--dsp-open-ease,cubic-bezier(.05,.7,.1,1)),opacity var(--dsp-fade-in,.22s) ease-out,clip-path var(--dsp-open-dur,.26s) var(--dsp-open-ease,cubic-bezier(.05,.7,.1,1))}',
      '[data-dsp] [class*="listArea"] > *{transition:transform var(--dsp-open-dur,.26s) var(--dsp-open-ease,cubic-bezier(.05,.7,.1,1))}',
      '[data-dsp-projfold="true"] [class*="listArea"]{flex:0 0 0 !important;min-height:0;overflow:hidden;opacity:0;pointer-events:none;clip-path:inset(0 0 100% 0);transition:flex var(--dsp-close-dur,.2s) var(--dsp-close-ease,cubic-bezier(.3,0,.8,.15)),opacity var(--dsp-fade-out,.12s) ease-in var(--dsp-fade-out-delay,.07s),clip-path var(--dsp-close-dur,.2s) var(--dsp-close-ease,cubic-bezier(.3,0,.8,.15))}',
      '[data-dsp][data-dsp-projfold="true"] [class*="listArea"] > *{transform:translateY(-8px);transition:transform var(--dsp-close-dur,.2s) var(--dsp-close-ease,cubic-bezier(.3,0,.8,.15))}',
      '[data-dsp-projfold="false"] [class*="listArea"]{flex:1 1 0% !important;min-height:0;overflow:visible;opacity:1;pointer-events:auto;clip-path:inset(-12px 0 0 0)}',
      // transform:none 是「不创建包含块」的关键 —— 展开到位后，
      // 列表里如果有弹出菜单，定位基准仍然是整个窗口，不会被我们挪位。
      '[data-dsp][data-dsp-projfold="false"] [class*="listArea"] > *{transform:none}',

      // ── MCP 管理页 ──
      '.dspm-root{height:100%;overflow:auto;padding:24px 28px 48px;color:var(--dsw-alias-label-primary);font-family:var(--dsw-font-family);font-size:14px;line-height:22px}',
      '.dspm-inner{max-width:820px;margin:0 auto}',
      '.dspm-head{display:flex;align-items:flex-start;gap:12px;margin-bottom:6px}',
      '.dspm-h1{flex:1;min-width:0;font-size:20px;font-weight:600;line-height:28px;margin:0}',
      '.dspm-intro{color:var(--dsw-alias-label-secondary);font-size:13px;line-height:20px;margin:0 0 18px}',
      '.dspm-bar{display:flex;align-items:center;gap:8px;margin:14px 0}',
      '.dspm-grow{flex:1;min-width:0}',
      '.dspm-btn{box-sizing:border-box;display:inline-flex;align-items:center;gap:6px;height:32px;padding:0 12px;border:.5px solid var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-md);background:0 0;color:var(--dsw-alias-label-primary);font-family:inherit;font-size:13px;line-height:20px;cursor:pointer;white-space:nowrap}',
      '.dspm-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}',
      '.dspm-btn:disabled{opacity:.5;cursor:default}',
      '.dspm-btn[data-kind="primary"]{background:var(--dsw-alias-button-elevated-fill);border-color:transparent}',
      '.dspm-btn[data-kind="danger"][data-armed="true"]{color:var(--dsw-alias-state-error-primary);border-color:var(--dsw-alias-state-error-primary)}',
      '.dspm-card{border:.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-lg);padding:12px 14px;margin-bottom:10px;background:var(--dsw-alias-bg-layer-1)}',
      '.dspm-card[data-off="true"]{opacity:.62}',
      '.dspm-cardTop{display:flex;align-items:center;gap:8px}',
      '.dspm-name{font-weight:510;font-size:14px}',
      '.dspm-tag{flex:none;padding:1px 7px;border-radius:999px;border:.5px solid var(--dsw-alias-border-l3);color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px}',
      '.dspm-tag[data-on="true"]{color:var(--dsw-alias-state-business-primary);border-color:var(--dsw-alias-state-business-primary)}',
      '.dspm-cmd{margin-top:5px;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;font-family:var(--dsw-font-family-monospace,ui-monospace,SFMono-Regular,Menlo,monospace);overflow-wrap:anywhere}',
      '.dspm-acts{display:flex;gap:6px;margin-top:10px;flex-wrap:wrap}',
      '.dspm-empty{padding:22px 14px;border:.5px dashed var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-lg);color:var(--dsw-alias-label-tertiary);text-align:center}',
      '.dspm-form{border:.5px solid var(--dsw-alias-settings-card-stroke,var(--dsw-alias-border-l2));border-radius:var(--dsw-radius-lg);padding:14px 16px;margin-bottom:12px;background:var(--dsw-alias-bg-layer-2)}',
      '.dspm-field{margin-bottom:12px}',
      '.dspm-label{display:block;font-size:13px;font-weight:510;margin-bottom:4px}',
      '.dspm-hint{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;margin-top:3px}',
      '.dspm-input,.dspm-area,.dspm-select{box-sizing:border-box;width:100%;padding:7px 10px;border:.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-family:inherit;font-size:13px;line-height:20px;outline:none}',
      '.dspm-area{min-height:64px;resize:vertical;font-family:var(--dsw-font-family-monospace,ui-monospace,SFMono-Regular,Menlo,monospace)}',
      '.dspm-input:focus,.dspm-area:focus,.dspm-select:focus{border-color:var(--dsw-alias-brand-primary)}',
      '.dspm-check{display:flex;align-items:center;gap:8px;font-size:13px;margin-bottom:8px;cursor:pointer}',
      '.dspm-error{color:var(--dsw-alias-state-error-primary);font-size:13px;line-height:20px;margin:8px 0}',
      '.dspm-ok{color:var(--dsw-alias-state-business-primary);font-size:13px;line-height:20px;margin:8px 0}',
      '.dspm-note{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;margin-top:22px;overflow-wrap:anywhere}',
      '.dsp-row2{display:flex;gap:10px;align-items:flex-end}',
      '.dsp-row2>*{flex:1;min-width:0}',
      // ── 顶栏合并：让「品牌」和「已归档 / 收起」两组控件落在同一行 ──
      // 官方原本是上下两条：上面一条只放「收起侧栏」按钮（macOS 版才有），
      // 下面一条放品牌名。两条都是右对齐，所以只要把上面那条改成「浮在右上角」，
      // 下面那条就自然升上来，视觉上并成一行。
      // 为什么不用 JS 搬动节点？因为那些节点由 React 管着，搬走之后 React 再想
      // 删它就会找不到、直接报错，整个侧栏会白屏。这里只改样式，节点一个都不动。
      '[data-dsp="merged"]{position:relative}',
      // 合并后的那一行往下挪多少，由 JS 量出来（--dsp-topshift）。
      // 为什么必须往下挪？因为窗口左上角有 macOS 的三个「红绿灯」按钮，
      // 官方原本把品牌名放在它们下面那一行。我们要是直接把品牌提到最顶上，
      // 就会被红绿灯压住（试过，确实糊在一起了）。
      // 所以：上面那条（放按钮的）浮到品牌原来那一行，品牌留在原地不动，
      // 两者就并成了一行，而且都在红绿灯下方。
      '[data-dsp="merged"] [class*="topStrip"]{position:absolute;top:var(--dsp-topshift,46px);right:0;left:auto;width:auto;height:36px;margin:0;padding:0 12px;display:flex;justify-content:flex-end;align-items:center;z-index:3}',
      '[data-dsp="merged"] [class*="logoRow"]{height:36px;margin:var(--dsp-topshift,46px) 0 14px;padding:0 var(--dsp-topgap,92px) 0 4px}',
      // ── 必须给可点元素加 no-drag 豁免（这是「收起按钮点不动」的根因）──
      // macOS 上，官方给顶栏和品牌行都标了 data-window-drag，
      // 对应样式是「-webkit-app-region: drag」，也就是「拖窗口的把手」。
      // 这个区域会**吞掉所有鼠标点击** —— 我们把它浮起来盖到别处之后，
      // 盖住的地方就点不动了（收起按钮、已归档按钮都中招）。
      // 官方给按钮加了 no-drag 豁免，但我们的浮层是新的，得自己加。
      // 顶栏和品牌行：整条都不该再是「拖窗口的把手」。
      //
      // 为什么不用 no-drag 覆盖？因为官方那条规则是
      //   html[data-platform=darwin] [data-window-drag]{-webkit-app-region:drag}
      // 权重 (0,2,1)，我们写的 (0,2,0) —— 比不过，写了也不生效（这就是
      // 「收起按钮点不动」反复修不好的原因）。
      // 所以改成：由 JS 把 data-window-drag 这个属性直接摘掉，
      // 官方的规则选不中它，自然就不是拖拽区了。
      '[data-dsp="merged"] [class*="topStrip"],[data-dsp="merged"] [class*="topStrip"] *,[data-dsp="merged"] [class*="logoRow"],[data-dsp="merged"] [class*="logoRow"] *{-webkit-app-region:no-drag;app-region:no-drag}',
      // 同理：我们插进侧栏的所有东西也都不该是「拖窗口把手」
      '.dsp-col,.dsp-sects,.dsp-row,.dsp-sub,.dsp-pin,.dsp-sect,.dsp-sect-act{-webkit-app-region:no-drag;app-region:no-drag}',
    ].join('') + ARCH_CSS

    //#endregion

    //#region 与宿主半通信

    /** 记着这次运行的口令，避免每次请求都去要一遍。 */
    var cachedToken = null

    /**
     * 取本次运行的口令。
     *
     * 正常情况首页里已经注入好了；万一没有（例如浏览器缓存了旧页面），
     * 就带着 DSH 的登录 Cookie 再要一次 —— 别的程序拿不到这个 Cookie。
     * @returns {Promise<string>} 口令。
     */
    function getToken() {
      if (cachedToken !== null) return Promise.resolve(cachedToken)
      var injected = window[GLOBAL_NAME]
      if (injected && typeof injected.token === 'string' && injected.token.length > 0) {
        cachedToken = injected.token
        return Promise.resolve(cachedToken)
      }
      return fetch(ROUTE + '/handshake', { credentials: 'same-origin' })
        .then(function (res) {
          return res.ok ? res.json() : null
        })
        .then(function (data) {
          cachedToken = data && typeof data.token === 'string' ? data.token : ''
          return cachedToken
        })
        .catch(function () {
          cachedToken = ''
          return cachedToken
        })
    }

    /**
     * 调宿主半的一个接口。
     * @param {string} method 'GET' 或 'POST'。
     * @param {string} path 接口路径（例如 '/mcp/list'）。
     * @param {object} [body] POST 的请求体。
     * @returns {Promise<any>} 宿主半返回的 JSON。
     */
    function call(method, path, body) {
      return getToken().then(function (token) {
        return fetch(ROUTE + path, {
          method: method,
          credentials: 'same-origin',
          headers: {
            'content-type': 'application/json',
            'x-dsh-sidebar-token': token,
          },
          body: body === undefined ? undefined : JSON.stringify(body),
        })
      }).then(function (res) {
        return res.json().catch(function () {
          return {}
        }).then(function (data) {
          if (!res.ok) throw new Error(data && data.error ? data.error : 'HTTP ' + res.status)
          return data
        })
      })
    }

    /**
     * 调「已归档对话」那一段的接口（宿主半把它挂在 /dsh-left-sidebar-pro/archived 下面）。
     *
     * 和 call() 的唯一区别：口令对不上（DSH 重启过、页面开了很久）时自动重新握手再试一次。
     * 为什么它需要重试而 call() 不用？因为这一页常常是「隔了很久才点开」的，
     * 那时口令很可能已经换了；重试一下使用者就完全感觉不到，不然只会看到一句 forbidden。
     * @param {string} method 'GET' 或 'POST'。
     * @param {string} path 接口路径（例如 '/list'）。
     * @param {object} [body] POST 的请求体。
     * @returns {Promise<any>} 宿主半返回的 JSON。
     */
    function callArchived(method, path, body) {
      return call(method, ARCH_ROUTE + path, body).catch(function (error) {
        if (String(error && error.message) !== 'forbidden') throw error
        cachedToken = null
        return call(method, ARCH_ROUTE + path, body)
      })
    }

    //#endregion

    //#region 小工具

    /**
     * 只在文字真的变了时才写进去。
     *
     * 为什么必须这么小心？
     *   我们靠 MutationObserver 盯着页面，而给元素设 textContent 会**替换子节点**，
     *   这本身又算一次 DOM 变动 —— 于是「重绘 → 触发观察器 → 再重绘」会变成
     *   每秒 60 次的死循环，把 CPU 烧满。所以凡是会触发观察器的写操作，
     *   一律先比较再写。
     * @param {Element} node 目标元素。
     * @param {string} text 期望的文字。
     * @returns {void}
     */
    function setText(node, text) {
      if (node !== null && node.textContent !== text) node.textContent = text
    }

    /**
     * 只在属性真的变了时才写进去（理由同 setText）。
     * @param {Element} node 目标元素。
     * @param {string} name 属性名。
     * @param {string} value 期望的值。
     * @returns {void}
     */
    function setAttr(node, name, value) {
      if (node !== null && node.getAttribute(name) !== value) node.setAttribute(name, value)
    }

    /**
     * 把「一个工作区编号」写进拖拽数据里。
     *
     * 写两份：
     *   1. 我们自己的 DRAG_TYPE（官方的对话行不会碰它，所以一定读得回来）；
     *   2. `text/plain`（老路径 / 万一环境不支持自定义类型时的兜底）。
     *
     * ⚠️ 只写 `text/plain` 会被官方的对话行覆盖掉（它写的是对话编号），
     *    实际使用中「拖不进 Top」就是这么来的 —— 详见 DRAG_TYPE 的注释。
     * @param {DataTransfer} transfer 拖拽数据对象。
     * @param {string} workspaceId 工作区编号。
     * @returns {void}
     */
    function setWorkspaceDragPayload(transfer, workspaceId) {
      if (transfer === null || transfer === undefined) return
      try {
        transfer.setData(DRAG_TYPE, workspaceId)
      } catch (error) {
        /* 个别环境不接受自定义类型：下面那条 text/plain 仍然兜底 */
      }
      transfer.setData('text/plain', workspaceId)
    }

    /**
     * 从拖拽数据里读出「被拖的是哪个工作区」。
     *
     * 先读我们自己的 DRAG_TYPE（可靠）；没有（例如老版本页面拖过来的）再退回 `text/plain`。
     * @param {DataTransfer} transfer 拖拽数据对象。
     * @returns {string} 工作区编号；读不到就是空串。
     */
    function readWorkspaceDragPayload(transfer) {
      if (transfer === null || transfer === undefined) return ''
      var value = ''
      try {
        value = transfer.getData(DRAG_TYPE)
      } catch (error) {
        value = ''
      }
      if (typeof value === 'string' && value !== '') return value
      try {
        var fallback = transfer.getData('text/plain')
        return typeof fallback === 'string' ? fallback : ''
      } catch (error) {
        return ''
      }
    }

    /**
     * 给元素绑一个「换实例时会自动换掉」的监听。
     *
     * 为什么不直接在元素上打标记、看到标记就跳过？
     *   因为插件热更新后，标记还在、监听器却是**旧实例**的。
     *   新实例看到标记就跳过绑定，事件就永远没人处理 ——
     *   表现就是「点了没反应」「拖不动」，而且很难查。
     *
     * 这里的做法：把监听函数存在元素自己身上（按 key 区分）。
     * 绑新的之前，先把旧的那个摘掉。这样无论热更新多少次，
     * 真正生效的永远是当前这个实例。
     * @param {HTMLElement} el 目标元素。
     * @param {string} type 事件名（如 'click'）。
     * @param {string} key 用途标识（同一个元素上多种监听要区分开）。
     * @param {Function} handler 处理函数。
     * @returns {void}
     */
    function bindFresh(el, type, key, handler) {
      if (el === null || el === undefined) return
      var storeKey = '__dspBind_' + key
      // 先把上一次（可能是别的实例）绑的摘掉
      var previous = el[storeKey]
      if (previous !== undefined && previous !== null) {
        el.removeEventListener(type, previous)
      }
      el[storeKey] = handler
      el.addEventListener(type, handler)
    }

    /**
     * 只在样式真的变了时才写进去（理由同 setText）。
     * @param {HTMLElement} node 目标元素。
     * @param {string} value 期望的 display 值。
     * @returns {void}
     */
    function setDisplay(node, value) {
      if (node !== null && node.style.display !== value) node.style.display = value
    }

    /**
     * 把「一行一个 KEY=VALUE」的文字解析成对象。
     * @param {string} text 多行文字。
     * @returns {object} 解析结果。
     */
    function parsePairs(text) {
      var out = {}
      String(text || '').split(/\r?\n/).forEach(function (line) {
        var trimmed = line.trim()
        if (trimmed === '' || trimmed.charAt(0) === '#') return
        var at = trimmed.indexOf('=')
        if (at < 0) at = trimmed.indexOf(':')
        if (at < 0) return
        var key = trimmed.slice(0, at).trim()
        var value = trimmed.slice(at + 1).trim()
        if (key !== '') out[key] = value
      })
      return out
    }

    /**
     * 把对象写回「一行一个 KEY=VALUE」的文字。
     * @param {object} dict 对象。
     * @returns {string} 多行文字。
     */
    function formatPairs(dict) {
      if (dict === null || typeof dict !== 'object') return ''
      return Object.keys(dict)
        .map(function (key) {
          return key + '=' + String(dict[key])
        })
        .join('\n')
    }

    /**
     * 把「一行一个参数」的文字解析成数组。
     * @param {string} text 多行文字。
     * @returns {string[]} 参数数组。
     */
    function parseLines(text) {
      return String(text || '')
        .split(/\r?\n/)
        .map(function (line) {
          return line.trim()
        })
        .filter(function (line) {
          return line !== ''
        })
    }

    //#endregion

    //#region MCP 管理页

    /**
     * MCP 管理页。
     *
     * 这一页做四件事：列出现有服务器、新增、修改、停用/删除。
     * 配置改动通过宿主半写进 profile 的补丁文件。
     * @param {object} props 官方给的属性（含 t 和我们的 api）。
     * @returns {object} React 元素。
     */
    function McpPanel(props) {
      var t = props.t

      var stateHook = React.useState({
        phase: 'loading',
        servers: [],
        error: '',
        notice: '',
        patch: '',
      })
      var state = stateHook[0]
      var setState = stateHook[1]

      var draftHook = React.useState(null)
      var draft = draftHook[0]
      var setDraft = draftHook[1]

      var armedHook = React.useState('')
      var armed = armedHook[0]
      var setArmed = armedHook[1]

      var busyHook = React.useState(false)
      var busy = busyHook[0]
      var setBusy = busyHook[1]

      /**
       * 把服务器名单读回来。
       * @returns {void}
       */
      var load = React.useCallback(function () {
        setState(function (prev) {
          return { ...prev, phase: 'loading', error: '' }
        })
        call('GET', '/mcp/list')
          .then(function (data) {
            setState({
              phase: 'ready',
              servers: Array.isArray(data.servers) ? data.servers : [],
              error: '',
              notice: '',
              patch: String(data.patch || ''),
            })
          })
          .catch(function (error) {
            setState({
              phase: 'ready',
              servers: [],
              error: error.message || String(error),
              notice: '',
              patch: '',
            })
          })
      }, [])

      React.useEffect(function () {
        load()
      }, [load])

      /**
       * 提交一次改动（保存 / 删除 / 启停）。
       * @param {string} path 接口路径。
       * @param {object} body 请求体。
       * @param {string} okText 成功后的提示文字。
       * @returns {void}
       */
      var submit = React.useCallback(
        function (path, body, okText) {
          setBusy(true)
          setState(function (prev) {
            return { ...prev, error: '', notice: '' }
          })
          call('POST', path, body)
            .then(function () {
              setBusy(false)
              setDraft(null)
              setArmed('')
              load()
              setState(function (prev) {
                return { ...prev, notice: okText }
              })
            })
            .catch(function (error) {
              setBusy(false)
              setState(function (prev) {
                return { ...prev, error: error.message || String(error) }
              })
            })
        },
        [load],
      )

      /** 打开「新增」表单。 */
      function startAdd() {
        setArmed('')
        setDraft({
          id: '',
          serverName: '',
          transport: 'stdio',
          command: '',
          argsText: '',
          envText: '',
          url: '',
          headersText: '',
          failOnStartupError: false,
          disabled: false,
          isNew: true,
        })
      }

      /**
       * 打开「修改」表单。
       * @param {any} server 要修改的服务器。
       * @returns {void}
       */
      function startEdit(server) {
        setArmed('')
        setDraft({
          id: server.id,
          serverName: server.serverName,
          transport: server.transport === 'streamable-http' ? 'streamable-http' : 'stdio',
          command: server.command || '',
          argsText: (server.args || []).join('\n'),
          envText: formatPairs(server.env),
          url: server.url || '',
          headersText: formatPairs(server.headers),
          failOnStartupError: server.failOnStartupError === true,
          disabled: server.disabled === true,
          isNew: false,
        })
      }

      /** 保存当前表单。 */
      function saveDraft() {
        if (draft === null) return
        var payload = {
          id: draft.id,
          serverName: draft.serverName.trim(),
          transport: draft.transport,
          failOnStartupError: draft.failOnStartupError,
          disabled: draft.disabled,
        }
        if (draft.transport === 'stdio') {
          payload.command = draft.command.trim()
          payload.args = parseLines(draft.argsText)
          payload.env = parsePairs(draft.envText)
        } else {
          payload.url = draft.url.trim()
          payload.headers = parsePairs(draft.headersText)
        }
        submit('/mcp/save', { server: payload }, t('mcpSaved'))
      }

      /**
       * 改一台服务器的字段（表单用）。
       * @param {string} key 字段名。
       * @param {any} value 新值。
       * @returns {void}
       */
      function patchDraft(key, value) {
        setDraft(function (prev) {
          if (prev === null) return prev
          var next = { ...prev }
          next[key] = value
          return next
        })
      }

      // ── 渲染 ──

      var head = h(
        'div',
        { className: 'dspm-head' },
        h('h1', { className: 'dspm-h1' }, t('mcpTitle')),
        h(
          'button',
          {
            type: 'button',
            className: 'dspm-btn',
            onClick: load,
            disabled: busy,
            title: t('mcpRefresh'),
          },
          icon(ICONS.refresh, 14),
          t('mcpRefresh'),
        ),
      )

      var body = []

      if (state.error !== '') {
        body.push(
          h('div', { className: 'dspm-error', key: 'err' }, state.error),
        )
      }
      if (state.notice !== '') {
        body.push(h('div', { className: 'dspm-ok', key: 'ok' }, state.notice))
      }

      if (state.phase === 'loading') {
        body.push(h('div', { className: 'dspm-empty', key: 'loading' }, t('mcpLoading')))
      } else if (state.servers.length === 0 && draft === null) {
        body.push(h('div', { className: 'dspm-empty', key: 'empty' }, t('mcpEmpty')))
      }

      // 服务器卡片
      state.servers.forEach(function (server) {
        var isStdio = server.transport !== 'streamable-http'
        var summary = isStdio
          ? [server.command].concat(server.args || []).join(' ')
          : server.url
        var tagText = server.disabled === true ? t('mcpDisabledTag') : server.loaded === false ? t('mcpPendingTag') : t('mcpEnabledTag')

        body.push(
          h(
            'div',
            { className: 'dspm-card', key: server.id, 'data-off': server.disabled === true ? 'true' : 'false' },
            h(
              'div',
              { className: 'dspm-cardTop' },
              h('span', { className: 'dspm-name' }, server.serverName || server.id),
              h('span', { className: 'dspm-tag', 'data-on': server.disabled === true ? 'false' : 'true' }, tagText),
              h('span', { className: 'dspm-tag' }, isStdio ? t('mcpStdioSummary') : t('mcpHttpSummary')),
            ),
            h('div', { className: 'dspm-cmd' }, summary || '—'),
            h(
              'div',
              { className: 'dspm-acts' },
              h(
                'button',
                { type: 'button', className: 'dspm-btn', disabled: busy, onClick: function () { startEdit(server) } },
                icon(ICONS.pencil, 14),
                t('mcpEdit'),
              ),
              h(
                'button',
                {
                  type: 'button',
                  className: 'dspm-btn',
                  disabled: busy,
                  onClick: function () {
                    submit('/mcp/toggle', { id: server.id, disabled: server.disabled !== true }, t('mcpToggled'))
                  },
                },
                server.disabled === true ? t('mcpEnable') : t('mcpDisable'),
              ),
              h(
                'button',
                {
                  type: 'button',
                  className: 'dspm-btn',
                  'data-kind': 'danger',
                  'data-armed': armed === server.id ? 'true' : 'false',
                  disabled: busy,
                  onClick: function () {
                    if (armed !== server.id) {
                      setArmed(server.id)
                      return
                    }
                    submit('/mcp/remove', { id: server.id }, t('mcpRemoved'))
                  },
                },
                icon(ICONS.trash, 14),
                armed === server.id ? t('mcpRemoveArmed') : t('mcpRemove'),
              ),
            ),
          ),
        )
      })

      // 表单
      if (draft !== null) {
        var isStdioDraft = draft.transport === 'stdio'
        var fields = [
          h(
            'div',
            { className: 'dspm-field', key: 'name' },
            h('label', { className: 'dspm-label' }, t('mcpName')),
            h('input', {
              className: 'dspm-input',
              value: draft.serverName,
              spellCheck: false,
              placeholder: 'demo',
              onChange: function (event) { patchDraft('serverName', event.target.value) },
            }),
            h('div', { className: 'dspm-hint' }, t('mcpNameHint')),
          ),
          h(
            'div',
            { className: 'dspm-field', key: 'transport' },
            h('label', { className: 'dspm-label' }, t('mcpTransport')),
            h(
              'select',
              {
                className: 'dspm-select',
                value: draft.transport,
                onChange: function (event) { patchDraft('transport', event.target.value) },
              },
              h('option', { value: 'stdio' }, t('mcpTransportStdio')),
              h('option', { value: 'streamable-http' }, t('mcpTransportHttp')),
            ),
          ),
        ]

        if (isStdioDraft) {
          fields.push(
            h(
              'div',
              { className: 'dspm-field', key: 'command' },
              h('label', { className: 'dspm-label' }, t('mcpCommand')),
              h('input', {
                className: 'dspm-input',
                value: draft.command,
                spellCheck: false,
                placeholder: 'npx',
                onChange: function (event) { patchDraft('command', event.target.value) },
              }),
              h('div', { className: 'dspm-hint' }, t('mcpCommandHint')),
            ),
            h(
              'div',
              { className: 'dspm-field', key: 'args' },
              h('label', { className: 'dspm-label' }, t('mcpArgs')),
              h('textarea', {
                className: 'dspm-area',
                value: draft.argsText,
                spellCheck: false,
                onChange: function (event) { patchDraft('argsText', event.target.value) },
              }),
              h('div', { className: 'dspm-hint' }, t('mcpArgsHint')),
            ),
            h(
              'div',
              { className: 'dspm-field', key: 'env' },
              h('label', { className: 'dspm-label' }, t('mcpEnv')),
              h('textarea', {
                className: 'dspm-area',
                value: draft.envText,
                spellCheck: false,
                onChange: function (event) { patchDraft('envText', event.target.value) },
              }),
              h('div', { className: 'dspm-hint' }, t('mcpEnvHint')),
            ),
          )
        } else {
          fields.push(
            h(
              'div',
              { className: 'dspm-field', key: 'url' },
              h('label', { className: 'dspm-label' }, t('mcpUrl')),
              h('input', {
                className: 'dspm-input',
                value: draft.url,
                spellCheck: false,
                placeholder: 'http://127.0.0.1:3000/mcp',
                onChange: function (event) { patchDraft('url', event.target.value) },
              }),
              h('div', { className: 'dspm-hint' }, t('mcpUrlHint')),
            ),
            h(
              'div',
              { className: 'dspm-field', key: 'headers' },
              h('label', { className: 'dspm-label' }, t('mcpHeaders')),
              h('textarea', {
                className: 'dspm-area',
                value: draft.headersText,
                spellCheck: false,
                onChange: function (event) { patchDraft('headersText', event.target.value) },
              }),
              h('div', { className: 'dspm-hint' }, t('mcpHeadersHint')),
            ),
          )
        }

        fields.push(
          h('div', { key: 'adv' },
            h(
              'label',
              { className: 'dspm-check' },
              h('input', {
                type: 'checkbox',
                checked: draft.failOnStartupError,
                onChange: function (event) { patchDraft('failOnStartupError', event.target.checked) },
              }),
              t('mcpFailFast'),
            ),
            h(
              'label',
              { className: 'dspm-check' },
              h('input', {
                type: 'checkbox',
                checked: draft.disabled,
                onChange: function (event) { patchDraft('disabled', event.target.checked) },
              }),
              t('mcpDisabled'),
            ),
          ),
        )

        body.push(
          h(
            'div',
            { className: 'dspm-form', key: 'form' },
            fields,
            h(
              'div',
              { className: 'dspm-acts' },
              h(
                'button',
                { type: 'button', className: 'dspm-btn', 'data-kind': 'primary', disabled: busy, onClick: saveDraft },
                busy ? t('mcpWorking') : t('mcpSave'),
              ),
              h(
                'button',
                { type: 'button', className: 'dspm-btn', disabled: busy, onClick: function () { setDraft(null) } },
                t('mcpCancel'),
              ),
            ),
          ),
        )
      }

      return h(
        'div',
        { className: 'dspm-root' },
        h(
          'div',
          { className: 'dspm-inner' },
          head,
          h('p', { className: 'dspm-intro' }, t('mcpIntro')),
          h(
            'div',
            { className: 'dspm-bar' },
            h(
              'button',
              {
                type: 'button',
                className: 'dspm-btn',
                'data-kind': 'primary',
                disabled: busy || draft !== null,
                onClick: startAdd,
              },
              icon(ICONS.plus, 14),
              t('mcpAdd'),
            ),
            h('span', { className: 'dspm-grow' }),
          ),
          body,
          state.patch !== '' ? h('div', { className: 'dspm-note' }, t('mcpWhere') + '：' + state.patch) : null,
        ),
      )
    }

    //#endregion

    //#region 已归档对话页（主区域整页）

    /**
     * 「已归档对话」整页。
     *
     * 这一页是主区域里的整页（不再是顶栏小弹窗），注册成了本插件的一个 main 座位
     * （编号 'archived'），侧栏 More 里的「已归档」那一行点一下就切到这一页。
     *
     * ── 为什么这一页用原生 DOM 拼，而不用 React（像 MCP 页那样）？ ──
     *   因为这一页的界面逻辑已经实测跑通
     *   （两步确认删除、待删除划线、恢复、打开对话…）。改成 React 等于重写一遍，
     *   白白引入出错的机会。这里的做法是：React 只负责给一个空的 div，
     *   里面的东西全部由下面这套原生代码自己画、自己管 —— React 不碰它的子节点，
     *   两套东西互不干扰（图表类库都是这么挂的）。
     *
     * @returns {object} React 元素。
     */
    function ArchivedPanel() {
      var hostRef = React.useRef(null)
      React.useEffect(function () {
        var host = hostRef.current
        if (host === null) return undefined
        return mountArchivedPage(host)
      }, [])
      return h('div', { className: 'dspa-root', ref: hostRef })
    }

    /** 已归档页的根容器（React 给我们的那个空 div）；页面没显示时是 null。 */
    var archHost = null

    /** 页面底部的提示条（显示时存在）。 */
    var archToastNode = null

    /** 提示条的自动消失计时器。 */
    var archToastTimer = 0

    /**
     * 这一页的全部界面状态。
     * 集中放一处、改动后手动重画 —— 和旧插件一致，不引入 React 的 setState。
     * 页面切走再切回来时这份状态还在，所以会先把上次的列表画出来，再去读新的。
     */
    var archState = {
      /** 是否正在读列表。 */
      loading: false,
      /** 读列表失败时的提示。 */
      error: '',
      /** 已归档对话的记录数组。 */
      sessions: [],
      /** 保留天数（宿主半告诉我们的，默认 3 天）。 */
      retentionDays: 3,
      /** 正在等第二次确认的 id（划掉那一行的动作）。 */
      armedId: null,
      /** 准备划掉的超时计时器。 */
      armedTimer: 0,
      /** 正在等第二次确认「立即删除」的 id。 */
      armedWipeId: null,
      /** 准备立即删除的超时计时器。 */
      armedWipeTimer: 0,
      /** 正在标记 / 恢复的 id 集合。 */
      deleting: {},
      /** 正在「打开」（取消归档并跳回对话）的 id 集合。 */
      opening: {},
      /** 正在查看的对话内容，null 表示在看列表。 */
      viewing: null,
      /** 正文是否正在读取。 */
      viewingLoading: false,
      /** 正文读取失败提示。 */
      viewingError: '',
    }

    /**
     * 建一个元素（这里用的小工具）。
     * @param {string} tag 标签名。
     * @param {object} [props] 属性/样式/事件。
     * @param {Array} [children] 子节点。
     * @returns {HTMLElement} 新元素。
     */
    function archEl(tag, props, children) {
      var node = document.createElement(tag)
      var options = props || {}
      Object.keys(options).forEach(function (key) {
        var value = options[key]
        if (value === undefined || value === null) return
        if (key === 'class') node.className = value
        else if (key === 'text') node.textContent = value
        else if (key === 'style') Object.assign(node.style, value)
        else if (key.indexOf('on') === 0) node.addEventListener(key.slice(2).toLowerCase(), value)
        else node.setAttribute(key, String(value))
      })
      ;(children || []).forEach(function (child) {
        if (child === null || child === undefined) return
        node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child)
      })
      return node
    }

    /**
     * 把时间戳格式化成 `21:36`。
     * @param {number|null} value 毫秒时间戳。
     * @returns {string} 本地时间文本，或 `—`。
     */
    function archFormatTime(value) {
      if (typeof value !== 'number' || !isFinite(value) || value <= 0) return '—'
      var date = new Date(value)
      var pad = function (n) { return n < 10 ? '0' + n : String(n) }
      return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate()) +
        ' ' + pad(date.getHours()) + ':' + pad(date.getMinutes())
    }

    /**
     * 把字节数写成人看得懂的大小。
     * @param {number} bytes 字节数。
     * @returns {string} 例如 `12 KB`。
     */
    function archFormatSize(bytes) {
      if (typeof bytes !== 'number' || bytes <= 0) return ''
      if (bytes < 1024) return bytes + ' B'
      if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + ' KB'
      return (bytes / 1024 / 1024).toFixed(1) + ' MB'
    }

    /**
     * 把剩余毫秒数写成“2 天 5 小时”这样的中文。
     * @param {number|null} ms 剩余毫秒。
     * @returns {string} 人看得懂的剩余时间。
     */
    function archFormatRemaining(ms) {
      if (typeof ms !== 'number' || !isFinite(ms)) return ''
      if (ms <= 0) return '马上'
      var minutes = Math.floor(ms / 60000)
      var days = Math.floor(minutes / 1440)
      var hours = Math.floor((minutes - days * 1440) / 60)
      if (days > 0) return days + ' 天 ' + hours + ' 小时'
      if (hours > 0) return hours + ' 小时 ' + (minutes - hours * 60) + ' 分钟'
      return Math.max(1, minutes) + ' 分钟'
    }

    /**
     * 弹一条底部提示。
     * @param {string} message 提示文字。
     * @returns {void}
     */
    function archToast(message) {
      if (archToastNode && archToastNode.parentNode) archToastNode.parentNode.removeChild(archToastNode)
      archToastNode = archEl('div', { class: 'dspa-toast', text: message })
      document.body.appendChild(archToastNode)
      if (archToastTimer) clearTimeout(archToastTimer)
      archToastTimer = setTimeout(function () {
        if (archToastNode && archToastNode.parentNode) archToastNode.parentNode.removeChild(archToastNode)
        archToastNode = null
        archToastTimer = 0
      }, 4200)
    }

    /**
     * 取消两个“等待第二次确认”的状态（划掉、立即删除）。
     * @returns {void}
     */
    function archDisarm() {
      archState.armedId = null
      if (archState.armedTimer) {
        clearTimeout(archState.armedTimer)
        archState.armedTimer = 0
      }
      archState.armedWipeId = null
      if (archState.armedWipeTimer) {
        clearTimeout(archState.armedWipeTimer)
        archState.armedWipeTimer = 0
      }
    }

    /**
     * 重新读一遍已归档列表。
     * @returns {Promise<void>} 完成即返回。
     */
    function archRefreshList() {
      archState.loading = true
      archState.error = ''
      archRenderAll()
      return callArchived('GET', '/list').then(function (data) {
        archState.sessions = Array.isArray(data.sessions) ? data.sessions : []
        if (typeof data.retentionDays === 'number') archState.retentionDays = data.retentionDays
        archState.loading = false
        archRenderAll()
      }).catch(function (error) {
        archState.loading = false
        archState.error = String(error && error.message ? error.message : error)
        archRenderAll()
      })
    }

    /**
     * 打开某条对话的正文（在整页里换一屏，不再是弹窗盖在上面）。
     * @param {string} id 会话 id。
     * @returns {void}
     */
    function archOpenViewer(id) {
      archState.viewing = { id: id }
      archState.viewingLoading = true
      archState.viewingError = ''
      archRenderAll()
      callArchived('GET', '/read?id=' + encodeURIComponent(id)).then(function (data) {
        archState.viewing = data
        archState.viewingLoading = false
        archRenderAll()
        if (archHost !== null) archHost.scrollTop = 0
      }).catch(function (error) {
        archState.viewingLoading = false
        archState.viewingError = String(error && error.message ? error.message : error)
        archRenderAll()
      })
    }

    /**
     * 返回列表。
     * @returns {void}
     */
    function archCloseViewer() {
      archState.viewing = null
      archState.viewingLoading = false
      archState.viewingError = ''
      archRenderAll()
      if (archHost !== null) archHost.scrollTop = 0
    }

    /**
     * 标记一条为“待删除”：第一次点只是“准备”，第二次点才真的打上标记。
     * 打上标记之后**不会马上删文件**，而是把这一行划掉，等保留期（默认 3 天）到了才删。
     * @param {string} id 会话 id。
     * @returns {void}
     */
    function archRequestDelete(id) {
      if (archState.deleting[id]) return
      if (archState.armedId !== id) {
        archDisarm()
        archState.armedId = id
        archState.armedTimer = setTimeout(function () {
          archDisarm()
          archRenderAll()
        }, 5000)
        archRenderAll()
        return
      }
      archDisarm()
      archState.deleting[id] = true
      archRenderAll()
      callArchived('POST', '/pending', { ids: [id] }).then(function () {
        delete archState.deleting[id]
        archToast('已标记待删除：划掉了，' + archState.retentionDays + ' 天内点「恢复」还能救回来 / Marked for deletion')
        return archRefreshList()
      }).catch(function (error) {
        delete archState.deleting[id]
        archToast('标记失败 / Failed：' + String(error && error.message ? error.message : error))
        archRenderAll()
      })
    }

    /**
     * 把一条“待删除”恢复回来（取消标记，文件一个都不动）。
     * @param {string} id 会话 id。
     * @returns {void}
     */
    function archRestore(id) {
      if (archState.deleting[id]) return
      if (!id) return
      archState.deleting[id] = true
      archRenderAll()
      callArchived('POST', '/restore', { ids: [id] }).then(function () {
        delete archState.deleting[id]
        archToast('已恢复：这条对话留下来了，不会被自动删除 / Restored')
        return archRefreshList()
      }).catch(function (error) {
        delete archState.deleting[id]
        archToast('恢复失败 / Restore failed：' + String(error && error.message ? error.message : error))
        archRenderAll()
      })
    }

    /**
     * DSH 自己的「会话导航」服务：点左边列表里的一条对话，就是它在干活。
     * 找到它就等于拿到了两件官方动作——取消归档、把对话显示到主区域。
     *
     * 这里用 ctx.get 而不是 ctx.uiWorkspace：前者不要求在 inject 里预先声明依赖，
     * 万一服务还没就绪也只是暂时拿不到，不会让整个插件起不来。
     * @returns {object|null} 服务对象，拿不到时是 null。
     */
    function archNavigationService() {
      if (!pluginCtx || typeof pluginCtx.get !== 'function') return null
      var names = ['uiWorkspace', 'workspaces']
      for (var i = 0; i < names.length; i += 1) {
        var service = null
        try {
          service = pluginCtx.get(names[i])
        } catch (error) {
          service = null
        }
        if (service && typeof service.unarchiveSession === 'function') return service
      }
      return null
    }

    /**
     * 顺手撤下「待删除」标记：既然要回去继续用这条对话，就不该再倒计时删它。
     * 没有标记也无所谓，宿主半会当无事发生。
     * @param {string} id 会话 id。
     * @returns {Promise<void>} 完成即返回；失败也不影响「打开」。
     */
    function archDropPendingMark(id) {
      var listed = archState.sessions.filter(function (item) { return item.id === id })[0]
      if (!listed || listed.pending !== true) return Promise.resolve()
      return callArchived('POST', '/restore', { ids: [id] }).then(function () {}, function () {})
    }

    /**
     * 让 DSH 把这条对话显示到主区域——也就是「回到原文的对话框」。
     * 首选官方导航服务；万一拿不到，就在左边列表里找到那一行替使用者点一下。
     * @param {object} navigation 会话导航服务。
     * @param {string} id 会话 id。
     * @returns {Promise<void>} 完成即返回。
     */
    function archShowConversation(navigation, id) {
      if (typeof navigation.openSession === 'function') {
        navigation.openSession(id)
        return Promise.resolve()
      }
      return archClickSidebarRow(id)
    }

    /**
     * 兜底方案：在左边列表里找到这条对话的那一行，替使用者点一下。
     * 只在 DSH 没提供导航服务时才会走到这里；行还没画出来就等一会儿再找。
     * @param {string} id 会话 id。
     * @returns {Promise<void>} 点到了就完成，5 秒还找不到就报错。
     */
    function archClickSidebarRow(id) {
      return new Promise(function (resolve, reject) {
        var deadline = Date.now() + 5000
        var attempt = function () {
          var row = document.querySelector('[data-row-key="session:' + id + '"]')
          if (row) {
            row.click()
            resolve()
            return
          }
          if (Date.now() > deadline) {
            reject(new Error('左边列表里没找到这一行（可能它的分组是收起的）'))
            return
          }
          setTimeout(attempt, 120)
        }
        attempt()
      })
    }

    /**
     * 「打开」：把一条已归档对话放回不归档的状态，并回到原来的对话框里。
     * 顺序很重要——先取消归档、再打开；反过来的话 DSH 会把「正在看一条已归档对话」
     * 又顺手关掉（它的规则是：当前对话一旦归档就清空主区域）。
     * @param {string} id 会话 id。
     * @returns {void}
     */
    function archOpenConversation(id) {
      if (!id || archState.opening[id] === true) return
      var navigation = archNavigationService()
      if (!navigation) {
        archToast('打开失败 / Open failed：DSH 的会话服务还没准备好，请刷新页面（⌘R）再试一次')
        return
      }
      archState.opening[id] = true
      archRenderAll()
      Promise.resolve()
        .then(function () { return navigation.unarchiveSession(id) })
        .then(function () { return archDropPendingMark(id) })
        // 取消归档和「打开」是两步：第二步失败不该说成整个失败——对话已经放出来了，
        // 只是没能自动帮你点开。所以这里把失败原因接住，最后分开报。
        .then(function () {
          return archShowConversation(navigation, id).then(function () { return null }, function (error) { return error })
        })
        .then(function (problem) {
          delete archState.opening[id]
          archCloseViewer()
          if (problem) {
            archToast('已取消归档，但没能自动打开它，请在左边列表里点开 / Unarchived, but could not open it：' + String(problem && problem.message ? problem.message : problem))
          } else {
            archToast('已取消归档，回到这条对话了 / Unarchived and opened')
          }
          return archRefreshList()
        })
        .catch(function (error) {
          delete archState.opening[id]
          archRenderAll()
          archToast('打开失败 / Open failed：' + String(error && error.message ? error.message : error))
        })
    }

    /**
     * 「立即删除」：不等保留期，现在就把这条的文件删掉。
     * 同样要点两次（第一次准备、第二次真删），免得手一抖就没了。
     * @param {string} id 会话 id。
     * @returns {void}
     */
    function archRequestWipe(id) {
      if (archState.deleting[id]) return
      if (archState.armedWipeId !== id) {
        archDisarm()
        archState.armedWipeId = id
        archState.armedWipeTimer = setTimeout(function () {
          archDisarm()
          archRenderAll()
        }, 5000)
        archRenderAll()
        return
      }
      archDisarm()
      archState.deleting[id] = true
      archRenderAll()
      callArchived('POST', '/delete', { ids: [id] }).then(function (data) {
        var result = data && data.results ? data.results[0] : null
        var pruned = data && Array.isArray(data.prunedWorkspaces) ? data.prunedWorkspaces : []
        delete archState.deleting[id]
        if (result && result.ok) {
          if (archState.viewing && archState.viewing.id === id) archCloseViewer()
          archToast(pruned.length > 0
            ? '已立即删除；它的工作区分组也从左边移除了（磁盘上的文件夹没动）/ Deleted now'
            : '已立即删除：本机 ~/.dsh 里的记录文件也删掉了 / Deleted now')
          return archRefreshList()
        }
        archToast('立即删除失败 / Delete failed：' + ((result && result.error) || 'unknown'))
        archRenderAll()
      }).catch(function (error) {
        delete archState.deleting[id]
        archToast('立即删除失败 / Delete failed：' + String(error && error.message ? error.message : error))
        archRenderAll()
      })
    }

    /**
     * 画列表里的一行。
     * 已标记待删除的行：标题和文件地址都会被划掉，按钮变成「恢复」。
     * @param {object} session 记录。
     * @returns {HTMLElement} 行元素。
     */
    function archRenderRow(session) {
      var armed = archState.armedId === session.id
      var armedWipe = archState.armedWipeId === session.id
      var busy = archState.deleting[session.id] === true
      var pending = session.pending === true
      var meta = []
      if (session.cwd) meta.push(session.cwd)
      meta.push('归档前最后动作 ' + archFormatTime(session.updatedAt))
      if (session.bytes) meta.push(archFormatSize(session.bytes))
      if (session.missing) meta.push('本地文件已不存在')
      var info = archEl('div', { class: 'dspa-info' }, [
        archEl('div', { class: 'dspa-title', text: session.title || '未命名 / Untitled' }),
        archEl('div', { class: 'dspa-meta', text: meta.join(' · ') }),
      ])
      if (pending) {
        info.appendChild(archEl('div', {
          class: 'dspa-pending',
          text: '待删除：' + archFormatTime(session.dueAt) + ' 自动删除（还剩 ' + archFormatRemaining(session.remainingMs) + '）· 点「恢复」可以撤回',
        }))
      }
      var opening = archState.opening[session.id] === true
      var actions = archEl('div', { class: 'dspa-acts' }, [
        // 「打开」：取消归档 + 回到原来的对话框。每一行都有，包括已划掉待删除的。
        archEl('button', {
          class: 'dspa-btn',
          type: 'button',
          'data-kind': 'open',
          disabled: (busy || opening) ? 'disabled' : null,
          text: opening ? '打开中…' : '打开',
          title: '取消归档，回到这条对话里继续聊（它会重新出现在左边的列表里）',
          onclick: function (event) {
            event.stopPropagation()
            archOpenConversation(session.id)
          },
        }),
        pending
          ? archEl('button', {
            class: 'dspa-btn',
            type: 'button',
            'data-kind': 'restore',
            disabled: (busy || opening) ? 'disabled' : null,
            text: busy ? '处理中…' : '恢复',
            title: '把这条从待删除里救回来，文件不会被删',
            onclick: function (event) {
              event.stopPropagation()
              archRestore(session.id)
            },
          })
          : archEl('button', {
            class: 'dspa-btn',
            type: 'button',
            disabled: (busy || opening) ? 'disabled' : null,
            'data-kind': 'danger',
            'data-armed': armed ? 'true' : 'false',
            text: busy ? '处理中…' : (armed ? '确认删除？' : '删除'),
            title: armed
              ? '再点一次：先划掉这一行，' + archState.retentionDays + ' 天内还能恢复'
              : '第一次点只是准备，第二次点才会划掉；划掉后 ' + archState.retentionDays + ' 天内可恢复',
            onclick: function (event) {
              event.stopPropagation()
              archRequestDelete(session.id)
            },
          }),
        pending
          ? archEl('button', {
            class: 'dspa-btn',
            type: 'button',
            disabled: (busy || opening) ? 'disabled' : null,
            'data-kind': 'danger',
            'data-armed': armedWipe ? 'true' : 'false',
            text: busy ? '处理中…' : (armedWipe ? '确认立即删除？' : '立即删除'),
            title: armedWipe
              ? '再点一次就现在删掉，本机文件也一起删，无法恢复'
              : '不想等 ' + archState.retentionDays + ' 天？第一次点只是准备，第二次点立刻删除',
            onclick: function (event) {
              event.stopPropagation()
              archRequestWipe(session.id)
            },
          })
          : null,
      ])
      return archEl('div', {
        class: 'dspa-row',
        'data-missing': session.missing ? 'true' : null,
        'data-pending': pending ? 'true' : null,
        title: pending
          ? '已标记待删除，' + archState.retentionDays + ' 天后自动删除；点「打开」直接回去继续聊，点「恢复」撤回删除'
          : '点这一行看正文；点右边的「打开」取消归档并回到对话',
        onclick: function () { archOpenViewer(session.id) },
      }, [info, actions])
    }

    /**
     * 列表里每一行该怎么排：**被划掉的（待删除）永远排在最下面**，
     * 剩下的保持原来的顺序（最近动过的在前）。恢复之后会自动回到原来的位置。
     * @returns {object[]} 排好序的副本。
     */
    function archOrderedSessions() {
      var ordinary = []
      var pending = []
      archState.sessions.forEach(function (session) {
        if (session.pending === true) pending.push(session)
        else ordinary.push(session)
      })
      return ordinary.concat(pending)
    }

    /**
     * 画「列表」这一屏。
     * @returns {HTMLElement} 内容元素。
     */
    function archRenderList() {
      var rows = archOrderedSessions()
      var pendingCount = rows.filter(function (session) { return session.pending === true }).length
      var body
      if (archState.loading && archState.sessions.length === 0) {
        body = archEl('div', { class: 'dspa-empty', text: '正在读取…' })
      } else if (archState.error !== '') {
        body = archEl('div', { class: 'dspa-err', text: '读取失败：' + archState.error })
      } else if (archState.sessions.length === 0) {
        body = archEl('div', { class: 'dspa-empty', text: '没有已归档的对话 / No archived conversations' })
      } else {
        body = archEl('div', {}, rows.map(archRenderRow))
      }
      var subtitle = '共 ' + archState.sessions.length + ' 条'
        + (pendingCount > 0 ? '（待删除 ' + pendingCount + ' 条已排到最下面）' : '')
        + ' · 保留 ' + archState.retentionDays + ' 天 · 点条目看正文，点「打开」回到对话'
        + (archState.loading ? ' · 正在刷新…' : '')
      return archEl('div', { class: 'dspa-inner' }, [
        archEl('div', { class: 'dspa-head' }, [
          archEl('div', { class: 'dspa-grow' }, [
            archEl('h1', { class: 'dspa-h1', text: '已归档对话 / Archived' }),
            archEl('div', { class: 'dspa-sub', text: subtitle }),
          ]),
          archEl('button', {
            class: 'dspa-btn',
            type: 'button',
            disabled: archState.loading ? 'disabled' : null,
            text: archState.loading ? '刷新中…' : '刷新',
            title: '重新读一遍本机的已归档名单',
            onclick: function () { archRefreshList() },
          }),
        ]),
        body,
        archEl('div', {
          class: 'dspa-note',
          text: '点「打开」= 取消归档，回到原来的对话框继续聊。「删除」要点两次：第一次准备，第二次把那一行划掉；划掉后 ' + archState.retentionDays + ' 天内点「恢复」都能撤回，到期才真正删掉本机 ~/.dsh 里的记录文件；不想等就点「立即删除」（同样要点两次）。',
        }),
      ])
    }

    /**
     * 画「正文」这一屏（在整页里替换掉列表，不是弹窗盖上去）。
     * @returns {HTMLElement} 内容元素。
     */
    function archRenderDetail() {
      var data = archState.viewing || {}
      var listed = archState.sessions.filter(function (item) { return item.id === data.id })[0] || {}
      var pending = listed.pending === true
      var head = [
        archEl('button', {
          class: 'dspa-btn',
          type: 'button',
          'data-kind': 'back',
          text: '← 返回列表',
          title: '回到已归档名单（按 Esc 也可以）',
          onclick: function () { archCloseViewer() },
        }),
        archEl('div', { class: 'dspa-grow' }, [
          archEl('div', { class: 'dspa-h1' + (pending ? ' dspa-strike' : ''), text: data.title || '未命名 / Untitled' }),
          archEl('div', {
            class: 'dspa-sub' + (pending ? ' dspa-strike' : ''),
            text: [data.cwd || '', data.entries ? data.entries.length + ' 条消息' : '', archFormatTime(data.createdAt)].filter(Boolean).join(' · '),
          }),
          pending
            ? archEl('div', {
              class: 'dspa-pending',
              text: '待删除：' + archFormatTime(listed.dueAt) + ' 自动删除（还剩 ' + archFormatRemaining(listed.remainingMs) + '）',
            })
            : null,
        ]),
      ]
      if (data.id) {
        // 「打开对话」排在删除类按钮前面：它是这条对话的主动作。
        var viewingOpening = archState.opening[data.id] === true
        head.push(archEl('button', {
          class: 'dspa-btn',
          type: 'button',
          'data-kind': 'open',
          disabled: viewingOpening ? 'disabled' : null,
          text: viewingOpening ? '打开中…' : '打开对话',
          title: '取消归档，回到这条对话里继续聊',
          onclick: function () { archOpenConversation(data.id) },
        }))
        var armed = archState.armedId === data.id
        var armedWipe = archState.armedWipeId === data.id
        if (pending) {
          head.push(archEl('button', {
            class: 'dspa-btn',
            type: 'button',
            'data-kind': 'restore',
            text: '恢复',
            title: '取消待删除标记，文件不会被删',
            onclick: function () { archRestore(data.id) },
          }))
          head.push(archEl('button', {
            class: 'dspa-btn',
            type: 'button',
            'data-kind': 'danger',
            'data-armed': armedWipe ? 'true' : 'false',
            text: armedWipe ? '确认立即删除？' : '立即删除',
            title: armedWipe
              ? '再点一次就现在删掉，本机文件也一起删，无法恢复'
              : '不想等 ' + archState.retentionDays + ' 天？第一次点只是准备，第二次点立刻删除',
            onclick: function () { archRequestWipe(data.id) },
          }))
        } else {
          head.push(archEl('button', {
            class: 'dspa-btn',
            type: 'button',
            'data-kind': 'danger',
            'data-armed': armed ? 'true' : 'false',
            text: armed ? '确认删除？' : '删除这条',
            onclick: function () { archRequestDelete(data.id) },
          }))
        }
      }

      var body
      if (archState.viewingLoading) body = archEl('div', { class: 'dspa-empty', text: '正在读取正文…' })
      else if (archState.viewingError) body = archEl('div', { class: 'dspa-err', text: '读取失败：' + archState.viewingError })
      else if (!data.entries || data.entries.length === 0) body = archEl('div', { class: 'dspa-empty', text: '这条对话没有可显示的文字内容。' })
      else {
        body = archEl('div', { class: 'dspa-msgs' }, data.entries.map(function (entry) {
          return archEl('div', { class: 'dspa-msg', 'data-role': entry.role === 'user' ? 'user' : 'assistant' }, [
            archEl('span', { class: 'dspa-role', text: (entry.role === 'user' ? '我 / You' : '助手 / Assistant') + ' · ' + archFormatTime(entry.time) }),
            archEl('span', { text: entry.text }),
          ])
        }).concat(data.truncated ? [archEl('div', { class: 'dspa-empty', text: '（内容太长，只显示了一部分）' })] : []))
      }
      return archEl('div', { class: 'dspa-inner' }, [
        archEl('div', { class: 'dspa-head' }, head),
        archEl('div', { class: 'dspa-sub', text: '点上面的「打开对话」= 取消归档，回到这个对话框里继续聊' }),
        body,
      ])
    }

    /**
     * 按当前状态把整页重画一遍。
     * @returns {void}
     */
    function archRenderAll() {
      if (archHost === null) return
      var next = archState.viewing ? archRenderDetail() : archRenderList()
      while (archHost.firstChild) archHost.removeChild(archHost.firstChild)
      archHost.appendChild(next)
    }

    /**
     * 把这一页挂到一个容器里（React 座位给的那个空 div）。
     *
     * 每次切到这一页都会调用一次：先把上次的数据画出来（不闪），再去读一遍新的
     * —— 和旧插件「点开就刷新」的行为一致。
     * @param {HTMLElement} host 容器。
     * @returns {Function} 页面被切走时调用的清理函数。
     */
    function mountArchivedPage(host) {
      archHost = host
      archRenderAll()
      archRefreshList()
      var onKeyDown = function (event) {
        if (event.key !== 'Escape') return
        if (archState.viewing) archCloseViewer()
      }
      document.addEventListener('keydown', onKeyDown)
      return function destroy() {
        document.removeEventListener('keydown', onKeyDown)
        if (archToastTimer) {
          clearTimeout(archToastTimer)
          archToastTimer = 0
        }
        if (archToastNode && archToastNode.parentNode) archToastNode.parentNode.removeChild(archToastNode)
        archToastNode = null
        // 没点完的「确认删除？」要作废，免得下次进来第一下就真删。
        archDisarm()
        archHost = null
      }
    }

    //#endregion

    //#region 侧栏改造（原生 DOM）

    /** 记着插件上下文，供注入逻辑使用。 */
    var pluginCtx = null

    /**
     * 在侧栏里找到几个关键元素。
     * @returns {object | null} 找不到就返回 null。
     */
    function findSidebar() {
      var anchor = document.querySelector('[data-slot="sidebar"]')
      if (anchor === null) return null
      var root = anchor.firstElementChild
      if (root === null) return null
      var panelList = root.querySelector('nav[class*="panelList"]')
      var newSession = root.querySelector('button[class*="newSession"]')
      var regionArea = root.querySelector('div[class*="regionArea"]')
      if (panelList === null || newSession === null) return null
      return {
        root: root,
        panelList: panelList,
        newSession: newSession,
        regionArea: regionArea,
        // 顶部那条只放「收起侧栏」按钮（而且只有 macOS 版才有这条）。
        // 「已归档」以前是另一个插件插在这条里的按钮，合并之后没有了，
        // 所以量它的宽度 = 量右上角那一小撮按钮的总宽（现在就是那个收起按钮）。
        topStrip: root.querySelector('[class*="topStrip"]'),
        logoRow: root.querySelector('[class*="logoRow"]'),
      }
    }

    /**
     * 判断侧栏现在是不是「收起成一条窄条」的状态。
     *
     * 收起时只显示图标、没有文字，我们画的这套带文字的分组放不下，
     * 所以那种状态下把我们画的东西藏起来，让官方原本的图标条照常显示。
     * @param {object} root 侧栏根元素。
     * @returns {boolean} true 表示已收起。
     */
    function isRail(root) {
      return String(root.className || '')
        .split(/\s+/)
        .some(function (name) {
          return name.slice(-10) === '_collapsed'
        })
    }

    /**
     * 读出官方侧栏现在有哪些面板行，以及哪一行是选中的。
     *
     * 为什么要读官方那一行，而不是自己记状态？
     *   因为「当前打开的是哪一页」这件事由官方管着（点会话会切回对话页等），
     *   自己记一份迟早会对不上。直接读官方那行的 aria-current，永远同步。
     * @param {object} panelList 官方那三行所在的容器。
     * @returns {{ ids: string[], activeIndex: number }} 面板编号顺序与当前选中项。
     */
    function readPanels(panelList) {
      var ids = []
      var activeIndex = -1
      try {
        var list = pluginCtx.slots.entriesOfSlot('sidebar.panellist')
        var rows = list.map(function (entry) {
          var options = entry.options
          var label = typeof options.label === 'function' ? options.label() : options.label
          return { id: String(options.id), order: options.order || 0, label: label === undefined ? String(options.id) : String(label) }
        })
        rows.sort(function (a, b) {
          return a.order - b.order
        })
        ids = rows.map(function (row) {
          return row.id
        })
      } catch (error) {
        ids = []
      }
      var buttons = panelList.querySelectorAll('button')
      for (var index = 0; index < buttons.length; index += 1) {
        if (buttons[index].getAttribute('aria-current') === 'page') {
          activeIndex = index
          break
        }
      }
      return { ids: ids, activeIndex: activeIndex }
    }

    /**
     * 造一个菜单行。
     * @param {object} options 行的配置。
     * @returns {object} 按钮元素。
     */
    function menuRow(options) {
      var button = document.createElement('button')
      button.type = 'button'
      button.className = options.className
      if (options.active !== undefined) button.setAttribute('data-active', options.active ? 'true' : 'false')
      if (options.panelId !== undefined) button.setAttribute('data-panel', options.panelId)
      if (options.expanded !== undefined) button.setAttribute('aria-expanded', options.expanded ? 'true' : 'false')
      button.setAttribute('title', options.title || options.label)

      var glyph = document.createElement('span')
      glyph.className = 'dsp-ico'
      glyph.innerHTML =
        '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
        options.icon +
        '</svg>'
      button.appendChild(glyph)

      var label = document.createElement('span')
      label.className = 'dsp-label'
      label.textContent = options.label
      button.appendChild(label)

      if (options.chevron === true) {
        var chev = document.createElement('span')
        chev.className = 'dsp-chev'
        chev.innerHTML =
          '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
          ICONS.chevron +
          '</svg>'
        button.appendChild(chev)
      }
      return button
    }

    /** 记着我们画出来的那几个元素，方便每轮刷新时复用。 */
    var injected = {
      column: null,
      group: null,
      groupInner: null,
      head: null,
      headLabel: null,
      subs: {},
      newTask: null,
      newTaskLabel: null,
    }

    /**
     * 「请立刻重画一遍」的开关。
     *
     * 为什么需要它？使用者点「收起 / 展开」之后，状态是改了，但界面不会自己变 ——
     * 得有人去「应用」这个状态。平时这件事由「盯页面」的观察器做，
     * 但观察器要等页面有变动才会醒，使用者点完可能等半天没反应。
     * 所以点完我们主动叫一次重画。这个开关由 apply 里的观察器填上。
     */
    var repaint = null

    /** 正在被拖动的是 More 分组里的哪一项（没在拖就是 null）。 */
    var subDragId = null

    /**
     * 正在被拖的**工作区（项目）**编号。
     *
     * 为什么必须单独记一个变量？
     *   浏览器的安全限制：`dataTransfer.getData()` 在 **dragover 阶段读出来永远是空串**
     *   （只有 drop 那一刻才给读）。所以「拖的是不是项目」这件事没法在 dragover 里现查，
     *   只能在 dragstart 那一刻记下来。
     *   （排查「拖项目没有蓝线」时发现的 —— 之前那版就是死在这条上。）
     */
    var draggingWorkspaceId = null

    /** 上一次摆好的 More 子项顺序，用来判断要不要重排。 */
    var subOrderCache = null

    /**
     * 清掉 More 分组里所有「将要落在这里」的提示线。
     * @param {Element} group 分组容器。
     * @returns {void}
     */
    function clearSubDropMarks(group) {
      if (group === null || group === undefined) return
      var marked = group.querySelectorAll('[data-drop]')
      for (var index = 0; index < marked.length; index += 1) marked[index].removeAttribute('data-drop')
    }

    /**
     * 画（或重画）我们自己那一列菜单。
     * @param {object} ctx 客户端插件上下文。
     * @param {object} parts 侧栏的几个关键元素。
     * @param {object} t 翻译函数。
     * @returns {void}
     */
    function paintMenu(ctx, parts, t) {
      var collapsed = false
      try {
        collapsed = window.localStorage.getItem(COLLAPSE_KEY) === 'true'
      } catch (error) {
        collapsed = false
      }

      var rail = isRail(parts.root)

      if (injected.column === null || injected.column.parentNode === null) {
        var column = document.createElement('div')
        column.className = 'dsp-col'

        var newTask = menuRow({ className: 'dsp-row', icon: ICONS.compose, label: t('newTask') })
        // 只能点（新建对话），不能展开 → 手指
        newTask.setAttribute('data-foldable', 'false')
        newTask.addEventListener('click', function () {
          try {
            ctx.uiWorkspace.startSession()
          } catch (error) {
            /* 会话服务暂时不可用时什么都不做，避免报错弹窗 */
          }
        })
        column.appendChild(newTask)
        var newTaskLabel = newTask.querySelector('.dsp-label')

        var group = document.createElement('div')
        group.className = 'dsp-group'
        group.setAttribute('data-collapsed', collapsed ? 'true' : 'false')
        // 里面包一层：折叠动画要求 grid 只有一行，否则多余的子项折叠不掉
        var groupInner = document.createElement('div')
        groupInner.className = 'dsp-group-inner'
        group.appendChild(groupInner)

        var head = menuRow({
          className: 'dsp-row',
          icon: ICONS.list,
          label: t('extensions'),
          chevron: true,
          expanded: !collapsed,
          title: collapsed ? t('expandExtensions') : t('collapseExtensions'),
        })
        // 这个标题点了会展开 / 收起 → 标记成「可展开」，光标用「手掌」
        head.setAttribute('data-foldable', 'true')
        var headLabel = head.querySelector('.dsp-label')
        head.addEventListener('click', function () {
          var next = group.getAttribute('data-collapsed') !== 'true'
          group.setAttribute('data-collapsed', next ? 'true' : 'false')
          head.setAttribute('aria-expanded', next ? 'false' : 'true')
          try {
            window.localStorage.setItem(COLLAPSE_KEY, next ? 'true' : 'false')
          } catch (error) {
            /* 存不了就只在本次会话里生效 */
          }
          // 立刻把高度改过来，不等重画（重画要等观察器醒，可能等不到）
          if (injected.group !== null) {
            if (next) {
              injected.group.style.height = '0px'
            } else {
              var natural = injected.groupInner === null ? 0 : injected.groupInner.scrollHeight
              injected.group.style.height = natural > 0 ? natural + 'px' : ''
            }
          }
          if (repaint !== null) repaint()
        })
        // 「More」这一行必须放在 group **外面**：它是「开关」，
        // 放进可折叠的 group 里的话，一收起连它自己都没了（这就是 More 消失的原因）。
        column.appendChild(head)

        // More 分组里的各项：技能 / 插件 / 自动化任务 / MCP / 已归档
        //
        // 顺序可以按住拖动来调整，调完记在浏览器本地（下次打开还是你排的顺序）。
        // 「已归档」也是本插件自己注册的整页（main 座位，编号 'archived'），
        // 点它和点 MCP 完全一样：直接按编号切页，不再去点别人的隐藏按钮。
        var SUB_ORDER_KEY = 'dsh.sidebar-pro.sub-order'
        var DEFAULT_SUBS = ['skills', 'plugins', 'schedules', MCP_PANEL_ID, ARCH_PANEL_ID]
        var SUB_ICONS = {
          skills: ICONS.sparkle,
          plugins: ICONS.box,
          schedules: ICONS.clock,
          archived: ICONS.archive,
        }
        SUB_ICONS[MCP_PANEL_ID] = ICONS.plug

        var subNodes = {}

        /**
         * 读出使用者排好的顺序；有新增的项就补到末尾，有失效的项就去掉。
         * @returns {string[]} 顺序清单。
         */
        var readSubOrder = function () {
          var stored = readStored(SUB_ORDER_KEY, null)
          var order = Array.isArray(stored) ? stored.filter(function (id) {
            return DEFAULT_SUBS.indexOf(id) >= 0
          }) : []
          DEFAULT_SUBS.forEach(function (id) {
            if (order.indexOf(id) < 0) order.push(id)
          })
          return order
        }

        /**
         * 造 More 分组里的一行。
         * @param {string} id 这一项的名字。
         * @returns {object} 按钮元素。
         */
        var makeSub = function (id) {
          // 名字分两种：MCP / 已归档是我们自己的，直接用我们的文案；
          // 技能 / 插件 / 自动化任务是官方的页面，问官方要名字（会跟着语言变）。
          var label = id === ARCH_PANEL_ID
            ? t('archived')
            : id === MCP_PANEL_ID
              ? t('mcp')
              : readOfficialLabels()[id] || id
          var button = menuRow({ className: 'dsp-row dsp-sub', icon: SUB_ICONS[id], label: label, panelId: id })
          button.setAttribute('data-sub', id)
          button.setAttribute('draggable', 'true')
          button.setAttribute('title', t('dragToSort'))

          // 子项点了只是切页，不能展开 → 手指
          button.setAttribute('data-foldable', 'false')
          button.addEventListener('click', function () {
            try {
              ctx.layout.selectPanel(id)
            } catch (error) {
              /* 面板不存在时忽略，避免整页崩掉 */
            }
          })

          // ── 拖动排序 ──
          button.addEventListener('dragstart', function (event) {
            event.dataTransfer.effectAllowed = 'move'
            event.dataTransfer.setData('text/plain', 'sub:' + id)
            button.setAttribute('data-dragging', 'true')
            subDragId = id
          })
          button.addEventListener('dragend', function () {
            button.removeAttribute('data-dragging')
            subDragId = null
            clearSubDropMarks(group)
          })
          button.addEventListener('dragover', function (event) {
            if (subDragId === null || subDragId === id) return
            event.preventDefault()
            event.dataTransfer.dropEffect = 'move'
            var rect = button.getBoundingClientRect()
            var after = event.clientY > rect.top + rect.height / 2
            clearSubDropMarks(group)
            button.setAttribute('data-drop', after ? 'after' : 'before')
          })
          button.addEventListener('dragleave', function () {
            button.removeAttribute('data-drop')
          })
          button.addEventListener('drop', function (event) {
            event.preventDefault()
            if (subDragId === null || subDragId === id) return
            var rect = button.getBoundingClientRect()
            var after = event.clientY > rect.top + rect.height / 2
            var order = readSubOrder().filter(function (keep) {
              return keep !== subDragId
            })
            var at = order.indexOf(id)
            if (at < 0) return
            order.splice(after ? at + 1 : at, 0, subDragId)
            writeStored(SUB_ORDER_KEY, order)
            clearSubDropMarks(group)
            rebuildSubs()
          })

          return button
        }

        // 按记下来的顺序把子项摆好（只在顺序变了的时候才重排，避免每轮都动 DOM）
        var wanted = readSubOrder().join('\u0000')
        if (subOrderCache !== wanted) {
          subOrderCache = wanted
          // 倒着遍历「直接子节点」逐个删。
          // 为什么不用 querySelectorAll？它会连后代一起选中，
          // 万一以后有嵌套结构，会把里面的东西也挖出来变成孤儿。
          for (var subIndex = groupInner.childNodes.length - 1; subIndex >= 0; subIndex -= 1) {
            var child = groupInner.childNodes[subIndex]
            if (child.nodeType === 1) groupInner.removeChild(child)
          }
          subNodes = {}
          readSubOrder().forEach(function (id) {
            groupInner.appendChild(makeSub(id))
          })
        }

        /**
         * 立刻按新顺序重排一次。
         *
         * 为什么要在拖放之后马上调？因为光把顺序写进浏览器本地、清掉缓存，
         * 界面并不会自己变 —— 得等下一轮「盯页面」的检查才会重画，
         * 而那一轮不一定马上来。使用者拖完松手，看到顺序没动，会以为坏了。
         * @returns {void}
         */
        var rebuildSubs = function () {
          // 倒着遍历「直接子节点」逐个删（理由同上）。
          for (var i = groupInner.childNodes.length - 1; i >= 0; i -= 1) {
            var child = groupInner.childNodes[i]
            if (child.nodeType === 1) groupInner.removeChild(child)
          }
          subNodes = {}
          readSubOrder().forEach(function (id) {
            var button = makeSub(id)
            // 注意是 groupInner，不是 group ——
            // 塞进 group 会跑到包装层外面，重排几次就叠出一堆重复的。
            groupInner.appendChild(button)
            subNodes[id] = button
          })
          subOrderCache = readSubOrder().join('\u0000')
          // 关键：把新的节点表交给 injected，否则后面「填名字」那一步
          // 还在往已经被删掉的旧节点上写，界面上就变成一片空白。
          injected.subs = subNodes
        }
        column.appendChild(group)
        parts.newSession.insertAdjacentElement('afterend', column)

        injected.column = column
        injected.group = group
        injected.groupInner = groupInner
        injected.head = head
        injected.headLabel = headLabel
        injected.subs = subNodes
        injected.newTask = newTask
        injected.newTaskLabel = newTaskLabel
      }

      // 只有我们自己的菜单确实画在页面上了，才去藏官方那两处。
      // 这样万一我们这边出问题，官方的「新会话」按钮和那排图标还在，
      // 你照样能新建会话、能进各个面板，不会卡住。
      //
      // 注意：这里**不去动官方元素的 inline style**，而是靠侧栏上的一个标记
      // 让样式表去隐藏它。原因：官方那两个元素本来就有自己的 display（比如 flex），
      // 我们要是把 style.display 写成 '' 或 'none'，就会把官方原来的值覆盖掉，
      // 收起成窄条时它们该变成图标却变不回来，排版就乱了。
      var ours = injected.column.parentNode !== null
      var hideOfficial = ours && !rail
      if (hideOfficial) {
        if (!parts.root.hasAttribute('data-dsp-ownmenu')) parts.root.setAttribute('data-dsp-ownmenu', '')
      } else if (parts.root.hasAttribute('data-dsp-ownmenu')) {
        parts.root.removeAttribute('data-dsp-ownmenu')
      }

      // 文案可能因为切语言而变，每轮都对齐一次。
      // 注意：直接存节点引用，不要用下标去数（顺序一变就会错位）。
      setText(injected.newTaskLabel, t('newTask'))
      setText(injected.headLabel, t('extensions'))
      setAttr(
        injected.head,
        'title',
        injected.group.getAttribute('data-collapsed') === 'true' ? t('expandExtensions') : t('collapseExtensions'),
      )

      // 用官方那几行的名字给子项命名，保证和官方口径一致（切语言也跟着变）
      var panels = readPanels(parts.panelList)
      var officialLabels = []
      try {
        var rows = pluginCtx.slots.entriesOfSlot('sidebar.panellist')
        rows.sort(function (a, b) {
          return (a.options.order || 0) - (b.options.order || 0)
        })
        officialLabels = rows.map(function (entry) {
          var label = entry.options.label
          var text = typeof label === 'function' ? label() : label
          return text === undefined ? String(entry.options.id) : String(text)
        })
      } catch (error) {
        officialLabels = []
      }
      // 注意：这里**从页面上现查**子项，而不是用记下来的节点引用。
      // 因为拖动排序会把节点整个换掉，旧的引用会失效 —— 那样文字就填不上了。
      var subLabelTable = readOfficialLabels()
      var subRows = injected.column.querySelectorAll('.dsp-sub')
      for (var subAt = 0; subAt < subRows.length; subAt += 1) {
        var node = subRows[subAt]
        var id = node.getAttribute('data-sub')
        if (id === null) continue
        // MCP 和「已归档」的名字由我们自己定，不要被官方的覆盖掉
        if (id !== MCP_PANEL_ID && id !== ARCH_PANEL_ID) {
          var official = subLabelTable[id]
          if (official !== undefined && official !== '') setText(node.querySelector('.dsp-label'), official)
        }
        var at = panels.ids.indexOf(id)
        setAttr(node, 'data-active', at >= 0 && at === panels.activeIndex ? 'true' : 'false')
      }

      // More 分组：按收起状态设高度。
      //
      // 为什么要等「下一帧」再设？
      //   首次那一轮，子项是刚 createElement 出来的，浏览器还没排版，
      //   这时 scrollHeight 读到的是 0，高度就会被设成空 —— 整个分组看不见。
      //   等一帧再量，内容已经排好版，量到的才是真高度。
      if (injected.group !== null) {
        var measureGroup = function () {
          if (injected.group === null) return
          var collapsedNow = injected.group.getAttribute('data-collapsed') === 'true'
          applyFoldHeight(injected.group, injected.groupInner, collapsedNow)
        }
        measureGroup()
        window.requestAnimationFrame(measureGroup)
      }

      // 窄条（侧栏收起）状态下，我们那一列交给样式表藏起来 ——
      // 标记打在侧栏根节点上（[data-dsp-rail]），由样式表统一处理。
      // 这里不再单独给这一列打标记：那条动画已经删了，留着是死代码。
    }

    /**
     * 清掉「上一次加载」留下的重复节点，保证页面上只剩一份。
     *
     * 为什么需要这个？
     *   开发过程中反复改代码时，DSH 每次发现文件变了就会把插件重新加载一遍。
     *   重新加载会新建一套我们的界面，但**上一次那套不会被自动清掉**，
     *   于是就一层层叠起来 —— 界面上会看到菜单重复好几遍。
     *   这里每次都主动去页面上扫一遍，把不是当前这一份的都删掉。
     *
     *   这也是给「热更新」和「界面被重建」两种情况兜底：不管什么原因导致
     *   页面上多出了我们的节点，下一轮都会被收拾干净。
     * @param {Element} scope 在哪里面找（一般传侧栏根元素）。
     * @param {string} selector 要找的节点特征（例如 '.dsp-col'）。
     * @param {Element|null} keep 要保留的那一个（通常是当前这份）。
     * @returns {void}
     */
    function dropStale(scope, selector, keep) {
      var found = scope.querySelectorAll(selector)
      for (var index = 0; index < found.length; index += 1) {
        if (found[index] !== keep && found[index].parentNode !== null) {
          found[index].parentNode.removeChild(found[index])
        }
      }
    }

    //#endregion

    //#region 单一实例（防止热更新后叠出好几份界面）

    /** 记在 window 上的钥匙：谁拿到它，谁就是当前唯一生效的那一份。 */
    var OWNER_KEY = '__DSH_SIDEBAR_PRO_OWNER__'

    /** 当前这一份的身份牌。 */
    var myBadge = null

    /**
     * 抢下「当前生效者」的身份。
     *
     * 为什么必须这么做？
     *   改代码后 DSH 会把插件重新加载一遍。旧的实例不会被自动销毁，
     *   它的事件监听和「盯页面」的观察器都还在跑。两个实例同时改造侧栏，
     *   就会互相删对方的节点、反复重画，界面上一片混乱。
     *   所以新实例一上来就把旧实例「劝退」：让它把自己画的东西收走、停止观察。
     * @returns {object} 这一份的身份牌。
     */
    function claimOwnership() {
      var previous = window[OWNER_KEY]
      if (previous !== undefined && previous !== null && typeof previous.release === 'function') {
        try {
          previous.release()
        } catch (error) {
          /* 旧实例可能已经被销毁，收尾失败不影响新的这份 */
        }
      }
      myBadge = {
        /** 由下面那个 effect 填进来：负责收走这一份画的东西、停掉观察器。 */
        release: null,
      }
      window[OWNER_KEY] = myBadge
      return myBadge
    }

    /**
     * 问一句：现在还是当前实例说了算吗？
     * @returns {boolean} true 表示还是当前生效的那一份。
     */
    function stillOwner() {
      return myBadge !== null && window[OWNER_KEY] === myBadge
    }

    /** 记着品牌行「原始」离顶部的距离。量一次就够，见 naturalLogoTop 的说明。 */
    var cachedLogoTop = null

    /**
     * 量出内容的真实高度，写到外层元素的 CSS 变量上。
     *
     * 为什么分成「量谁」和「写谁」？
     *   外层的 height 是我们用变量控制的（收起时是 0），量它只会量到 0；
     *   真正的高度在里层（内容本身）。所以：**量里层，写外层**。
     *
     * 为什么不用「临时摘掉收起标记再量」那种做法？
     *   试过，太脆弱：每轮重画都要摘一次属性，浏览器一旦在中间重排，界面就会闪。
     *   这里直接读里层的 scrollHeight —— 里层没有被人为限制高度，
     *   它的 scrollHeight 就是内容的真实高度，不用动任何属性。
     * @param {HTMLElement} outer 外层（样式表读它身上的变量）。
     * @param {HTMLElement} inner 里层（真正装内容的那个）。
     * @param {string} varName CSS 变量名。
     * @returns {void}
     */
    function measureInto(outer, inner, varName) {
      if (outer === null || outer === undefined) return
      if (inner === null || inner === undefined) return
      // 里层没被人为限高，scrollHeight 就是内容真实高度
      var height = inner.scrollHeight
      if (!(height > 0)) return
      var value = height + 'px'
      if (outer.style.getPropertyValue(varName) !== value) outer.style.setProperty(varName, value)
    }

    /**
     * 把「拖窗口把手」标记从顶栏和品牌行上摘掉。
     *
     * 为什么必须这么做？
     *   macOS 上官方给这两条标了 data-window-drag，对应样式是
     *     html[data-platform=darwin] [data-window-drag]{-webkit-app-region:drag}
     *   意思是「按住这里可以拖动整个窗口」。但这个区域会**吞掉所有鼠标点击**。
     *
     *   官方的按钮之所以还能点，是因为它们自己带了 no-drag 豁免。
     *   可我们把它浮起来、盖到别处之后，被盖住的那些地方就点不动了
     *   （收起按钮就是这么废掉的）。
     *
     *   想用样式覆盖？不行 —— 官方那条规则权重是 (0,2,1)，我们写的是 (0,2,0)，
     *   比不过（这一点踩过坑）。所以直接把属性摘掉，让那条规则选不中它。
     * @param {object} parts 侧栏的几个关键元素。
     * @returns {void}
     */
    function releaseDragHandle(parts) {
      if (parts.topStrip !== null && parts.topStrip.hasAttribute('data-window-drag')) {
        parts.topStrip.removeAttribute('data-window-drag')
      }
      if (parts.logoRow !== null && parts.logoRow.hasAttribute('data-window-drag')) {
        parts.logoRow.removeAttribute('data-window-drag')
      }
    }

    /**
     * 算出合并后那一行要往下挪多少，避开窗口左上角那三个「红绿灯」按钮。
     *
     * 怎么算的：官方原本是上下两条 —— 上面那条（topStrip）只放「收起侧栏」按钮，
     * 高度由官方样式定死；下面那条（logoRow）放品牌名。红绿灯占的是上面那条的位置。
     * 我们要把按钮挪到品牌那一行，就得知道品牌行「原本」在多高，
     * 然后让品牌行留在原位、按钮也挪到那个高度，两者就并成了一行，
     * 而且都在红绿灯下方。
     *
     * 注意：这个高度**只量一次，之后一直用缓存值**。
     *   为什么不每轮都量？因为一旦我们打了合并标记，品牌行的位置就被我们改过了，
     *   再拿改过的值去算，下一轮会算得更大、再下一轮更大 —— 一路往下跑。
     *   所以量的时候必须先把标记摘掉，量到「原始」位置，然后记住它。
     * @param {object} parts 侧栏的几个关键元素。
     * @returns {number} 品牌行原始高度（像素）。
     */
    function naturalLogoTop(parts) {
      if (cachedLogoTop !== null) return cachedLogoTop
      var had = parts.root.hasAttribute('data-dsp')
      if (had) parts.root.removeAttribute('data-dsp')
      var top = Math.ceil(parts.logoRow.offsetTop)
      if (had) parts.root.setAttribute('data-dsp', 'merged')
      // 量不到（比如测试环境没有排版引擎）就用官方布局算出来的理论值：
      // 顶栏 52 + 顶栏上边距 -6 + 品牌行上边距 -12 = 34。
      if (!(top > 0)) top = 34
      cachedLogoTop = top
      return top
    }

    /**
     * 把「往下挪多少」写进样式变量。
     * @param {object} parts 侧栏的几个关键元素。
     * @returns {void}
     */
    function measureTopShift(parts) {
      var value = naturalLogoTop(parts) + 'px'
      if (parts.root.style.getPropertyValue('--dsp-topshift') !== value) {
        parts.root.style.setProperty('--dsp-topshift', value)
      }
    }

    /**
     * 每轮检查：侧栏还在不在、我们画的东西还在不在，缺了就补上。
     * @param {object} ctx 客户端插件上下文。
     * @param {object} t 翻译函数。
     * @returns {void}
     */
    function ensureSidebar(ctx, t) {
      try {
        var parts = findSidebar()
        if (parts === null) return
        // 打上标记，上面那几条「顶栏合并」的样式才会生效。
        // 只在「展开」状态下合并：收成窄条时官方那套布局本来就对，不要动它。
        // 另外只有 macOS 版才有那条顶栏；没有它就没有可合并的对象，直接跳过。
        // 用属性选择器而不是直接改官方元素的 class，是为了不去动 React 管的东西。
        var want = isRail(parts.root) || parts.topStrip === null ? null : 'merged'
        if (want === null) {
          if (parts.root.hasAttribute('data-dsp')) parts.root.removeAttribute('data-dsp')
        } else if (parts.root.getAttribute('data-dsp') !== want) {
          parts.root.setAttribute('data-dsp', want)
        }
        if (want !== null) {
          measureTopGap(parts)
          // 摘掉「拖窗口把手」标记 —— 这是「收起按钮点不动」的真正修法。
          // 官方的 drag 规则权重比我们高，用样式覆盖不掉；直接把属性拿掉，
          // 那条规则就选不中它了，点击也就不再被吞。
          releaseDragHandle(parts)
        }
        // 先把「上一份」留下的重复节点清掉，再画。
        // 顺序很重要：先清后画，页面上就只会有一份；反过来会把自己刚画的删掉。
        dropStale(parts.root, '.dsp-col', injected.column)
        dropStale(parts.root, '.dsp-sects', sections.box)
        // 侧栏被收成窄条时，「置顶 / 项目」这两栏放不下，整个藏起来。
        // 注意这里用的是另一个标记 dsp-rail，和上面那个合并标记互不干扰：
        // 窄条时合并标记是关的，但这两个分区仍然需要知道自己该藏。
        var rail = isRail(parts.root)
        if (rail) {
          if (!parts.root.hasAttribute('data-dsp-rail')) parts.root.setAttribute('data-dsp-rail', '')
        } else if (parts.root.hasAttribute('data-dsp-rail')) {
          parts.root.removeAttribute('data-dsp-rail')
        }
        paintMenu(ctx, parts, t)
        paintSections(ctx, parts, t)
      } catch (error) {
        /* 界面在重建的瞬间可能取不到元素，下一轮再试即可 */
      }
    }

    //#endregion

    //#region 置顶 / 工作区 两个分区

    /**
     * 存「置顶了哪些工作区」以及它们的顺序，放在浏览器本地。
     * 这是本插件自己的偏好，不写进 DSH 的配置文件。
     */
    var PIN_KEY = 'dsh.sidebar-pro.pinned-workspaces'

    /**
     * 存「单独置顶了哪些对话」（只放对话编号，不放整个项目）。
     *
     * 为什么另开一个键，而不塞进上面那个？
     *   上面那个键里存的是**工作区编号**，两样东西混在一起就分不清了；
     *   而且旧版本的使用者本地已经有值，混着写会把旧数据弄坏。
     *   新键是空的时候一切照旧 —— 老使用者升级后不会看到任何变化。
     *
     * 顺序 = 显示顺序。新置顶的放在最前面（unshift），所以刚拖上去的那条
     * 一定出现在 Top 的最上面，一眼就能看到。
     */
    var PINNED_SESSIONS_KEY = 'dsh.sidebar-pro.pinned-sessions'

    /** 存「置顶里哪些文件夹是展开的」（记住，下次打开还是展开的）。 */
    var OPEN_KEY = 'dsh.sidebar-pro.open-folders'

    /**
     * 读出哪些文件夹是展开的。
     * @returns {object} 形如 { 工作区编号: true }。
     */
    function readOpenFolders() {
      var raw = readStored(OPEN_KEY, {})
      return raw !== null && typeof raw === 'object' ? raw : {}
    }

    /**
     * 记住某个文件夹的展开 / 收起。
     * @param {string} id 工作区编号。
     * @param {boolean} open 是否展开。
     * @returns {void}
     */
    function writeOpenFolder(id, open) {
      var raw = readStored(OPEN_KEY, {})
      if (open) raw[id] = true
      else delete raw[id]
      writeStored(OPEN_KEY, raw)
    }

    /** 存「两个分区各自是展开还是收起」。 */
    var FOLD_KEY = 'dsh.sidebar-pro.folds'

    /**
     * 上一次是从**哪一边**点开对话的：`'top'` 还是 `'project'`。
     *
     * 为什么要记这个？官方的选中底色跟着「当前打开的是哪个对话」走。
     * 从 Top 里点开一个对话时，底色会跑到 Project 列表里那一行上。
     * 规则是：**在哪边点的，高亮就留在哪边。**
     *
     * 故意**不写进浏览器本地**：刷新之后回到官方默认（显示在 Project 里），
     * 免得出现「高亮不见了，也不知道为什么」的状态。
     */
    var lastPick = { id: '', from: 'project' }

    /** 记着我们画出来的分区元素。 */
    var sections = {
      box: null,
      pinnedHead: null,
      pinnedLabel: null,
      pinnedList: null,
      pinnedInner: null,
      pinnedEmpty: null,
      projHead: null,
      projLabel: null,
      pinnedFolded: false,
      projFolded: false,
    }

    /**
     * 问官方要「技能 / 插件 / 自动化任务」这几个面板的显示名字。
     *
     * 为什么要问官方？因为这些名字会跟着语言变（中文「技能」/ 英文「Skill」），
     * 而且以后官方改名我们也自动跟着变，不用自己维护一份。
     * @returns {object} 名字表：{ 面板编号: 名字 }。
     */
    function readOfficialLabels() {
      var table = {}
      try {
        var rows = pluginCtx.slots.entriesOfSlot('sidebar.panellist')
        rows.forEach(function (entry) {
          var label = entry.options.label
          var text = typeof label === 'function' ? label() : label
          table[String(entry.options.id)] = text === undefined ? String(entry.options.id) : String(text)
        })
      } catch (error) {
        /* 取不到就留空，下一轮再试 */
      }
      return table
    }

    /**
     * 读一个存在浏览器本地的小对象。
     * @param {string} key 存的位置。
     * @param {object} fallback 读不到时用什么。
     * @returns {object} 读到的内容。
     */
    function readStored(key, fallback) {
      try {
        var raw = window.localStorage.getItem(key)
        if (raw === null || raw === '') return fallback
        var parsed = JSON.parse(raw)
        return parsed !== null && typeof parsed === 'object' ? parsed : fallback
      } catch (error) {
        return fallback
      }
    }

    /**
     * 往浏览器本地写一个小对象。
     * @param {string} key 存的位置。
     * @param {object} value 要存的内容。
     * @returns {void}
     */
    function writeStored(key, value) {
      try {
        window.localStorage.setItem(key, JSON.stringify(value))
      } catch (error) {
        /* 存不了就只在本次会话里生效，不影响使用 */
      }
    }

    /**
     * 读出置顶的工作区编号（顺序就是显示顺序）。
     * @returns {string[]} 工作区编号。
     */
    function readPins() {
      var raw = readStored(PIN_KEY, [])
      if (!Array.isArray(raw)) return []
      return raw.filter(function (id) {
        return typeof id === 'string' && id !== ''
      })
    }

    /**
     * 把置顶列表写回浏览器本地。
     * @param {string[]} ids 工作区编号。
     * @returns {void}
     */
    function writePins(ids) {
      writeStored(PIN_KEY, ids)
      sections.pinKeys = null
      // 立刻重画：置顶 / 取消置顶之后界面要马上变，不能等下一轮观察器。
      if (repaint !== null) repaint()
    }

    /**
     * 读出「单独置顶了哪些对话」（顺序就是显示顺序）。
     * @returns {string[]} 对话编号。
     */
    function readPinnedSessions() {
      var raw = readStored(PINNED_SESSIONS_KEY, [])
      if (!Array.isArray(raw)) return []
      return raw.filter(function (id) {
        return typeof id === 'string' && id !== ''
      })
    }

    /**
     * 把「单独置顶的对话」写回浏览器本地。
     * @param {string[]} ids 对话编号（顺序 = 显示顺序）。
     * @returns {void}
     */
    function writePinnedSessions(ids) {
      writeStored(PINNED_SESSIONS_KEY, ids)
      // 和 writePins 同一个手法：清掉缓存键，下一轮必须重画一遍。
      sections.pinKeys = null
      if (repaint !== null) repaint()
    }

    /**
     * 取消单独置顶一条对话。
     * @param {string} sessionId 对话编号。
     * @returns {void}
     */
    function unpinPinnedSession(sessionId) {
      writePinnedSessions(
        readPinnedSessions().filter(function (keep) {
          return keep !== String(sessionId)
        }),
      )
    }

    /**
     * 读出两个分区的展开 / 收起状态。
     * @returns {{pinned: boolean, projects: boolean}} true 表示收起。
     */
    function readFolds() {
      var raw = readStored(FOLD_KEY, {})
      return { pinned: raw.pinned === true, projects: raw.projects === true }
    }

    /**
     * 把某个分区的展开 / 收起状态记下来。
     * @param {string} name 'pinned' 或 'projects'。
     * @param {boolean} folded true 表示收起。
     * @returns {void}
     */
    function writeFold(name, folded) {
      var raw = readStored(FOLD_KEY, {})
      raw[name] = folded
      writeStored(FOLD_KEY, raw)
    }

    /**
     * 读出本机登记的所有「工作区」（DSH 里叫 workspace）。
     *
     * 为什么用 try 包起来？这两个数据来自别的插件，它们没准备好时
     * 取快照可能拿到空值甚至报错。宁可这一轮不画，也不能让整个侧栏崩掉。
     * @param {object} ctx 客户端插件上下文。
     * @returns {Array<{id: string, title: string, path: string, count: number}>} 工作区清单。
     */
    function readProjects(ctx) {
      try {
        // 用 ctx.get 而不是 ctx.workspaces：万一这个服务没起来，我们也只是画不出
        // 工作区列表，整个侧栏照样能用；写成硬依赖的话插件会直接加载失败。
        var service = ctx.get('workspaces')
        if (service === undefined || service === null || service.list === undefined) return []
        var snapshot = service.list.getSnapshot()
        var items = snapshot !== null && typeof snapshot === 'object' && Array.isArray(snapshot.items) ? snapshot.items : []
        return items.map(function (item) {
          var id = String(item.workspaceId)
          var title = item.title
          if (typeof title !== 'string' || title.trim() === '') {
            // 没有自定义名字就退回文件夹名（路径最后一段），再不行才用编号
            var path = typeof item.path === 'string' ? item.path : ''
            var pieces = path.split('/').filter(function (piece) {
              return piece !== ''
            })
            title = pieces.length > 0 ? pieces[pieces.length - 1] : id
          }
          return {
            id: id,
            title: String(title),
            path: typeof item.path === 'string' ? item.path : '',
            count: Array.isArray(item.sessionIds) ? item.sessionIds.length : 0,
            // 这个工作区下的会话清单（置顶后要能展开看到它们）
            sessions: readWorkspaceSessions(ctx, item),
          }
        })
      } catch (error) {
        return []
      }
    }

    /**
     * 取官方那份「每条对话现在什么状态」的表。
     *
     * 来源：官方客户端服务 `uiSession` 上公开的 `sessionStatus` 商店。
     * 它每次发布的每一条就是 `{ running, pendingInteraction, completionUnread }`
     * —— 官方侧栏那个状态点用的就是这三样（`completed = status.completionUnread === true`）。
     *
     * 为什么不是去调官方组件的 React hook？因为那是官方组件内部的东西，插件够不着；
     * 而这个商店挂在服务上，是公开的。取不到也只是退化成灰点，不会把插件弄崩。
     * @param {object} ctx 客户端插件上下文。
     * @returns {Map|null} 状态表（编号 → 状态）；取不到时是 null。
     */
    function readSessionStatuses(ctx) {
      try {
        var service = ctx.get('uiSession')
        var store = service === undefined || service === null ? undefined : service.sessionStatus
        if (store === undefined || store === null || typeof store.getSnapshot !== 'function') return null
        var snapshot = store.getSnapshot()
        return snapshot instanceof Map ? snapshot : null
      } catch (error) {
        return null
      }
    }

    /**
     * 取官方那份状态表里属于这一条对话的那一行记录。
     * @param {Map|null} statuses 官方状态表。
     * @param {object} summary 会话摘要。
     * @returns {object|null} `{ running, pendingInteraction, completionUnread }`；没有就是 null。
     */
    function sessionStatusOf(statuses, summary) {
      if (statuses === null || statuses === undefined) return null
      var status = statuses.get(String(summary.id))
      return status === undefined || status === null ? null : status
    }

    /**
     * 这条对话在等你做什么？（弹窗要你点「允许」、要你确认计划、要你回答）
     *
     * 官方的字段是 `pendingInteraction.kind`，只有这三种会弹东西出来等使用者操作，
     * 其余值（以及没有弹窗）一律当「没在等」。
     * @param {object|null} status 官方那行记录。
     * @returns {''|'approval'|'plan-review'|'question'} 等待类型；没在等就是空串。
     */
    function sessionWaitKindOf(status) {
      var pending = status === null || status === undefined ? undefined : status.pendingInteraction
      var kind = pending === null || pending === undefined ? undefined : pending.kind
      if (kind === 'approval' || kind === 'plan-review' || kind === 'question') return kind
      return ''
    }

    /**
     * 一条对话该显示什么颜色的状态点。
     *
     * 优先级**照着官方那一套来**（官方 sessionStatuses()：先看弹窗，再看跑没跑，再看完成没读）：
     *   ① 有弹窗在等你操作（审批 / 计划待审 / 等你回答）→ warning（**黄点**）
     *   ② 正在跑                                     → ongoing（蓝点）
     *   ③ 跑完还没看                                  → done（绿点）
     *   ④ 其余                                       → idle（灰点）
     *
     * 为什么「等你操作」排第一？那时候对话可能还在跑，但真正需要你动手的是那个弹窗 ——
     * 只有「有弹窗、需要填写东西、需要允许」的时候才用黄色。
     *
     * 拿不到官方状态表时只退化成「正在跑就蓝、其余灰」—— **绝不猜「未读」**：
     * 猜出来的绿点点开也不会消失，反而让人以为坏了（这就是它的原因）。
     * @param {Map|null} statuses 官方状态表。
     * @param {object} summary 会话摘要。
     * @returns {'warning'|'ongoing'|'done'|'idle'} 状态名。
     */
    function sessionStateOf(statuses, summary) {
      var status = sessionStatusOf(statuses, summary)
      if (sessionWaitKindOf(status) !== '') return 'warning'
      var running = status === null
        ? summary.running === true
        : status.running === true
      if (running) return 'ongoing'
      if (status !== null && status.completionUnread === true) return 'done'
      return 'idle'
    }

    /**
     * 读出一个工作区下的会话清单（用来在置顶里展开显示）。
     *
     * 数据从 sessions 服务拿：它有一份「按编号索引的会话表」，
     * 而工作区那边给了「我包含哪些会话编号」，两边一对就出来了。
     * @param {object} ctx 客户端插件上下文。
     * @param {object} workspace 工作区（带 sessionIds）。
     * @returns {Array<{id: string, title: string, running: boolean}>} 会话清单。
     */
    function readWorkspaceSessions(ctx, workspace) {
      try {
        var service = ctx.get('sessions')
        if (service === undefined || service === null || service.list === undefined) return []
        var snapshot = service.list.getSnapshot()
        if (snapshot === null || typeof snapshot !== 'object') return []
        var byId = snapshot.byId
        if (byId === null || typeof byId !== 'object') return []
        var ids = Array.isArray(workspace.sessionIds) ? workspace.sessionIds : []

        // 已归档的对话不在普通列表里显示
        var archived = []
        try {
          var wsSnapshot = ctx.get('workspaces').list.getSnapshot()
          if (Array.isArray(wsSnapshot.archivedSessionIds)) archived = wsSnapshot.archivedSessionIds
        } catch (error) {
          archived = []
        }

        // 官方那份「每条对话现在什么状态」的表（拿不到就是 null，退化成灰点）
        var statuses = readSessionStatuses(ctx)

        var out = []
        for (var index = 0; index < ids.length; index += 1) {
          var summary = byId[ids[index]]
          if (summary === undefined || summary === null) continue

          // ── 照抄官方的可见性规则（少一条就会出现多余的「未命名」）──
          // ① 子智能体派生的对话不显示
          if (summary.origin === 'subagent') continue
          // ② 空白会话不显示 —— 除非它就是当前打开的那条
          // Top 是「收藏夹」，不放还没起名字的新对话 ——
          // 官方允许「当前那条空白会话」显示（给新对话一个落脚点），
          // 但放进 Top 里就是一条莫名其妙的「未命名」。
          // 所以这里比官方更严格：空白的一律不显示。
          if (summary.blank === true) continue
          // ③ 已归档的不显示
          if (archived.indexOf(String(summary.id)) >= 0) continue

          var title = typeof summary.title === 'string' ? summary.title.trim() : ''

          // 状态点：直接用**官方那份精确状态**，和官方列表逐字一致
          //   有弹窗在等你（审批 / 计划待审 / 等你回答）→ warning（**黄点**）
          //   正在跑      → ongoing（蓝点呼吸）
          //   跑完还没看   → done（绿点，**一打开就消失**）
          //   其余        → idle（灰点）
          //
          // 数据来源：官方客户端服务 uiSession 公开的 sessionStatus 商店，
          // 每条记录就是 { running, pendingInteraction, completionUnread }。
          // 官方自己的绿点用的正是 completionUnread（见官方 workspace 插件里
          // `completed: status?.completionUnread === true`），而它会在「这条对话
          // 被主区域打开」时被官方清掉 —— 所以点开就变灰，和官方完全同步。
          // 黄点同理：官方对 `pendingInteraction.kind` 的三种值都返回 warning。
          //
          // ⚠️ 以前不是这么写的：以前是「不在运行 + 最近 3 分钟有过活动 → 绿点」的猜测。
          //    那个猜测根本不知道你读没读，所以点开也不会消失（实际使用中就是它）。
          var status = sessionStatusOf(statuses, summary)
          out.push({
            id: String(summary.id),
            title: title,
            state: sessionStateOf(statuses, summary),
            // 「在等你做什么」——悬停提示要说清是审批、确认计划还是回答，所以一并带上
            waitKind: sessionWaitKindOf(status),
          })
        }
        return out
      } catch (error) {
        return []
      }
    }

    /**
     * 算出「单独置顶的对话」要画成哪几行（已经过滤掉不该显示的）。
     *
     * 数据来源还是 `readProjects()` —— 它里面每个项目的 `sessions` 已经按官方的
     * 可见性规则过滤过（空白会话、子智能体、已归档都不在里面），状态点也算好了。
     * 所以这里只要把编号对回去，就不必再抄一遍过滤规则。
     *
     * 只有一种情况下这一条「不画」：对话已经不存在了（被删掉 / 被归档）——
     * 再画一行点开也没用。本地记录**不删**，万一它只是暂时读不到，下次还能回来。
     *
     * 注意：**不**因为「它所属的项目也置顶了」就不画。这里要的是「单独的那条对话上去」，
     * 这是一条独立快捷入口；项目文件夹展开时同一个标题可能出现两次，
     * 但那一行带着气泡图标、左边距也不同，意思是「置顶的对话」，不是重复项。
     * @param {Array<object>} projects 工作区清单（带 sessions）。
     * @returns {Array<object>} 每一行要用的信息。
     */
    function readPinnedSessionRows(projects) {
      var ids = readPinnedSessions()
      if (ids.length === 0) return []

      // 建一张「对话编号 → 它属于哪个项目」的表
      var byId = {}
      for (var i = 0; i < projects.length; i += 1) {
        var project = projects[i]
        if (!Array.isArray(project.sessions)) continue
        for (var j = 0; j < project.sessions.length; j += 1) {
          var session = project.sessions[j]
          if (session === null || session === undefined) continue
          byId[String(session.id)] = { session: session, project: project }
        }
      }

      var rows = []
      var seen = {}
      for (var k = 0; k < ids.length; k += 1) {
        var id = String(ids[k])
        // 同一个编号在本地被写了两遍也只画一行
        if (seen[id] === true) continue
        seen[id] = true
        var hit = byId[id]
        if (hit === undefined) continue
        rows.push({
          id: id,
          title: hit.session.title,
          state: hit.session.state,
          waitKind: hit.session.waitKind,
          projectId: hit.project.id,
          projectTitle: hit.project.title,
        })
      }
      return rows
    }

    /**
     * 造一个分区标题行。
     *
     * 这一行左边是名字、右边可能有个小按钮，整行点一下可以收起 / 展开下面的内容。
     * @param {string} text 标题文字。
     * @param {object|null} action 右侧小按钮的配置，不需要就传 null。
     * @param {Function} onToggle 点击标题时调用（用来收起 / 展开）。
     * @returns {object} 标题元素与它的零件。
     */
    function sectionHead(text, action, onToggle) {
      var row = document.createElement('div')
      row.className = 'dsp-sect'
      row.setAttribute('role', 'button')
      row.setAttribute('tabindex', '0')
      row.setAttribute('data-fold', 'false')
      // 点了会收起 / 展开下面的内容 → 手掌
      row.setAttribute('data-foldable', 'true')

      // 左边那个小三角：收起时朝右、展开时朝下
      var chev = document.createElement('span')
      chev.className = 'dsp-sect-chev'
      chev.innerHTML =
        '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
        ICONS.chevron +
        '</svg>'
      row.appendChild(chev)

      var label = document.createElement('span')
      label.className = 'dsp-sect-label'
      label.textContent = text
      row.appendChild(label)

      var button = null
      if (action !== null) {
        button = document.createElement('button')
        button.type = 'button'
        button.className = 'dsp-sect-act'
        button.setAttribute('title', action.title)
        button.setAttribute('aria-label', action.title)
        button.innerHTML =
          '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
          action.icon +
          '</svg>'
        button.addEventListener('click', function (event) {
          event.stopPropagation()
          action.onClick()
        })
        row.appendChild(button)
      }

      row.addEventListener('click', onToggle)
      row.addEventListener('keydown', function (event) {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onToggle()
        }
      })

      return { row: row, label: label, button: button }
    }

    /**
     * 造一行「单独置顶的对话」。
     *
     * 它和项目文件夹里的对话行长得像（同一个 `.dsp-sess` 外壳，状态点 / 归档按钮 /
     * 点击打开都一样），区别有三点：
     *   ① 左边多一个气泡图标、左边距更小（10px，和项目行对齐）——
     *      一眼能看出它是「Top 里的一条对话」，不是某个文件夹里的子项；
     *   ② 右边多一个「取消置顶」的叉按钮；
     *   ③ 悬停提示带上所属项目名（Top 里光看标题可能想不起它是哪个项目的）。
     *
     * 为什么复用 `.dsp-sess` 这个类？因为高亮（syncTopSelection）、自己实现的拖拽
     * （sessionRowFrom 认 `data-sess`）都按这个类名找行；复用之后这些行为自动就有了。
     * @param {object} entry 一条置顶对话：编号 / 标题 / 状态 / 所属项目。
     * @param {object} options 回调（打开 / 归档 / 取消置顶）与文案。
     * @param {Function} t 翻译函数。
     * @returns {object} 这一行的元素。
     */
    function pinnedSessionRow(entry, options, t) {
      var row = document.createElement('div')
      row.className = 'dsp-sess dsp-pinsess'
      row.setAttribute('data-sess', entry.id)
      row.setAttribute('data-pinsess', 'true')
      // 点了就是打开对话，不能展开 → 手指（但可以拖动，光标由 .dsp-sess 那条规则管）
      row.setAttribute('data-foldable', 'false')
      row.setAttribute('role', 'button')
      row.setAttribute('tabindex', '0')

      var title = entry.title === '' ? t('untitled') : entry.title
      // 悬停提示：对话标题 · 所属项目。项目名单独放在后面，不占行内宽度。
      row.setAttribute('title',
        entry.projectTitle === '' ? title : title + ' · ' + entry.projectTitle)

      // 左边的气泡图标：和「项目文件夹」区分开
      var glyph = document.createElement('span')
      glyph.className = 'dsp-pinsess-ico'
      glyph.innerHTML =
        '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
        'stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
        ICONS.chat +
        '</svg>'
      row.appendChild(glyph)

      // 状态点：规则和文件夹里的对话完全一致（见 sessionStateOf）
      var dot = document.createElement('span')
      dot.className = 'dsp-sess-dot'
      dot.setAttribute('data-state', entry.state)
      dot.setAttribute('title',
        entry.state === 'warning'
          ? (entry.waitKind === 'approval' ? t('stateWaitingApproval')
            : entry.waitKind === 'plan-review' ? t('stateWaitingPlan')
              : t('stateWaitingAnswer'))
          : entry.state === 'ongoing' ? t('stateRunning')
            : entry.state === 'done' ? t('stateDone')
              : t('stateIdle'))
      row.appendChild(dot)

      var text = document.createElement('span')
      text.className = 'dsp-sess-title'
      text.textContent = title
      row.appendChild(text)

      // 「归档」按钮：和项目文件夹里的对话行保持一致
      if (typeof options.onArchive === 'function') {
        var archBtn = document.createElement('button')
        archBtn.type = 'button'
        archBtn.className = 'dsp-sess-arch'
        archBtn.setAttribute('title', options.archiveTitle)
        archBtn.setAttribute('aria-label', options.archiveTitle)
        archBtn.innerHTML =
          '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
          'stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
          ICONS.archive +
          '</svg>'
        archBtn.addEventListener('click', function (event) {
          // 别让点击冒泡到整行 —— 那会变成「打开这条对话」
          event.stopPropagation()
          event.preventDefault()
          options.onArchive(entry.id)
        })
        row.appendChild(archBtn)
      }

      // 「取消置顶」：单独置顶的对话用这个叉送回去。
      // 样式直接复用项目行那个叉（.dsp-pin-back），大小 / 对齐完全一样。
      if (typeof options.onUnpin === 'function') {
        var unpinBtn = document.createElement('button')
        unpinBtn.type = 'button'
        unpinBtn.className = 'dsp-pin-back'
        unpinBtn.setAttribute('title', t('unpinSession'))
        unpinBtn.setAttribute('aria-label', t('unpinSession'))
        unpinBtn.innerHTML =
          '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
          'stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
          ICONS.circleX +
          '</svg>'
        unpinBtn.addEventListener('click', function (event) {
          // 别让点击冒泡到整行 —— 那会变成「打开这条对话」
          event.stopPropagation()
          event.preventDefault()
          options.onUnpin(entry.id)
        })
        row.appendChild(unpinBtn)
      }

      var open = function () {
        // 在 Top 里点的 → 高亮留在 Top（和文件夹里的对话同一套规则）
        lastPick.from = 'top'
        lastPick.id = entry.id
        if (repaint !== null) repaint()
        try {
          options.onOpenSession(entry.id)
        } catch (error) {
          /* 会话没了就不做事 */
        }
      }
      row.addEventListener('click', function (event) {
        event.stopPropagation()
        open()
      })
      row.addEventListener('keydown', function (event) {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          open()
        }
      })

      return row
    }

    /**
     * 造一行「工作区」。
     *
     * 这一行可以拖动 —— 拖到「置顶」区就置顶，在置顶区里上下拖就调整顺序。
     * 注意：官方的工作区行本身也支持拖拽，我们不去改它，只是**额外**允许
     * 我们画出来的这些行被拖。
     * @param {object} project 工作区信息。
     * @param {object} options 配置：是否在置顶区、回调等。
     * @returns {object} 这一行元素。
     */
    function workspaceRow(project, options, t) {
      // 一整块：上面是「文件夹」那一行，下面是可以展开的会话清单
      var wrap = document.createElement('div')
      wrap.className = 'dsp-pinwrap'
      wrap.setAttribute('data-ws', project.id)

      var row = document.createElement('div')
      row.className = 'dsp-pin'
      row.setAttribute('role', 'button')
      row.setAttribute('tabindex', '0')
      row.setAttribute('title', project.path === '' ? project.title : project.path)
      row.setAttribute('data-ws', project.id)
      // 能展开里面的对话 → 手掌
      row.setAttribute('data-foldable', 'true')

      // 置顶区里的行可以拖动排序；工作区列表里的行可以拖去置顶
      row.setAttribute('draggable', 'true')

      // 左边那个小三角：点它（或整行）展开 / 收起里面的会话
      var chev = document.createElement('span')
      chev.className = 'dsp-pin-chev'
      chev.innerHTML =
        '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
        ICONS.chevron +
        '</svg>'
      row.appendChild(chev)

      var glyph = document.createElement('span')
      glyph.className = 'dsp-ico'
      glyph.innerHTML =
        '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
        // 统一用「文件夹」图标。
        // 之前置顶项用的是「钉子」，设计要求去掉 ——
        // 区块标题已经写着 top，不需要再靠钉子强调一遍。
        ICONS.folder +
        '</svg>'
      row.appendChild(glyph)

      var label = document.createElement('span')
      label.className = 'dsp-label'
      label.textContent = project.title
      row.appendChild(label)

      // 置顶项右边那个「移回工作区」按钮。
      // 设计要求：从工作区拖上来的项目，要能一键送回去（不用再手动拖）。
      // 只有置顶区里的项才有这个按钮。
      if (options.pinned === true && typeof options.onUnpin === 'function') {
        var backBtn = document.createElement('button')
        backBtn.type = 'button'
        backBtn.className = 'dsp-pin-back'
        backBtn.setAttribute('title', t('unpinBack'))
        backBtn.setAttribute('aria-label', t('unpinBack'))
        backBtn.innerHTML =
          '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
          'stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
          ICONS.circleX +
          '</svg>'
        backBtn.addEventListener('click', function (event) {
          // 别让点击冒泡到整行（那会触发展开/收起）
          event.stopPropagation()
          event.preventDefault()
          options.onUnpin()
        })
        row.appendChild(backBtn)
      }

      wrap.appendChild(row)

      // ── 展开 / 收起里面的会话 ──
      var list = document.createElement('div')
      list.className = 'dsp-sesslist'
      // 里面包一层装内容：量高度要量它（list 自己的高度由我们控制，量不准）
      var listInner = document.createElement('div')
      listInner.className = 'dsp-sesslist-inner'
      list.appendChild(listInner)
      var expanded = options.expanded === true
      var applyFold = function () {
        wrap.setAttribute('data-expanded', expanded ? 'true' : 'false')
        setAttr(row, 'data-expanded', expanded ? 'true' : 'false')
        // 高度由 JS 直接设（和 Top / Project / More 用同一个工具）。
        //
        // ⚠️ 量的必须是「装内容的那一层」，不能量 list 自己 ——
        //    list 的高度正被我们控制，展开瞬间它可能还是 0，
        //    量出来就是 0 → 设成 0 → **对话被压没了，而且再也长不回来**。
        applyFoldHeight(list, listInner, !expanded)
      }

      var toggle = function () {
        expanded = !expanded
        applyFold()
        if (typeof options.onToggle === 'function') options.onToggle(project.id, expanded)
      }

      // 点整行 = 展开 / 收起（**不再新建对话**）
      row.addEventListener('click', toggle)
      row.addEventListener('keydown', function (event) {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          toggle()
        }
      })

      // 会话清单：每一项点开就是那个对话
      project.sessions.forEach(function (session) {
        var item = document.createElement('div')
        item.className = 'dsp-sess'
        // 记下这条对话的编号：高亮要按编号对上（见 syncTopSelection）
        item.setAttribute('data-sess', session.id)
        // 点了就是打开对话，不能展开 → 手指（但可以拖动，见下面）
        item.setAttribute('data-foldable', 'false')
        // 可以拖回 Project —— 和「拖对话到 Top」对称：
        // 拖的是**它所属的整个工作区**，不是单条对话。
        item.setAttribute('draggable', 'true')
        item.setAttribute('role', 'button')
        item.setAttribute('tabindex', '0')
        item.setAttribute('title', session.title === '' ? t('untitled') : session.title)
        if (session.running) item.setAttribute('data-running', 'true')

        var dot = document.createElement('span')
        dot.className = 'dsp-sess-dot'
        dot.setAttribute('data-state', session.state)
        // 悬停时告诉使用者这个点是什么意思（不然没人看得懂）。
        // 黄点还要说清「在等你做什么」—— 是批准、确认计划，还是回答一个问题。
        dot.setAttribute('title',
          session.state === 'warning'
            ? (session.waitKind === 'approval' ? t('stateWaitingApproval')
              : session.waitKind === 'plan-review' ? t('stateWaitingPlan')
                : t('stateWaitingAnswer'))
            : session.state === 'ongoing' ? t('stateRunning')
              : session.state === 'done' ? t('stateDone')
                : t('stateIdle'))
        item.appendChild(dot)

        var text = document.createElement('span')
        text.className = 'dsp-sess-title'
        text.textContent = session.title === '' ? t('untitled') : session.title
        item.appendChild(text)

        // 「归档」按钮 —— 「在 top 栏无法归档」就是少了它。
        // 官方 Project 列表里鼠标划到对话行也会冒出这个按钮，这里保持一致。
        if (typeof options.onArchive === 'function') {
          var archBtn = document.createElement('button')
          archBtn.type = 'button'
          archBtn.className = 'dsp-sess-arch'
          archBtn.setAttribute('title', options.archiveTitle)
          archBtn.setAttribute('aria-label', options.archiveTitle)
          // 图标 14px，和 Top 那个「叉」按钮里的图标一样大
          archBtn.innerHTML =
            '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
            ICONS.archive +
            '</svg>'
          archBtn.addEventListener('click', function (event) {
            // 别让点击冒泡到整行 —— 那会变成「打开这条对话」
            event.stopPropagation()
            event.preventDefault()
            options.onArchive(session.id)
          })
          item.appendChild(archBtn)
        }

        var open = function () {
          // 在 Top 里点的 → 高亮留在 Top（见 lastPick 的说明）
          lastPick.from = 'top'
          lastPick.id = session.id
          // 立刻重画一次：万一点的是「已经打开着」的那个对话，官方那边不会有任何 DOM 变化，
          // 观察器就不会醒，高亮也就搬不过来。
          if (repaint !== null) repaint()
          try {
            // 打开这个对话（不是新建）。
            // 这里用传进来的回调，而不是直接碰 ctx ——
            // workspaceRow 是底层函数，拿不到外层的 ctx（硬写会抛异常、还被吞掉）。
            options.onOpenSession(session.id)
          } catch (error) {
            /* 会话没了就不做事 */
          }
        }
        item.addEventListener('click', function (event) {
          event.stopPropagation()
          open()
        })
        item.addEventListener('keydown', function (event) {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            open()
          }
        })

        // 拖动这条对话 = 把它所属的**整个工作区**拖回 Project。
        // 和「从 Project 拖一条对话到 Top」完全对称（那边带的也是工作区编号），
        // 所以 Project 那边的接收逻辑一个字都不用改。
        bindFresh(item, 'dragstart', 'sessOut', function (event) {
          event.stopPropagation()
          event.dataTransfer.effectAllowed = 'move'
          setWorkspaceDragPayload(event.dataTransfer, project.id)
          sections.dragging = project.id
          item.setAttribute('data-dragging', 'true')
        })
        bindFresh(item, 'dragend', 'sessOutEnd', function () {
          item.removeAttribute('data-dragging')
          sections.dragging = null
          clearDropMarks()
        })

        listInner.appendChild(item)
      })

      if (project.sessions.length === 0) {
        var none = document.createElement('div')
        none.className = 'dsp-sess-none'
        none.textContent = t('noSessions')
        listInner.appendChild(none)
      }

      wrap.appendChild(list)

      // ⚠️ 这一步**必须**放在 wrap.appendChild(list) 之后，不能提前。
      //
      // 为什么？applyFoldHeight 开头有一句
      //     if (el.parentNode === null) return
      // 在 list 还没挂到 wrap 上之前，list.parentNode 是 null，
      // 那句就直接返回了 —— 结果「收起的文件夹」永远拿不到 height:0px，
      // 它会按内容的真实高度占着位置（虽然 opacity:0 看不见）。
      //
      // 后果：「加一个多会话的项目就卡一下」就是这个原因。
      //   · 一个收起状态的文件夹，如果有 5 条对话，就会凭空占掉 130 多像素；
      //   · 置顶栏整体高度按「看不见的内容」算 → 侧栏被撑高一大截、
      //     下面的工作区列表被挤扁，加项目时整块布局猛地跳一下；
      //   · 展开文件夹时高度早就被占好了 → 画面不动，看起来像「没展开」。
      // 放到 appendChild 之后，收起的文件夹才会真正拿到 height:0px。
      applyFold()

      // 拖动还是挂在「文件夹那一行」上
      row.addEventListener('dragstart', function (event) {
        event.dataTransfer.effectAllowed = 'move'
        setWorkspaceDragPayload(event.dataTransfer, project.id)
        row.setAttribute('data-dragging', 'true')
        sections.dragging = project.id
        // 让「置顶区」知道自己正在被拖东西过来（配合淡底色提示）
        if (sections.box !== null) sections.box.setAttribute('data-dragging', 'true')
        // 整页锁成「拳头」，尽量在拖动期间保持捏住的手感
      })
      row.addEventListener('dragend', function () {
        row.removeAttribute('data-dragging')
        sections.dragging = null
        if (sections.box !== null) sections.box.removeAttribute('data-dragging')
        clearDropMarks()
      })
      if (options.pinned) {
        row.addEventListener('dragover', function (event) {
          event.preventDefault()
          event.dataTransfer.dropEffect = 'move'
          if (sections.dragging === null || sections.dragging === project.id) return
          var rect = row.getBoundingClientRect()
          var after = event.clientY > rect.top + rect.height / 2
          clearDropMarks()
          row.setAttribute('data-drop', after ? 'after' : 'before')
        })
        row.addEventListener('dragleave', function () {
          row.removeAttribute('data-drop')
        })
        row.addEventListener('drop', function (event) {
          event.preventDefault()
          var moving = sections.dragging
          if (moving === null || moving === project.id) return
          var rect = row.getBoundingClientRect()
          var after = event.clientY > rect.top + rect.height / 2
          options.onReorder(moving, project.id, after)
          clearDropMarks()
        })
      }

      return wrap
    }

    /**
     * 清掉所有「将要落在这里」的提示线。
     * @returns {void}
     */
    function clearDropMarks() {
      if (sections.box === null) return
      var marked = sections.box.querySelectorAll('[data-drop]')
      for (var index = 0; index < marked.length; index += 1) marked[index].removeAttribute('data-drop')
    }

    /**
     * 把**整条侧栏里所有**落点标记都清掉（保证同一时刻只有一条线）。
     * @returns {void}
     */
    function clearEveryDropMark() {
      var scope = document.querySelector('[data-slot="sidebar"]')
      if (scope === null) return
      var marked = scope.querySelectorAll('[data-drop],[data-out-drop]')
      for (var index = 0; index < marked.length; index += 1) {
        marked[index].removeAttribute('data-drop')
        marked[index].removeAttribute('data-out-drop')
      }
    }

    /**
     * 画（或重画）「置顶 / 工作区」这两栏。
     *
     * 做法说明（重要）：
     *   官方那个会话列表是 React 画的，里面每一行都挂着点击、拖拽、右键菜单，
     *   我们**一行都不搬、不删**。这里只做两件事：
     *     1. 在列表上方插入我们自己的「置顶」标题和置顶的快捷入口；
     *     2. 把官方那个「工作区」标题文字换成我们自己的写法（含收起箭头）。
     *   这样官方列表的一切行为都不受影响，定时任务插件挂在会话行上的小图标也不会丢。
     * @param {object} ctx 客户端插件上下文。
     * @param {object} parts 侧栏的几个关键元素。
     * @param {object} t 翻译函数。
     * @returns {void}
     */
    /**
     * 切换「置顶栏」的展开 / 收起。
     *
     * 为什么抽成一个函数？因为有两个入口要用它：
     *   ① 点「top」这几个字
     *   ② 点右边那个往下滑的小按钮
     * 两处必须走同一套逻辑，否则状态会打架。
     * @returns {void}
     */
    function togglePinnedFold() {
      sections.pinnedFolded = !sections.pinnedFolded
      writeFold('pinned', sections.pinnedFolded)
      // 立刻把高度改过来，不等重画（重画要等观察器醒，可能等不到）
      if (sections.pinnedList !== null) {
        var list = sections.pinnedList
        // ① 打上「使用者点过了」的开关：样式表里高度过渡挂在 [data-dsp-anim="true"] 上，
        //    这样页面刚加载、插件第一次把高度量出来那一下不会做动画（否则会先滑开一下）。
        list.setAttribute('data-dsp-anim', 'true')
        // ② 顺序很重要：**先**把 data-folded 改过来，**再**动高度。
        //    样式表里「展开」和「收起」用的是两套过渡参数，靠 data-folded 区分；
        //    如果先改高度、属性下一帧才跟上，这一次动画就会沿用旧的那套参数 ——
        //    展开却用了收起的加速曲线，表现就是「点下去先愣一下才动」。
        list.setAttribute('data-folded', sections.pinnedFolded ? 'true' : 'false')
        if (sections.pinnedFolded) {
          // ③ 收起：先钉住「现在有多高」，再改成 0。
          //    为什么不能直接写 0px？展开状态下高度是 auto，auto → 0px 浏览器没法补间
          //    （不知道起点），会「啪」地一下消失。
          //    这里读一次 offsetHeight 逼浏览器把「现在的高度」认成动画起点，
          //    然后在同一个任务里写 0 —— 点下去立刻就开始收，不用等下一帧。
          var nowHeight = Math.round(list.getBoundingClientRect().height)
          if (nowHeight > 0) {
            list.style.height = nowHeight + 'px'
            void list.offsetHeight
            list.style.height = '0px'
          } else {
            list.style.height = '0px'
          }
        } else {
          var natural = sections.pinnedInner === null ? 0 : sections.pinnedInner.scrollHeight
          list.style.height = natural > 0 ? natural + 'px' : ''
        }
      }
      if (repaint !== null) repaint()
    }

    function paintSections(ctx, parts, t) {
      if (parts.regionArea === null || parts.regionArea.parentNode === null) return

      var folds = readFolds()
      sections.pinnedFolded = folds.pinned
      sections.projFolded = folds.projects

      // 先建好容器（只在第一次建，之后复用）
      if (sections.box === null || sections.box.parentNode === null) {
        var box = document.createElement('div')
        box.className = 'dsp-sects'

        // 设计要求：Top 右边那个箭头删掉，不需要。
        // 展开 / 收起还是点标题文字本身（左边那个小三角也照样能点）。
        var pinnedHead = sectionHead(t('pinned'), null, togglePinnedFold)
        // 打个标记，样式表据此给 Top 单独上色、放大字号
        pinnedHead.row.setAttribute('data-top', 'true')
        box.appendChild(pinnedHead.row)

        var pinnedList = document.createElement('div')
        pinnedList.className = 'dsp-pinlist'
        // 同样包一层（折叠动画的要求）
        var pinnedInner = document.createElement('div')
        pinnedInner.className = 'dsp-pinlist-inner'
        pinnedList.appendChild(pinnedInner)
        box.appendChild(pinnedList)

        sections.box = box
        sections.pinnedHead = pinnedHead.row
        sections.pinnedLabel = pinnedHead.label
        sections.pinnedList = pinnedList
        sections.pinnedInner = pinnedInner
      }

      // 插到官方列表前面
      if (sections.box.parentNode !== parts.regionArea.parentNode || sections.box.nextElementSibling !== parts.regionArea) {
        parts.regionArea.parentNode.insertBefore(sections.box, parts.regionArea)
      }

      // 文案每轮对齐（切语言时跟着变）
      setText(sections.pinnedLabel, t('pinned'))
      setAttr(sections.pinnedHead, 'title', sections.pinnedFolded ? t('expandPinned') : t('collapsePinned'))
      setAttr(sections.pinnedHead, 'aria-expanded', sections.pinnedFolded ? 'false' : 'true')
      setAttr(sections.pinnedHead, 'data-fold', sections.pinnedFolded ? 'true' : 'false')
      // 用属性而不是 display 来收起 —— display 没法做过渡动画。
      setAttr(sections.pinnedList, 'data-folded', sections.pinnedFolded ? 'true' : 'false')

      // 工作区清单 + 置顶清单
      var projects = readProjects(ctx)
      var byId = {}
      projects.forEach(function (project) {
        byId[project.id] = project
      })
      var pins = readPins().filter(function (id) {
        return byId[id] !== undefined
      })
      var openFolders = readOpenFolders()

      // 「单独置顶的对话」——排在置顶项目**上面**。
      //
      // 为什么放最上面？从 Project 拖到 Top 时，拖的是对话就只让那一条上去；
      // 单条对话也放在 TOP 栏更靠上的位置。
      // 单条对话是「最直接的快捷入口」，比整个项目更需要一点就开；
      // 而且刚拖上去的那条用 unshift 放在最前，松手立刻能在 Top 的头部看到它，
      // 不用去某个文件夹里翻。
      var pinnedSessionRows = readPinnedSessionRows(projects)

      // ── 置顶那几条 ──
      // 只按「置顶清单」判断要不要重画，不能按子节点数量判断，
      // 否则「重画 → 数量又变 → 再重画」会变成死循环，把 CPU 烧满。
      // 这个键（wantKeys）决定「要不要重画」，必须包含所有会显示出来的信息：
      //   · 单独置顶对话的编号 / 状态 / 所属项目 / **标题**（改标题要跟着变）；
      //   · 每个置顶项目里有哪些对话、它们的状态和标题；
      //   · 项目自己的标题。
      // 少一样就会出现「改了名字 / 新增了对话，Top 却还是旧的」——
      // 实际使用中「不同步」就是只放了编号导致的。
      var wantKeys = 'S:' + JSON.stringify(pinnedSessionRows.map(function (entry) {
        return [entry.id, entry.state, entry.projectId, entry.projectTitle, entry.title]
      })) + '\u0000' + JSON.stringify(pins.map(function (id) {
        var project = byId[id]
        if (project === undefined || !Array.isArray(project.sessions)) return [id]
        return [id, project.title].concat(project.sessions.map(function (session) {
          return [session.id, session.state, session.title]
        }))
      }))
      if (sections.pinKeys !== wantKeys) {
        sections.pinKeys = wantKeys
        // 注意：这里用 sections.pinnedInner，不能用上面那个局部变量 pinnedInner。
        // 局部变量只在「第一次创建 box」时才有值；之后每次重画它都是 undefined，
        // 一碰就抛异常（被外层 try 吞掉），界面就静默失效了 —— 这个坑踩过。
        var pinBox = sections.pinnedInner
        // 先把旧的「单独置顶对话」行收掉。
        // 它们没有包裹层（一行就是一个 .dsp-pinsess），所以单独删。
        var oldSessions = pinBox.querySelectorAll('.dsp-pinsess')
        for (var s = 0; s < oldSessions.length; s += 1) pinBox.removeChild(oldSessions[s])
        // 注意删的是「包裹层」.dsp-pinwrap，不是里面的行 .dsp-pin。
        // 之前写错了：删行会留下空壳，重画几次就叠出一堆重复的。
        var old = pinBox.querySelectorAll('.dsp-pinwrap')
        for (var index = 0; index < old.length; index += 1) pinBox.removeChild(old[index])
        // ① 先画单独置顶的对话（在 Top 最上面）
        pinnedSessionRows.forEach(function (entry) {
          pinBox.appendChild(
            pinnedSessionRow(entry, {
              archiveTitle: t('archiveSession'),
              onArchive: function (sessionId) {
                archiveSessionFromTop(ctx, parts, sessionId)
              },
              onOpenSession: function (sessionId) {
                // 点它 = 打开那一条对话（不是新建）
                try {
                  ctx.uiWorkspace.openSession(sessionId)
                } catch (error) {
                  /* 会话没了就不做事 */
                }
              },
              onUnpin: function (sessionId) {
                // 叉掉 = 只取消这一条对话的置顶（项目本身不受影响）
                unpinPinnedSession(sessionId)
              },
            }, t),
          )
        })
        // ② 再画置顶的项目文件夹（顺序和以前完全一样）
        pins.forEach(function (id) {
          var project = byId[id]
          pinBox.appendChild(
            workspaceRow(project, {
              pinned: true,
              unpinTitle: t('pinRemove'),
              expanded: openFolders[id] === true,
              onToggle: function (wsId, open) {
                // 点文件夹 = 展开 / 收起里面的对话（**不新建对话**）
                writeOpenFolder(wsId, open)
                if (repaint !== null) repaint()
              },
              onOpenSession: function (sessionId) {
                // 点里面的对话 = 打开那个对话
                try {
                  ctx.uiWorkspace.openSession(sessionId)
                } catch (error) {
                  /* 会话没了就不做事 */
                }
              },
              archiveTitle: t('archiveSession'),
              onArchive: function (sessionId) {
                archiveSessionFromTop(ctx, parts, sessionId)
              },
              onUnpin: function () {
                writePins(
                  readPins().filter(function (keep) {
                    return keep !== id
                  }),
                )
              },
              onReorder: function (movingId, targetId, after) {
                var next = readPins().filter(function (keep) {
                  return keep !== movingId
                })
                var at = next.indexOf(targetId)
                if (at < 0) return
                next.splice(after ? at + 1 : at, 0, movingId)
                writePins(next)
              },
            }, t),
          )
        })
      }

      // ── 空状态提示 ──
      // 现在 Top 里可能有两种东西：单独置顶的对话、置顶的项目。
      // 两样都空才显示「拖至此处置顶」。
      if (pins.length === 0 && pinnedSessionRows.length === 0) {
        if (sections.pinnedEmpty === null) {
          sections.pinnedEmpty = document.createElement('div')
          sections.pinnedEmpty.className = 'dsp-empty'
        }
        setText(sections.pinnedEmpty, t('pinNoneHint'))
        if (sections.pinnedEmpty.parentNode !== sections.pinnedInner) sections.pinnedInner.appendChild(sections.pinnedEmpty)
      } else if (sections.pinnedEmpty !== null && sections.pinnedEmpty.parentNode !== null) {
        sections.pinnedEmpty.parentNode.removeChild(sections.pinnedEmpty)
      }

      // ── 让置顶区本身可以「接住」拖进来的工作区 ──
      // 这就是「把工作区拖到置顶栏就置顶」的实现。
      // 用 bindFresh 绑定：热更新后旧实例的监听会被自动换掉。
      // （之前用「DOM 标记」判断是否绑过 —— 标记还在、监听器却是旧实例的，
      //   新实例就跳过绑定，拖进去没反应。这个坑踩过。）
      {
        var onOver = function (event) {
          event.preventDefault()
          event.dataTransfer.dropEffect = 'move'
          // 整块套框（不管从哪个方向拖，Top 都显示成一个完整的落点区）
          if (sections.box !== null) sections.box.setAttribute('data-over', 'true')

          // 再画一条蓝线，指明「会插到哪两项之间」——
          // 这样「工作区 → Top」和「Top → 工作区」两个方向的提示是一致的。
          var rows = sections.pinnedInner === null
            ? []
            : sections.pinnedInner.querySelectorAll('.dsp-pin')
          var target = null
          for (var i = 0; i < rows.length; i += 1) {
            var rect = rows[i].getBoundingClientRect()
            if (rect.height <= 0) continue
            if (event.clientY >= rect.top && event.clientY <= rect.bottom) {
              target = rows[i]
              break
            }
          }
          clearDropMarks()
          if (target !== null) {
            var tr = target.getBoundingClientRect()
            target.setAttribute('data-drop', event.clientY > tr.top + tr.height / 2 ? 'after' : 'before')
          }
        }
        var onLeave = function (event) {
          // 只在真正离开这一块时才取消高亮
          if (sections.box !== null && !sections.box.contains(event.relatedTarget)) {
            sections.box.removeAttribute('data-over')
            sections.box.removeAttribute('data-over-folded')
          }
        }
        var onDrop = function (event) {
          event.preventDefault()
          if (sections.box !== null) {
            sections.box.removeAttribute('data-over')
            sections.box.removeAttribute('data-over-folded')
          }
          // 先读我们自己的类型，再退回 text/plain（见 DRAG_TYPE 的注释）
          var id = readWorkspaceDragPayload(event.dataTransfer)
          if (typeof id !== 'string' || id === '') return
          // 只有真的存在这个工作区才置顶，避免把随便什么拖进来的东西记进去
          var known = readProjects(ctx).some(function (project) {
            return project.id === id
          })
          if (!known) return
          var current = readPins()
          if (current.indexOf(id) >= 0) return
          writePins(current.concat([id]))
        }
        bindFresh(sections.pinnedList, 'dragover', 'pinOver', onOver)
        bindFresh(sections.pinnedList, 'dragleave', 'pinLeave', onLeave)
        bindFresh(sections.pinnedList, 'drop', 'pinDrop', onDrop)
        bindFresh(sections.pinnedHead, 'dragover', 'pinHeadOver', onOver)
        bindFresh(sections.pinnedHead, 'dragleave', 'pinHeadLeave', onLeave)
        bindFresh(sections.pinnedHead, 'drop', 'pinHeadDrop', onDrop)
      }

      // ── 把置顶项拖出去 = 取消置顶 ──
      // 设计要求去掉那个小叉按钮，所以「取消置顶」就靠把这一行拖到
      // 置顶区外面（也就是拖到下面的工作区列表上）来完成。
      // 这里给下面的列表挂一个接收口：只要拖的是置顶里的项，松手就取消置顶。
      // 「已绑定」标记记在节点上（box 会被重建，用全局变量会漏绑）
      // 「已绑定」标记记在节点上（box 会被重建，用全局变量会漏绑）
      {


        // 画 / 清落点线的小工具
        var clearOut = function () {
          var marked = parts.root.querySelectorAll('[data-out-drop]')
          for (var i = 0; i < marked.length; i += 1) marked[i].removeAttribute('data-out-drop')
        }
        // 找出鼠标底下那个工作区行，并在它身上画线。
        // 注意要排除置顶区里的行（那些是 dsp-pin，不是官方工作区行）。
        var paintOut = function (clientY) {
          var rows = parts.root.querySelectorAll('[data-row-key^="workspace:"]')
          var target = null
          for (var i = 0; i < rows.length; i += 1) {
            // 只认官方工作区列表里的行，跳过置顶区自己的
            if (parts.root.querySelector('.dsp-sects') !== null &&
                parts.root.querySelector('.dsp-sects').contains(rows[i])) continue
            var rect = rows[i].getBoundingClientRect()
            if (rect.height <= 0) continue
            if (clientY >= rect.top && clientY <= rect.bottom) {
              target = rows[i]
              break
            }
          }
          clearOut()
          if (target !== null) {
            var tr = target.getBoundingClientRect()
            target.setAttribute('data-out-drop', clientY > tr.top + tr.height / 2 ? 'after' : 'before')
          }
        }
        var onDropOut = function (event) {
          event.preventDefault()
          clearOut()
          if (sections.box !== null) sections.box.removeAttribute('data-out')
          if (parts.regionArea !== null) parts.regionArea.removeAttribute('data-dsp-in')
          var id = sections.dragging
          if (id === null || id === undefined) return
          // 处理完**必须立刻清空**「正在拖的是谁」。
          // 不清的话，事件冒泡会让别的监听器又拿到同一个编号再处理一遍，
          // 结果把不相干的项也一起取消了。
          sections.dragging = null
          writePins(
            readPins().filter(function (keep) {
              return keep !== id
            }),
          )
        }

        // 拖动经过侧栏时：判断鼠标是否已经到了「工作区」那一块。
        // 用整条侧栏监听，而不是只监听工作区那一小块 ——
        // 因为从置顶往下拖时，鼠标要先穿过置顶区，
        // 而置顶区自己会把 dragover 吃掉，事件传不到下面（这就是落点线不出现的原因）。
        bindFresh(parts.root, 'dragover', 'outOver', function (event) {
          var region = parts.regionArea
          if (region === null) return
          var rr = region.getBoundingClientRect()
          var inside = event.clientY >= rr.top && event.clientY <= rr.bottom

          // ① 「白光」：只要拖东西经过工作区那一块就亮 —— 和 Top 的提示对称。
          //    这一句**不看拖的是什么**（从 Top 拖回来、拖一个项目进来都算），
          //    而且故意**不 preventDefault** —— 那会抢掉官方自己那套「拖动工作区排序」的默认行为。
          if (inside) region.setAttribute('data-dsp-in', 'true')
          else region.removeAttribute('data-dsp-in')

          // ② 下面这些是「从 Top 往外拖」时才做的：置顶区变淡 + 工作区里画落点线。
          //    这两件事要接管默认行为，所以必须 preventDefault，因此只在我们自己发起的拖拽里做。
          if (sections.dragging === null) return
          event.preventDefault()
          event.dataTransfer.dropEffect = 'move'
          if (sections.box !== null) {
            if (inside) sections.box.setAttribute('data-out', 'true')
            else sections.box.removeAttribute('data-out')
          }
          paintOut(event.clientY)
        })
        bindFresh(parts.root, 'dragleave', 'outLeave', function (event) {
          if (parts.root.contains(event.relatedTarget)) return
          if (sections.box !== null) sections.box.removeAttribute('data-out')
          if (parts.regionArea !== null) parts.regionArea.removeAttribute('data-dsp-in')
          clearOut()
        })
        bindFresh(parts.root, 'drop', 'outDrop', function (event) {
          if (sections.dragging === null) return
          // 判定「松手时是不是落在工作区那一块」。
          //
          // 为什么不看 dragover 时算好的标记？
          //   因为置顶区自己的 dragleave / dragend 会在鼠标经过时把它清掉，
          //   等 drop 落地时标记已经没了 —— 拖回去就失效了（就是这个 bug）。
          //   所以这里当场按坐标判断，不依赖那个易被清掉的标记。
          // 两个信号满足**任意一个**就算「落回工作区」：
          //   ① dragover 时算好的标记（data-out）—— 正常情况靠它
          //   ② 松手时的鼠标位置 —— 万一标记被别的监听器提前清掉（拖拽事件
          //      顺序不总是可预测），还有这个兜底
          // 只用其中一个都不够稳：单靠标记会被清掉，单靠坐标在测试环境里量不准。
          var region = parts.regionArea
          if (region === null) return
          var flagged = sections.box !== null && sections.box.getAttribute('data-out') === 'true'
          var rr = region.getBoundingClientRect()
          var inRegion = event.clientY >= rr.top && event.clientY <= rr.bottom
          if (!flagged && !inRegion) return
          onDropOut(event)
        })
        bindFresh(parts.root, 'dragend', 'outEnd', function () {
          if (sections.box !== null) sections.box.removeAttribute('data-out')
          if (parts.regionArea !== null) parts.regionArea.removeAttribute('data-dsp-in')
          clearOut()
        })
      }

      // ── 让官方那一行「工作区」标题也能收起 / 展开 ──
      // 我们不新建标题，只把官方那一行接过来：点它就收起下面的会话列表，
      // 但**放大镜和另外两个按钮留在原地照常能点**（它们在同一行里）。
      bindProjectsHead(parts, ctx, t)
      // 让官方的对话行也能拖到 Top（拖的是整个工作区）
      bindSessionDrag(parts, ctx)
      // 官方「项目 → 对话」的展开收起，给它加一段高度动画
      // 拖项目（工作区）时，在 Project 里画**我们自己**那条落点线。
      //
      // 为什么必须挂在项目行自己身上？
      //   官方的项目行 dragover 里有一句 `e.stopPropagation()` —— 挂在侧栏根节点上的监听
      //   根本收不到事件（第一版就写错了，那版是死代码）。
      //   挂在**同一个元素**上的监听不受 stopPropagation 影响，所以只能这么做。
      bindProjectDropLine(parts, ctx)
      bindOfficialRowFold(parts)
      // 选中灰底放哪边：在 Top 里点的就留在 Top，在 Project 里点的就留在 Project
      syncTopSelection(parts)

      // 量高度必须放在「内容都画完」之后 ——
      // 之前放在前面，空提示文字还没插进去就量了，量到的值偏小，
      // 展开时会「差一截」。
      //
      // 置顶列表：按收起状态直接设高度。
      //
      // 但有一种情况必须跳过 ——「展开着、而且高度已经是 auto」：
      //   height 是 auto 时，容器本来就会跟着里面的内容实时长高，不用我们插手。
      //   硬写一个像素值反而会把高度**锁死在「量到的那一刻」**：
      //   展开一个多会话文件夹时，动画刚开始量到的高度接近 0，
      //   于是容器被锁成很矮的一条，里面的对话被 overflow:hidden 裁掉，
      //   要等 260 毫秒后放开成 auto 才「啪」地弹出来 ——
      //   使用者看到的就是「点开它却还是收着的、还卡一下」。
      //
      // 只有「正在做折叠动画」（高度是个具体像素值）时才需要写。
      // ⚠️ 这条判断**只作用于置顶栏**：More 分组和置顶项里的子列表仍旧
      //    照原样调用 applyFoldHeight，它们的动画一个字都没动。
      var pinnedAuto = sections.pinnedList !== null && sections.pinnedList.style.height === ''
      if (sections.pinnedFolded || !pinnedAuto) {
        applyFoldHeight(sections.pinnedList, sections.pinnedInner, sections.pinnedFolded)
      }
      setDisplay(sections.box, '')
    }

    /**
     * 把官方那一行「工作区」标题接过来，让它可点、可收起。
     *
     * 为什么要接官方的而不是自己画一行？
     *   那一行里除了标题，右边还有「放大镜」「视图选项」「添加工作区」三个按钮，
     *   自己画一行就得把按钮也重做一遍，还容易把官方的行为弄坏。
     *   这里只是给官方那一行加个点击响应，别的一概不动。
     * @param {object} parts 侧栏的几个关键元素。
     * @param {object} t 翻译函数。
     * @returns {void}
     */
    /** 「顶栏留空」那组测量的缓存：键一样就直接用上次结果，不再读尺寸。 */
    var topGapCache = { key: '', width: 0 }

    /**
     * 取一个「侧栏宽度」的缓存键。
     *
     * 为什么不用 getBoundingClientRect？因为它会强制浏览器同步重排。
     * 这里改用 clientWidth —— 它读的是已经算好的值，**不触发重排**，便宜得多。
     * @param {object} parts 侧栏的关键元素。
     * @returns {string} 缓存键。
     */
    function sidebarWidthCacheKey(parts) {
      if (parts.root === null) return '0'
      // clientWidth 不触发重排（getBoundingClientRect 会），性能好很多
      var w = parts.root.clientWidth || 0
      return String(Math.round(w))
    }

    function measureTopGap(parts) {
      if (parts.topStrip === null || parts.logoRow === null) return

      // ⚡ 缓存：同一宽度下这些值不会变，没必要每轮都量。
      //    （读尺寸 = 强制浏览器同步重排，动画期间每帧一次就是灾难。）
      //    用「侧栏宽度 + 是否窄条」当缓存键；变了才重量一次。
      var railNow = isRail(parts.root)
      var cacheKey = sidebarWidthCacheKey(parts) + '|' + (railNow ? '1' : '0')
      if (topGapCache.key === cacheKey) return
      topGapCache.key = cacheKey

      var width = Math.ceil(parts.topStrip.getBoundingClientRect().width)
      // 量不到（比如刚渲染、元素还没排版）就先给个保底值，别把品牌文字压没
      if (!(width > 0)) width = 92
      var value = width + 14 + 'px'
      if (parts.root.style.getPropertyValue('--dsp-topgap') !== value) {
        parts.root.style.setProperty('--dsp-topgap', value)
      }
      measureTopShift(parts)
    }

    /**
     * 按「展开 / 收起」设置一个容器的高度。
     *
     * 三处折叠（Top / Project / More）都用它，保证行为完全一致。
     *
     * 为什么要做「值没变就不写」的判断？
     *   这个函数在**每轮重画时都会被调用**，而重复写 style.height 会
     *   **打断正在进行的过渡动画**、让它重新开始 —— 表现就是卡顿、抖动。
     *
     * 为什么比的是「高度值」而不是「展开状态」？
     *   首次重画时内容可能还没排版，scrollHeight 量到 0；
     *   下一帧再量就是真实高度了。如果只比状态，第二次就会被提前 return 挡住，
     *   高度永远停在 0（这个坑很隐蔽）。
     * @param {HTMLElement} el 要设高度的容器。
     * @param {HTMLElement} inner 量高度用的内层（装内容的那个）。
     * @param {boolean} folded true 表示收起。
     * @returns {void}
     */
    function applyFoldHeight(el, inner, folded) {
      if (el === null || el === undefined) return
      if (el.parentNode === null) return

      var timerKey = '__dspFoldTimer'
      if (el[timerKey] !== undefined && el[timerKey] !== null) {
        window.clearTimeout(el[timerKey])
        el[timerKey] = null
      }

      // 清掉可能残留的 max-height（之前那版用过），避免两套属性打架
      el.style.maxHeight = ''

      if (folded) {
        // 收起：先把上限设成当前高度，下一帧再归零 —— 这样才有「收起来」的过渡。
        // （直接从 none 跳到 0 是没法动画的，浏览器不知道起点是多少。）
        if (el.style.height === '0px') return
        var fromHeight = el.getBoundingClientRect().height
        if (!(fromHeight > 0)) {
          el.style.height = '0px'
          return
        }
        el.style.height = fromHeight + 'px'
        afterStyleSettles(function () {
          el.style.height = '0px'
        })
        return
      }

      // 展开：上限从 0 长到「足够大」。
      //
      // 为什么用 max-height 而不是 height？
      //   height 是「我占这么多」（固定值）→ 动画期间挤压邻居 → 结束后才恢复，
      //   使用者感觉「延迟恢复」。
      //   max-height 是「我最多占这么多」（上限）→ 内容长多少就占多少，
      //   邻居**实时**让位，没有延迟。
      //
      // 为什么设成内容高度的 2 倍 + 200？
      //   过渡需要两个具体数字。设太小会「提前停住」，设太大动画会显得太快。
      //   2 倍多一点是经验值，既够用又不影响观感。
      var natural = inner === null ? 0 : inner.scrollHeight
      if (!(natural > 0)) {
        // 内容还没排版（量不到高度）—— 先放开，等下一轮再量
        el.style.height = ''
        return
      }
      if (el.style.height === natural + 'px') return
      el.style.height = natural + 'px'
      // 动画结束后放开成 none —— 这样内容之后再变（比如展开项目里的对话）也不受限制。
      // 记下这一轮设的值，只有值没变才放开（期间使用者又点了就不动）。
      var expected = el.style.height
      el[timerKey] = window.setTimeout(function () {
        el[timerKey] = null
        if (el.style.height === expected) el.style.height = ''
      }, 260)
    }

    /**
     * 让「先设起点、再设终点」这段真的产生过渡动画。
     *
     * 为什么要等两帧？
     *   浏览器要先把「起点值」算进样式，之后改终点值才会产生过渡。
     *   只等一帧的话，起点和终点会在同一帧里一起变 —— 浏览器只看到最终值，
     *   于是直接跳过去，没有动画（这就是「收起时太生硬」的原因）。
     *   等两帧：第一帧起点生效，第二帧再改终点，过渡就出来了。
     * @param {Function} apply 真正改终点值的操作。
     * @returns {void}
     */
    function afterStyleSettles(apply) {
      window.requestAnimationFrame(function () {
        window.requestAnimationFrame(apply)
      })
    }

    /**
     * 按「展开 / 收起」把工作区那块的外观改过来。
     *
     * 为什么单独抽出来？因为点击的时候要**立刻**看到效果，
     * 不能干等「下一轮重画」—— 重画要等页面观察器醒过来，
     * 而它不监听属性变化，可能一直不醒（那就是「点了没反应」）。
     * @param {object} parts 侧栏的关键元素。
     * @param {boolean} folded true 表示收起。
     * @returns {void}
     */
    function applyProjectsFold(parts, folded) {
      if (parts.regionArea === null) return
      // 只改一个属性，剩下的全交给样式表 —— JS 一行代码，动画由 CSS 负责。
      if (parts.root === null) return
      setAttr(parts.root, 'data-dsp-projfold', folded ? 'true' : 'false')
    }

    /**
     * 让官方的「对话行」也能拖到 Top 里。
     *
     * 设计要求：拖单独一条对话到 Top，应该把它**所属的整个工作区**拖进去
     * （因为 Top 里放的就是工作区，不是单条对话）。
     *
     * 做法：给每条对话行补上「可拖动」，拖动时把「它属于哪个工作区」放进拖拽数据。
     * 这样 Top 那边的接收逻辑一个字都不用改 —— 它收到的还是工作区编号。
     * @param {object} parts 侧栏的关键元素。
     * @param {object} ctx 客户端插件上下文。
     * @returns {void}
     */
    function bindSessionDrag(parts, ctx) {
      if (parts.regionArea === null) return

      // 先问出「哪条对话属于哪个工作区」。
      // 这个映射每轮都要重算（工作区会变），所以不缓存。
      var ownerOf = {}
      var projects = readProjects(ctx)
      for (var i = 0; i < projects.length; i += 1) {
        var project = projects[i]
        if (!Array.isArray(project.sessions)) continue
        for (var j = 0; j < project.sessions.length; j += 1) {
          ownerOf[project.sessions[j].id] = project.id
        }
      }

      // 在官方的对话行上点一下 → 高亮回到 Project 这边（和 Top 那边对称）
      bindFresh(parts.regionArea, 'click', 'sessPick', function (event) {
        var node = event.target
        while (node !== null && node !== undefined && node !== parts.regionArea) {
          if (node.nodeType === 1 && typeof node.getAttribute === 'function') {
            var key = node.getAttribute('data-row-key')
            if (key !== null && key.indexOf('session:') === 0) {
              lastPick.from = 'project'
              lastPick.id = String(key).slice('session:'.length)
              if (repaint !== null) repaint()
              return
            }
          }
          node = node.parentNode
        }
      })

      var rows = parts.regionArea.querySelectorAll('[data-row-key^="session:"]')
      for (var k = 0; k < rows.length; k += 1) {
        var row = rows[k]
        var sessionId = String(row.getAttribute('data-row-key')).slice('session:'.length)
        var workspaceId = ownerOf[sessionId]
        // 找不到归属就不给它加拖拽（免得拖了个不知道去哪的东西）
        if (workspaceId === undefined) continue

        row.setAttribute('draggable', 'true')

        // 用闭包把当前归属固定下来（不要用循环变量，那样会串）
        var bind = function (element, owner) {
          // 用 bindFresh：同一个元素上归属变了（换工作区）也能正确换掉旧监听
          bindFresh(element, 'dragstart', 'sessDrag', function (event) {
            event.dataTransfer.effectAllowed = 'move'
            // 关键：写进去的是**工作区编号**，不是对话编号 ——
            // 这样 Top 那边就当成「拖了个工作区进来」，整块一起置顶。
            setWorkspaceDragPayload(event.dataTransfer, owner)
            sections.dragging = owner
              if (sections.box !== null) sections.box.setAttribute('data-dragging', 'true')
          })
          bindFresh(element, 'dragend', 'sessDragEnd', function () {
            sections.dragging = null
              if (sections.box !== null) {
              sections.box.removeAttribute('data-dragging')
              sections.box.removeAttribute('data-out')
            }
            clearDropMarks()
          })
        }
        bind(row, workspaceId)
      }
    }

    /** 官方「归档会话 / 取消归档」两个按钮的文案（缓存；取到就不再问）。 */
    var archiveLabelCache = null

    /**
     * 取官方那个「归档会话」按钮的 aria-label 文案。
     *
     * 为什么不写死中文？因为那是**官方画的按钮**，它的 aria-label 跟着界面语言变
     * （中文「归档会话」、英文 "Archive session"…）。写死中文的话，一换语言就找不到它了。
     * 官方的文案注册在 `workspace` 这个语言命名空间里，直接 bind 过来即可；
     * 万一取不到（比如官方改了命名空间），再退回中英两套写死的值。
     * @returns {string[]} 可能出现的文案（只要匹配上其中一个就算找到）。
     */
    function officialArchiveLabels() {
      if (archiveLabelCache !== null) return archiveLabelCache
      var out = ['归档会话', '取消归档', 'Archive session', 'Unarchive session']
      try {
        var official = pluginCtx.locale.bind('workspace')
        var push = function (key) {
          var value = official(key)
          if (typeof value === 'string' && value !== '' && value !== key && out.indexOf(value) < 0) out.push(value)
        }
        push('menu.archiveSession')
        push('menu.unarchiveSession')
      } catch (error) {
        /* 取不到就用上面写死的那几套 */
      }
      archiveLabelCache = out
      return out
    }

    /**
     * 从 Top 里归档 / 取消归档一条对话。
     *
     * 「在 top 栏无法归档」：Top 里那些行是我们自己画的，官方 Project 列表里
     * 鼠标划到对话行会冒出一个「归档」小按钮，我们这边以前没有。
     *
     * 首选：找到官方列表里同一行，**点它那个按钮** —— 走的是官方原路，
     *       连「这条对话还在跑，要不要先停掉再归档」的确认弹窗都一并带上，最稳。
     * 兜底：官方列表为了省地方只画前几条对话（`COLLAPSED_SESSION_LIMIT`），超出的那些
     *       在页面里根本没有对应行。这时直接调官方暴露的服务 `uiWorkspace.archiveSession()`
     *       —— 官方那个按钮点下去，最终也是调它。
     * @param {object} ctx 客户端插件上下文。
     * @param {object} parts 侧栏的几个关键元素。
     * @param {string} sessionId 要归档的对话编号。
     * @returns {void}
     */
    function archiveSessionFromTop(ctx, parts, sessionId) {
      if (parts.regionArea !== null) {
        var rows = parts.regionArea.querySelectorAll('[data-row-key^="session:"]')
        var want = 'session:' + sessionId
        for (var i = 0; i < rows.length; i += 1) {
          if (rows[i].getAttribute('data-row-key') !== want) continue
          var labels = officialArchiveLabels()
          var buttons = rows[i].querySelectorAll('button')
          for (var j = 0; j < buttons.length; j += 1) {
            var label = String(buttons[j].getAttribute('aria-label') || '')
            if (labels.indexOf(label) >= 0) {
              try {
                buttons[j].click()
                return
              } catch (error) {
                /* 点不动就走下面的兜底 */
              }
            }
          }
          break
        }
      }
      try {
        if (ctx !== null && ctx.uiWorkspace !== undefined &&
            typeof ctx.uiWorkspace.archiveSession === 'function') {
          ctx.uiWorkspace.archiveSession(sessionId)
        }
      } catch (error) {
        /* 归档不了也不能把侧栏弄崩，安静算了 */
      }
    }

    /**
     * 决定「选中的灰底」显示在哪一边 —— Top 里，还是官方 Project 列表里。
     *
     * 背景：
     *   Top 里那些置顶项目是我们自己画的，官方 Project 列表是官方画的。
     *   官方的灰底跟着「当前打开的是哪个对话」走，所以我们从 **Top** 里点开一个对话时，
     *   灰底会出现在 **Project** 里对应的那一行 —— 使用者看着就像「点错地方了」。
     *   规则是：**在哪边点的，高亮就留在哪边。**
     *
     * 做法（每轮重画时算一次，很便宜）：
     *   1. 读官方那一行谁带 aria-selected="true" —— 它就是「当前打开的那个对话」。
     *      为什么不自己记状态？因为「打开的是哪个对话」由官方管着，自己记迟早对不上。
     *   2. 在我们 Top 的行里找同一个编号，给它打 data-active="true"。
     *   3. 只有「这次是从 Top 点的」**而且**「这个对话确实在 Top 里画出来了」两条都成立，
     *      才给侧栏打 data-dsp-seltop="true" 把官方那边的灰底压掉。
     *      第二条是保险：万一那个对话后来被取消置顶了，Top 里没有对应行，
     *      这时候要是还把官方灰底压掉，就会出现「哪边都没高亮」的怪状态。
     * @param {object} parts 侧栏的几个关键元素。
     * @returns {void}
     */
    function syncTopSelection(parts) {
      if (parts.root === null || parts.regionArea === null) return

      // 官方那条「选中的行」是首选依据（它代表官方认定的当前对话）。
      var id = ''
      var selected = parts.regionArea.querySelector('[data-row-key^="session:"][aria-selected="true"]')
      if (selected !== null) id = String(selected.getAttribute('data-row-key')).slice('session:'.length)
      // ⚠️ 但官方列表只画「前几条」对话，超出的那些根本没有 DOM ——
      //    这时候从 Top 点开一个靠后的对话，官方那边找不到选中的行。
      //    所以官方找不到时，退回用「使用者最后在 Top 里点的那个编号」。
      if (id === '' && lastPick.from === 'top') id = lastPick.id

      var rows = sections.pinnedInner === null ? [] : sections.pinnedInner.querySelectorAll('.dsp-sess')
      var hit = null
      for (var i = 0; i < rows.length; i += 1) {
        // 不用拼 CSS 选择器（对话编号里可能有特殊字符），直接逐个比属性，最稳
        var same = id !== '' && rows[i].getAttribute('data-sess') === id
        if (same) hit = rows[i]
        // 灰底只在「这次是从 Top 点的」时候画在 Top 这边；
        // 从 Project 点的话，灰底归 Project（官方自己会画），Top 这边不画。
        setAttr(rows[i], 'data-active', same && lastPick.from === 'top' ? 'true' : 'false')
      }

      var keepInTop = lastPick.from === 'top' && hit !== null
      setAttr(parts.root, 'data-dsp-seltop', keepInTop ? 'true' : 'false')
    }

    /**
     * 给官方「项目 → 对话」的展开 / 收起加一段高度动画。
     *
     * 为什么这里要写 JS，而 More / Project 那两处只改样式就行？
     *   官方这个展开是 React **直接把对话行插进 / 移出 DOM** 的（点一行就是把
     *   显示条数从「只显示前几条」放开成「全显示」），容器高度是 auto。
     *   auto → auto 之间 CSS 没法做过渡（浏览器不知道起点终点是多少），
     *   所以只能我们自己来：先把旧高度钉住、等 React 换完 DOM 再动画到新高度。
     *
     * 时序（三段，都在几帧内完成）：
     *   ① 点下去这一瞬间：React 还没改，量到的是旧高度 → 先把容器钉在旧高度上
     *      （不钉的话，React 换 DOM 的那一帧高度会直接跳过去，就没得动画了）
     *   ② 等两帧（React 提交完成）→ 量新高度：先放开成 auto 量一下、再钉回去，
     *      同一帧内做完，所以不会闪
     *   ③ 用 Web Animations 从旧高度动画到新高度，播完把 inline 样式清干净
     *
     * 用 `element.animate()` 而不是写 `style.transition` 的原因：
     *   WAAPI 的动画不吃 inline 样式，不会被 React 重绘 style 属性时擦掉；
     *   而且随时能 `cancel()`，连点也不会卡在半个高度上。
     * @param {object} parts 侧栏的几个关键元素。
     * @returns {void}
     */
    /**
     * 给 Project 里的每个「项目行」挂上拖拽落点线（画我们自己的那条）。
     *
     * 背景：拖动 project 下面的主文件夹时没有落点线，只有拖动对话才有。
     *   项目行那条线以前是**官方**画的（`workspaceDropBefore`），我们把它关掉之后没人画了；
     *   而我们自己的线（`data-out-drop`）以前只在「从 Top 拖回」时才画。
     *   这里补上：**拖项目时也画**，而且画在行内部（不会压到别的项目）。
     *
     * 为什么不用事件委托？因为官方项目行的 dragover 会 `stopPropagation()`，
     * 冒泡到不了外层容器 —— 只能逐个行挂。
     * @param {object} parts 侧栏的关键元素。
     * @returns {void}
     */
    /**
     * 把一条对话移到**另一个项目**里。
     *
     * 背景：项目下面的对话可以被拖到另一个项目里（拖到那个项目的上面或下面都行），
     * 不限于同一个项目内部。
     *
     * 官方的拖拽只支持**同一个项目内**重排对话（它内部用 `sameGroupDrag` 判断），
     * 跨项目时它会直接忽略。所以这里自己调官方接口：
     *   `workspaces.insertSessionBefore(目标项目, 对话编号, 锚点对话编号)`
     *   —— 锚点传 `undefined` 表示追加到那个项目的末尾。
     *
     * 怎么判断「这次是跨项目移动」？
     *   拖的是对话 + 松手时鼠标落在**另一个项目的行**上（不是对话行）。
     * @param {object} ctx 客户端插件上下文。
     * @param {object} parts 侧栏的关键元素。
     * @param {Event} event drop 事件。
     * @returns {boolean} 真的执行了移动就返回 true。
     */
    function moveSessionAcrossProjects(ctx, parts, event) {
      if (parts.regionArea === null) return false
      var dragging = draggingWorkspaceId
      if (typeof dragging !== 'string' || dragging.indexOf('session:') !== 0) return false
      var sessionId = dragging.slice('session:'.length)
      if (sessionId === '') return false

      // 松手时鼠标落在哪个项目行上？
      var targetProject = null
      var projects = readProjects(ctx)
      for (var i = 0; i < projects.length; i += 1) {
        var project = projects[i]
        var row = parts.regionArea.querySelector('[data-row-key="workspace:' + project.id + '"]')
        if (row === null) continue
        var rect = row.getBoundingClientRect()
        if (rect.height <= 0) continue
        if (event.clientY >= rect.top && event.clientY <= rect.bottom) {
          targetProject = project
          break
        }
      }
      if (targetProject === null) return false

      // 同一个项目 → 交给官方（它本来就支持项目内重排），这里不动
      var owner = ownerWorkspaceOf(sessionId)
      if (owner === targetProject.id) return false

      var service = null
      try {
        service = ctx.get('workspaces')
      } catch (error) {
        service = null
      }
      if (service === null || service === undefined || typeof service.insertSessionBefore !== 'function') return false

      // 锚点：如果鼠标落在项目行的上半部分 → 插到那个项目第一条对话前面；
      //       下半部分 → 追加到末尾（锚点传 undefined）。
      var rowEl = parts.regionArea.querySelector('[data-row-key="workspace:' + targetProject.id + '"]')
      var half = 'after'
      if (rowEl !== null) {
        var rr = rowEl.getBoundingClientRect()
        half = event.clientY > rr.top + rr.height / 2 ? 'after' : 'before'
      }
      var anchorId
      if (half === 'before' && Array.isArray(targetProject.sessions) && targetProject.sessions.length > 0) {
        anchorId = targetProject.sessions[0].id
      }

      Promise.resolve()
        .then(function () {
          return service.insertSessionBefore(targetProject.id, sessionId, anchorId)
        })
        .then(function () {
          if (repaint !== null) repaint()
        })
        .catch(function () {
          /* 移动失败就算了，别把侧栏弄崩 */
        })
      return true
    }

    function bindProjectDropLine(parts, ctx) {
      if (parts.regionArea === null) return

      /**
       * 按鼠标位置算出「应该标在哪一行、标在上边还是下边」。
       *
       * 为什么要按坐标算，而不是直接用事件目标？
       *   因为拖动项目时，dragover 的 target 可能是外层 groupSection，
       *   也可能是项目行自己 —— 结构不稳定。按 Y 坐标找最近的项目行最可靠。
       * @param {number} clientY 鼠标纵坐标。
       * @returns {HTMLElement|null} 命中的项目行。
       */
      /**
       * 按鼠标位置找「对话行」。
       * @param {number} clientY 鼠标纵坐标。
       * @returns {HTMLElement|null} 命中的对话行。
       */
      /**
       * 查一条对话属于哪个项目（工作区）。
       *
       * 数据来源：工作区列表里每个工作区带着自己的 sessionIds，
       * 反过来建一张「对话 → 项目」的表即可。
       * @param {string} sessionId 对话编号。
       * @returns {string} 项目编号；查不到就是空串。
       */
      var ownerWorkspaceOf = function (sessionId) {
        if (sessionId === '' || sessionId === undefined || sessionId === null) return ''
        var projects = readProjects(ctx)
        for (var i = 0; i < projects.length; i += 1) {
          var ids = projects[i].sessions
          if (!Array.isArray(ids)) continue
          for (var j = 0; j < ids.length; j += 1) {
            if (String(ids[j].id) === String(sessionId)) return projects[i].id
          }
        }
        return ''
      }

      /**
       * 一行代表哪条对话（两栏都要认）。
       *
       * Project 里的对话是官方的行（`data-row-key="session:…"`），
       * Top 里的对话是我们自己画的（`class="dsp-sess" data-sess="…"`）。
       * TOP 栏和 Project 栏的逻辑保持一致。
       * @param {Element} row 行元素。
       * @returns {string} 对话编号；不是对话行就返回空串。
       */
      var sessionIdOfRow = function (row) {
        if (row === null || row === undefined || typeof row.getAttribute !== 'function') return ''
        var key = String(row.getAttribute('data-row-key') || '')
        if (key.indexOf('session:') === 0) return key.slice('session:'.length)
        var own = row.getAttribute('data-sess')
        return typeof own === 'string' ? own : ''
      }

      /**
       * 一行代表哪个项目（两栏都要认）。
       * @param {Element} row 行元素。
       * @returns {string} 项目编号；不是项目行就返回空串。
       */
      var workspaceIdOfRow = function (row) {
        if (row === null || row === undefined || typeof row.getAttribute !== 'function') return ''
        var key = String(row.getAttribute('data-row-key') || '')
        if (key.indexOf('workspace:') === 0) return key.slice('workspace:'.length)
        var own = row.getAttribute('data-ws')
        return typeof own === 'string' ? own : ''
      }

      /** 画落点时扫的整块范围：Top 和 Project 都要算进去。 */
      var markScope = function () {
        return parts.root === null ? parts.regionArea : parts.root
      }

      /** 按纵坐标找一条「对话行」（两栏都找）。 */
      var sessionRowAt = function (clientY) {
        var scope = markScope()
        if (scope === null) return null
        var rows = scope.querySelectorAll('[data-row-key^="session:"],.dsp-sess[data-sess]')
        for (var i = 0; i < rows.length; i += 1) {
          if (sessionIdOfRow(rows[i]) === '') continue
          // 「单独置顶的对话」不当插入位置：
          //   它只是一个快捷入口，不属于哪一栏的列表；把它当落点会让对话
          //   被塞进它所属的项目，而且那个项目不在 Top 里时顺序表是残缺的。
          //   （拖它自己当源不受影响，这里只管「落在谁身上」。）
          if (rows[i].getAttribute('data-pinsess') === 'true') continue
          var rect = rows[i].getBoundingClientRect()
          if (rect.height <= 0) continue
          if (clientY >= rect.top && clientY <= rect.bottom) return rows[i]
        }
        return null
      }

      /** 按纵坐标找一行「项目行」（两栏都找）。 */
      var rowAt = function (clientY) {
        var scope = markScope()
        if (scope === null) return null
        var rows = scope.querySelectorAll('[data-row-key^="workspace:"],.dsp-pin[data-ws]')
        for (var i = 0; i < rows.length; i += 1) {
          if (workspaceIdOfRow(rows[i]) === '') continue
          var rect = rows[i].getBoundingClientRect()
          if (rect.height <= 0) continue
          if (clientY >= rect.top && clientY <= rect.bottom) return rows[i]
        }
        return null
      }

      /**
       * 画线（只在拖的是项目时）。
       * @param {Event} event dragover 事件。
       * @returns {void}
       */
      var paint = function (event) {
        // 判断「正在拖的是不是项目」。
        //
        // 两个信号，任一成立即可（都是只读、都不碰官方状态）：
        //   ① draggingWorkspaceId —— 在 document 捕获阶段从 dragstart 记下来的；
        //   ② sections.dragging —— 我们自己从 Top 拖下来时设的。
        //
        // ⚠️ 千万不能用「sections.dragging !== null」单独判断拖对话 —— 拖**对话**时它
        //    也会被设成「这条对话所属的项目编号」，那样拖对话就会多画一条线，
        //    和官方那条 Y 字线叠成两条（踩过）。
        //    所以第 ② 条只在我们**确认是从 Top 拖的**时才用（见下面 outOver 的调用）。
        if (draggingWorkspaceId === null || draggingWorkspaceId === '') return

        // ── 关键限制：落点只能画在「同一类、同一项目」里 ──
        //
        // 同一个项目下的对话只在该项目内显示落点。
        // 也就是说：把「学习项目」里的对话拖到「默认工作区」上面时，**不该出现落点**
        // （那里根本放不进去，显示落点等于骗人）。
        //
        // 怎么判断「是不是同一个项目」？看拖起来的那一行它属于哪个项目：
        //   · 拖的是**对话** → 它所属的项目 = 那行往上找最近的 groupSection 里的项目行；
        //   · 拖的是**项目**   → 项目之间可以互换位置，所以任意项目行都能当落点。
        // draggingWorkspaceId 现在存的是**完整 key**（`workspace:xxx` 或 `session:xxx`），
        // 这样才能区分「拖的是项目还是对话」。
        var dragKind = draggingWorkspaceId.indexOf('session:') === 0 ? 'session' : 'workspace'
        var dragSessionId = dragKind === 'session' ? draggingWorkspaceId.slice('session:'.length) : ''
        var dragOwner = dragSessionId === '' ? '' : ownerWorkspaceOf(dragSessionId)

        var row = null
        if (dragKind === 'workspace') {
          // 拖项目：落点可以是任意项目行
          row = rowAt(event.clientY)
        } else {
          // 拖对话：两种落点都允许 ——
          //   ① 同一个项目里的**对话行**（项目内重排，官方本来就支持）
          //   ② **任意项目行**（跨项目移动：移进那个项目）← 新功能
          var hit = sessionRowAt(event.clientY)
          if (hit !== null) {
            var hitId = sessionIdOfRow(hit)
            if (hitId !== '' && dragOwner !== '' && ownerWorkspaceOf(hitId) === dragOwner) row = hit
          }
          if (row === null) {
            // 没落在对话上 → 看是不是落在某个项目行上（跨项目移动）
            var projRow = rowAt(event.clientY)
            if (projRow !== null) row = projRow
          }
        }
        if (row === null) {
          clearEveryDropMark()
          return
        }
        var rect = row.getBoundingClientRect()
        var want = event.clientY > rect.top + rect.height / 2 ? 'after' : 'before'
        if (row.getAttribute('data-out-drop') === want) return
        clearEveryDropMark()
        row.setAttribute('data-out-drop', want)
      }

      // ⚠️ 同时挂在三处，缺一处就会「某些位置拖不出线」：
      //   ① 每个项目行自己（官方会 stopPropagation，必须挂这儿）
      //   ② 整个 regionArea（行以外的地方，比如行之间的缝隙）
      //   ③ 侧栏根节点（从 Top 拖下来、鼠标还在区域外时）
      // 都用 bindFresh，热更新会替换旧监听，不会重复。
      bindFresh(parts.regionArea, 'dragover', 'projLineArea', paint)
      bindFresh(parts.root, 'dragover', 'projLineRoot', paint)
      bindFresh(parts.regionArea, 'dragleave', 'projLineLeave', function (event) {
        if (parts.regionArea.contains(event.relatedTarget)) return
        clearEveryDropMark()
      })
      bindFresh(parts.root, 'drop', 'projLineDrop', function (event) {
        // 先看这次 drop 是不是「把对话拖进另一个项目」——那种情况要调官方的移动接口。
        var moved = moveSessionAcrossProjects(ctx, parts, event)
        clearEveryDropMark()
        if (moved) return
      })
      bindFresh(parts.root, 'dragend', 'projLineEnd', function () {
        clearEveryDropMark()
      })

      // ⚠️ 项目行和对话行**都要**绑：
      //    官方这两类行的 dragover 里都有 stopPropagation()，事件到不了外层容器，
      //    只绑项目行的话「拖对话」时线永远不会出现（实际使用中正是这个）。
      var rows = parts.regionArea.querySelectorAll('[data-row-key^="workspace:"],[data-row-key^="session:"]')
      for (var i = 0; i < rows.length; i += 1) {
        bindFresh(rows[i], 'dragover', 'projDropLine', paint)
      }
      // 兜底：如果 document 捕获那条没拿到（比如某些环境下事件被拦），
      // 就在 dragover 里看「这个元素自己能不能拖」来推断 —— 项目行 draggable=true、
      // 对话行也 true，无法区分，所以只作为「已知是项目」时的补充，不单独使用。

      // 记录「正在拖哪个项目」。
      //
      // ⚠️ 为什么挂在 document 的**捕获阶段**，而不是挂在项目行上？
      //   踩过：给项目行绑 dragstart 之后，拖拽光标从「捏合的手」变回了普通鼠标。
      //   原因是那一绑走了 bindFresh（每次重画先摘再绑），会干扰官方对 dragstart 的处理。
      //   改成 document 捕获阶段监听：**在任何元素之前**拿到事件，只读不写，
      //   不碰项目行的任何状态，因此不会影响光标和官方拖拽。
      if (dropLineStartBound === false) {
        dropLineStartBound = true
        var onRecordDragStart = function (event) {
          // 只有「当前生效的那一份」才处理。热更新后旧实例也会收到这个事件，
          // 让它安静待着，别和新实例抢着改状态。
          if (!stillOwner()) return
          // ⚠️ 整段用 try/catch 包住：
          //    这是挂在 document 捕获阶段的监听，**如果它抛异常，后面所有 dragstart 监听
          //    （包括把光标锁成「捏合的手」那个）都不会执行** —— 表现就是
          //    「捏住对话时变成普通鼠标」（实际使用中）。
          //    这里只读不写，出错就当没记录，绝不能影响别的监听。
          try {
            var node = event.target
            var hops = 0
            var found = ''
            while (node !== null && node !== undefined && hops < 12) {
              hops += 1
              if (node.nodeType === 1 && typeof node.getAttribute === 'function') {
                var key = node.getAttribute('data-row-key')
                // 项目行、对话行都记（拖对话也要画我们那条线）；
                // 记的是**完整 key**，这样 paint() 能分清拖的是项目还是对话。
                if (typeof key === 'string' && (key.indexOf('workspace:') === 0 || key.indexOf('session:') === 0)) {
                  found = key
                  break
                }
              }
              node = node.parentNode
            }
            // ⚠️ 以前这里写的是无条件 `draggingWorkspaceId = null`，
            //    结果刚记下来的 key 立刻被自己抹掉 → 拖项目时那条蓝线永远不出现。
            //    现在只有「确实没找到行」时才置空。
            draggingWorkspaceId = found === '' ? null : found
          } catch (error) {
            draggingWorkspaceId = null
          }
        }
        var onRecordDragEnd = function () {
          if (!stillOwner()) return
          draggingWorkspaceId = null
          clearEveryDropMark()
        }
        // 用 bindDocument 记账：新实例接管时会整份摘掉（见 docBindings 的说明）
        bindDocument(document, 'dragstart', onRecordDragStart, true)
        bindDocument(document, 'dragend', onRecordDragEnd, true)
      }

      // ══════════════════════════════════════════════════════════
      // 自己实现「拖对话」—— 为了拖动全程保持「拳头」光标
      // ══════════════════════════════════════════════════════════
      //
      // 拖动过程中光标保持「拳头」不变。
      //
      // 为什么不能沿用原生拖拽？原生 HTML5 拖拽一旦开始，光标就交给操作系统了，
      // CSS 的 cursor 完全不生效（macOS 上一定显示系统箭头）。这是浏览器行为，
      // 不是样式能改的。所以要真正做到「拖动时也是拳头」，只有不用原生拖拽：
      //   ① 在 dragstart 里 preventDefault() —— 原生拖拽被取消，光标仍归 CSS 管；
      //   ② 自己用 mousedown / mousemove / mouseup 画一个跟着手走的影子；
      //   ③ 落点复用上面那套 paint()（同一条蓝线），松手时调官方 insertSessionBefore。
      //
      // 只接管「Project 里的对话行」。Top 里那些对话行拖出去的含义是
      // 「把这个项目移回 Project」，那套逻辑在别处，先不动，免得改坏。
      if (customSessionDragBound === false) {
        customSessionDragBound = true

        /** 按住的是哪一行（还没到「拖」的程度）。 */
        var pressRow = null
        var pressX = 0
        var pressY = 0
        /** 正在拖的那条对话编号（空串 = 没在拖）。 */
        var draggingSessionId = ''
        /** 跟着手走的那个影子。 */
        var ghostNode = null
        var ghostOffsetY = 0
        var lastPointerY = 0
        var scrollTimer = 0
        /** 刚刚拖完的时间戳：用来吞掉紧随其后的那次 click（不然松手会打开对话）。 */
        var justDraggedAt = 0
        /**
         * 现在指着的是不是「Top 那一栏」。
         *
         * 规则：把项目下面的对话拖到 Top，就只把这一条对话放进 Top。
         * 改成：只把**这一条对话**放上去（以前是把整个项目一起放上去）。
         *
         * 只有「从 Project 拖出来的对话」才会点亮；从 Top 自己里面拖的行不算 ——
         * 那是「在 Top 内部调整顺序」，不是「往上放东西」。
         */
        var topPinTarget = false

        /** 这次拖动是从 Top 里开始的吗？（从 Top 拖 = 内部排序/移走，不触发置顶） */
        var draggingFromTop = false

        /** 这次拖的就是「单独置顶」的那一行吗？（拖回 Project 时要顺手取消置顶） */
        var draggingPinned = ''

        /**
         * 这次拖动刚开始时，哪些项目已经置顶了。
         *
         * 用来识破「旧实例」：热更新前那一份代码还挂在 document 上，
         * 它会在同一次拖动结束时把**整个项目**写进置顶（旧行为）。
         * 我们在拖动开始时拍一张快照，结束时发现「这个项目是这次才多出来的」
         * 就把它撤掉 —— 这里要的是「只让这条对话上去」。
         */
        var pinsAtDragStart = null

        /**
         * 从某个节点往上找「对话行」。
         * @param {Node} node 起点。
         * @returns {HTMLElement|null} 对话行。
         */
        var sessionRowFrom = function (node) {
          var current = node
          var hops = 0
          while (current !== null && current !== undefined && hops < 12) {
            hops += 1
            if (current.nodeType === 1 && typeof current.getAttribute === 'function') {
              // Project 里的对话行（官方的）
              var key = current.getAttribute('data-row-key')
              if (typeof key === 'string' && key.indexOf('session:') === 0) return current
              // Top 里那一栏的对话行（我们自己画的，编号在 data-sess 上）
              // TOP 栏和 Project 栏的逻辑保持一致。
              if (current.getAttribute('data-sess') !== null) return current
              // 点在行里的按钮上（⋯ / 归档）→ 不算要拖这一行
              if (current.tagName === 'BUTTON' || current.getAttribute('role') === 'button') return null
            }
            current = current.parentNode
          }
          return null
        }

        /** 一条对话属于哪个项目；查不到就是空串（复用上面那份）。 */
        var ownerOf = function (sessionId) {
          return ownerWorkspaceOf(sessionId)
        }

        /**
         * 某个项目里对话的顺序（只看编号）。
         * @param {string} workspaceId 项目编号。
         * @returns {string[]} 对话编号列表。
         */
        var sessionIdsOf = function (workspaceId) {
          var projects = readProjects(ctx)
          for (var i = 0; i < projects.length; i += 1) {
            if (projects[i].id !== workspaceId) continue
            var list = Array.isArray(projects[i].sessions) ? projects[i].sessions : []
            var out = []
            for (var j = 0; j < list.length; j += 1) out.push(String(list[j].id))
            return out
          }
          return []
        }

        /** 列表的滚动容器（拖动到上下边缘时自动滚）。 */
        var scrollerOf = function () {
          return parts.regionArea === null ? null : parts.regionArea.querySelector('[class*="list"]')
        }

        var stopAutoScroll = function () {
          if (scrollTimer !== 0) {
            window.clearInterval(scrollTimer)
            scrollTimer = 0
          }
        }

        /**
         * 靠近列表上下边缘时自动滚动，并顺便重算落点。
         * @returns {void}
         */
        var startAutoScroll = function () {
          stopAutoScroll()
          var scroller = scrollerOf()
          if (scroller === null) return
          scrollTimer = window.setInterval(function () {
            if (draggingSessionId === '') return
            var box = scroller.getBoundingClientRect()
            if (lastPointerY < box.top + 28) scroller.scrollTop = Math.max(0, scroller.scrollTop - 14)
            else if (lastPointerY > box.bottom - 28) scroller.scrollTop = scroller.scrollTop + 14
            else return
            paint({ clientY: lastPointerY })
          }, 60)
        }

        /** 把影子、标记、落点线全部收干净。 */
        var clearCustomDrag = function () {
          stopAutoScroll()
          if (ghostNode !== null && ghostNode.parentNode !== null) ghostNode.parentNode.removeChild(ghostNode)
          ghostNode = null
          draggingSessionId = ''
          draggingWorkspaceId = null
          topPinTarget = false
          draggingFromTop = false
          draggingPinned = ''
          var topBox = parts.root === null ? null : parts.root.querySelector('.dsp-sects')
          if (topBox !== null) topBox.removeAttribute('data-over')
          var side = document.querySelector('[data-slot="sidebar"]')
          if (side !== null) side.removeAttribute('data-dsp-dragging')
          clearEveryDropMark()
        }

        /**
         * 把「这次拖动里才多出来的项目置顶」撤掉。
         *
         * 为什么要这么一刀？
         *   热更新不会销毁上一份代码，旧那份仍然挂在 document 上处理 mousedown /
         *   mousemove / mouseup。它的逻辑是「拖对话 = 整个项目置顶」，于是使用者会看到
         *   「对话上去了，项目也跟着在下面出来」（实际使用中就是这个）。
         *   新的一份管不了旧闭包，但可以在拖动结束时检查一下：
         *   这个项目**在拖动开始时并不在置顶里**，现在却出现了 → 那是旧实例加的，撤掉。
         *
         * 为什么不能「看到项目在置顶里就一律撤」？
         *   使用者可能早就手动置顶过这个项目（在拖动开始前就在清单里），
         *   那时候快照里有它，这里就不会动 —— 只处理「这一次才多出来的」。
         * @param {string} workspaceId 被拖对话所属的项目编号。
         * @param {string[]|null} before 拖动开始时的置顶项目快照。
         * @returns {void}
         */
        var pruneProjectPinAddedDuringDrag = function (workspaceId, before) {
          if (workspaceId === '' || before === null || before === undefined) return
          if (before.indexOf(workspaceId) >= 0) return
          var now = readPins()
          if (now.indexOf(workspaceId) < 0) return
          writePins(
            now.filter(function (keep) {
              return keep !== workspaceId
            }),
          )
        }

        /**
         * 开始拖：造一个跟着手走的影子。
         * @param {HTMLElement} row 被按住的那一行。
         * @param {string} sessionId 对话编号。
         * @param {number} y 鼠标纵坐标。
         * @returns {void}
         */
        var beginCustomDrag = function (row, sessionId, y) {
          var rect = row.getBoundingClientRect()
          if (rect.height <= 0) return
          ghostOffsetY = Math.max(0, Math.min(rect.height, y - rect.top))
          lastPointerY = y
          var ghost = row.cloneNode(true)
          ghost.setAttribute('data-dsp-ghost', 'true')
          ghost.removeAttribute('data-row-key')
          ghost.removeAttribute('data-out-drop')
          ghost.setAttribute('aria-hidden', 'true')
          ghost.style.position = 'fixed'
          ghost.style.left = rect.left + 'px'
          ghost.style.top = (y - ghostOffsetY) + 'px'
          ghost.style.width = rect.width + 'px'
          ghost.style.height = rect.height + 'px'
          ghost.style.margin = '0'
          ghost.style.pointerEvents = 'none'
          ghost.style.zIndex = '9999'
          // 影子要够透：落点那条蓝线画在目标行上，影子太实会把线整个盖住
          // （被拖动的对话底色太亮，蓝线容易被遮挡）。
          ghost.style.opacity = '0.45'
          ghost.style.borderRadius = '6px'
          ghost.style.background = 'transparent'
          ghost.style.outline = '1px dashed var(--dsw-alias-state-business-primary)'
          ghost.style.outlineOffset = '-1px'
          ghost.style.boxShadow = '0 4px 12px rgba(0,0,0,.10)'
          document.body.appendChild(ghost)
          ghostNode = ghost
          draggingSessionId = sessionId
          // 拍一张「拖动开始时的项目置顶快照」——结束时用来识破旧实例偷偷加的项目
          pinsAtDragStart = readPins()
          // 记下「这次是从 Top 里面拖的」——Top 内部拖动只调顺序，不能再触发置顶
          var topBoxForDrag = parts.root === null ? null : parts.root.querySelector('.dsp-sects')
          draggingFromTop = topBoxForDrag !== null && topBoxForDrag.contains(row)
          // 记下「拖的本来就是单独置顶的那一条」——拖回 Project 时要把置顶一并取消
          draggingPinned = row.getAttribute('data-pinsess') === 'true' ? sessionId : ''
          // 让 paint() 知道「现在拖的是一条对话」，它才会按规则画线
          draggingWorkspaceId = 'session:' + sessionId
          var side = document.querySelector('[data-slot="sidebar"]')
          if (side !== null) side.setAttribute('data-dsp-dragging', 'true')
          startAutoScroll()
          paint({ clientY: y })
        }

        /** 松手：按落点调官方接口把这条对话挪过去。 */
        /**
         * 取「某一栏里、某个项目的对话当前显示顺序」。
         *
         * 为什么要从界面上读，而不是从宿主数据读？
         *   因为同一项目里的顺序是官方**存在浏览器这边**的（orderBy=manual 时），
         *   宿主那边的 sessionIds 顺序只是其中一个来源。界面上的顺序才是使用者看到的。
         * @param {string} workspaceId 项目编号。
         * @param {Element} reference 参考行（用它判断是 Top 栏还是 Project 栏）。
         * @returns {string[]} 对话编号（按显示顺序）。
         */
        var orderAround = function (workspaceId, reference) {
          var top = parts.root === null ? null : parts.root.querySelector('.dsp-sects')
          var scope = parts.regionArea
          if (top !== null && top !== undefined && reference !== null && typeof top.contains === 'function' && top.contains(reference)) {
            scope = top
          }
          var out = []
          if (scope !== null && scope !== undefined) {
            var rows = scope.querySelectorAll('[data-row-key^="session:"],.dsp-sess[data-sess]')
            for (var i = 0; i < rows.length; i += 1) {
              var id = sessionIdOfRow(rows[i])
              if (id === '' || out.indexOf(id) >= 0) continue
              if (ownerOf(id) !== workspaceId) continue
              out.push(id)
            }
          }
          // 界面上一行都没有（例如这个项目是收起的）→ 退回宿主那份顺序
          if (out.length === 0) out = sessionIdsOf(workspaceId)
          return out
        }

        /**
         * 算出「把这条对话挪到锚点前面」之后的完整顺序。
         * @param {string} workspaceId 目标项目。
         * @param {string} sessionId 被拖的对话。
         * @param {string} anchorId 锚点（空串 = 放到最后）。
         * @param {Element} reference 参考行。
         * @returns {string[]} 新顺序。
         */
        var nextOrderFor = function (workspaceId, sessionId, anchorId, reference) {
          var list = orderAround(workspaceId, reference)
          var from = list.indexOf(sessionId)
          if (from >= 0) list.splice(from, 1)
          if (anchorId === '' || anchorId === undefined || anchorId === null) {
            list.push(sessionId)
            return list
          }
          var at = list.indexOf(anchorId)
          if (at < 0) list.push(sessionId)
          else list.splice(at, 0, sessionId)
          return list
        }

        /**
         * 把新顺序写进官方那个「浏览器这边的顺序表」。
         *
         * 为什么必须走它？
         *   官方同一个项目里的对话顺序是**存在浏览器本地**的（`orderBy: 'manual'`），
         *   宿主那边的 `insertSessionBefore` 只改「这条对话属于哪个项目、在列表里排第几」，
         *   但侧栏显示用的是本地顺序 —— 只调宿主，界面根本不会动
         *   （「拖走了但没移动」就是这个原因）。
         * @param {string} workspaceId 项目编号。
         * @param {string[]} order 新顺序。
         * @returns {boolean} 真的写进去了就返回 true。
         */
        var applyClientOrder = function (workspaceId, order) {
          try {
            var ui = ctx.get('uiWorkspace')
            var view = ui === null || ui === undefined ? null : ui.view
            if (view === null || view === undefined || typeof view.setSessionOrder !== 'function') return false
            // 第三个参数是「其它项目的当前顺序」；传空对象 = 不动别的项目，
            // 只把这一次拖拽的结果写进去（传 undefined 会直接抛错）。
            view.setSessionOrder(workspaceId, order, {})
            return true
          } catch (error) {
            return false
          }
        }

        /**
         * 调宿主那个「把对话插到某个项目里的某个位置」的接口。
         *
         * 为什么本地顺序表之外还要调它？
         *   同一个项目里的顺序有两份：浏览器这边一份（Project 栏按它显示）、
         *   宿主那边一份（Top 栏按它显示）。两边都写才一致。
         * @param {string} workspaceId 目标项目。
         * @param {string} sessionId 被拖的对话。
         * @param {string} anchorId 锚点（空串 = 追加到末尾）。
         * @returns {Promise<boolean>} 成功就 resolve(true)。
         */
        var hostMove = function (workspaceId, sessionId, anchorId) {
          var service = null
          try {
            service = ctx.get('workspaces')
          } catch (error) {
            service = null
          }
          if (service === null || service === undefined || typeof service.insertSessionBefore !== 'function') {
            return Promise.resolve(false)
          }
          return Promise.resolve(
            service.insertSessionBefore(workspaceId, sessionId, anchorId === '' ? undefined : anchorId),
          )
            .then(function () {
              if (repaint !== null) repaint()
              return true
            })
            .catch(function () {
              return false
            })
        }

        /** 松手：按落点把这条对话挪过去。 */
        var commitCustomDrag = function () {
          // ① 松手时指着 Top → 只把**这一条对话**放进 Top
          //
          // 从 Project 往 Top 拖时按拖动对象区分：
          //   · 拖的是对话 → 只把这一条对话放进 Top，不带上整个项目；
          //   · 拖的是项目 → 才把整个项目放进 Top。
          // 所以这里**不再** writePins(整个项目)，只写 pinned-sessions。
          if (topPinTarget) {
            var pinSession = draggingSessionId
            var pinOwner = pinSession === '' ? '' : ownerOf(pinSession)
            clearCustomDrag()
            if (pinSession === '' || pinOwner === '') return
            // 已经在置顶里 → 把它挪到最前面（拖第二次 = 提上来），不是重复添加
            var pinnedNow = readPinnedSessions().filter(function (keep) {
              return keep !== pinSession
            })
            writePinnedSessions([pinSession].concat(pinnedNow))
            return
          }
          var scope = parts.regionArea
          var marked = scope === null ? null : scope.querySelector('[data-out-drop]')
          if (marked === null && parts.root !== null) marked = parts.root.querySelector('[data-out-drop]')
          var half = marked === null ? '' : String(marked.getAttribute('data-out-drop') || '')
          var sessionId = draggingSessionId
          // 拖的是「单独置顶」那一行吗？——拖回 Project 时顺手取消置顶，
          // 不然它在 Top 里那份会留着，看起来像没搬走。
          var originPinned = draggingPinned
          var targetId = marked === null ? '' : sessionIdOfRow(marked)
          var targetWorkspace = marked === null ? '' : workspaceIdOfRow(marked)
          clearCustomDrag()
          if (marked === null || sessionId === '') return
          // 拖的是「单独置顶」那一行，但松手还在 Top 里 → 什么也不做（保持置顶）。
          // 不然它会被当成「挪到某个项目」而悄悄跑掉。
          if (originPinned !== '' && sections.box !== null && sections.box.contains(marked)) return

          var anchorId = ''
          if (targetId !== '') {
            // 落在另一条对话上
            if (targetId === sessionId) return
            targetWorkspace = ownerOf(targetId)
            if (half === 'before') {
              anchorId = targetId
            } else {
              var order = orderAround(targetWorkspace, marked)
              var at = order.indexOf(targetId)
              if (at >= 0 && at + 1 < order.length) anchorId = order[at + 1]
            }
          } else if (targetWorkspace !== '') {
            // 落在项目行上：上半部分插到最前，下半部分追加到末尾
            if (half === 'before') {
              var first = orderAround(targetWorkspace, marked)
              if (first.length > 0 && first[0] !== sessionId) anchorId = first[0]
            }
          } else {
            return
          }
          if (targetWorkspace === '') return
          if (anchorId === sessionId) return
          // 拖出 Top 并落到了 Project 上 → 这条对话不再需要单独置顶了。
          // （先取消置顶再挪，界面会立刻少掉 Top 里那一行，动作看得见。）
          if (originPinned !== '') unpinPinnedSession(originPinned)

          var owner = ownerOf(sessionId)
          var targetOrder = nextOrderFor(targetWorkspace, sessionId, anchorId, marked)

          // ① 同一个项目里挪位置
          //
          // 两边都要写：
          //   · 官方那张「浏览器这边的顺序表」→ Project 那一栏按它显示；
          //   · 宿主的 insertSessionBefore     → Top 那一栏是按宿主顺序画的。
          // 只写一个的话，总有一栏看起来「没动」（实际使用中就是这个）。
          if (owner === targetWorkspace) {
            var wroteLocal = applyClientOrder(targetWorkspace, targetOrder)
            hostMove(targetWorkspace, sessionId, anchorId).then(function (ok) {
              if (!ok && !wroteLocal && repaint !== null) repaint()
            })
            return
          }

          // ② 跨项目：先让宿主真的把会话挪过去，再更新两边的显示顺序
          hostMove(targetWorkspace, sessionId, anchorId).then(function () {
            if (owner !== '') {
              var rest = orderAround(owner, marked)
              var drop = rest.indexOf(sessionId)
              if (drop >= 0) rest.splice(drop, 1)
              applyClientOrder(owner, rest)
            }
            applyClientOrder(targetWorkspace, targetOrder)
            if (repaint !== null) repaint()
          })
        }

        var onCustomDown = function (event) {
          // 热更新后旧实例也会收到同一个事件 —— 不是当前生效的那份就别动
          if (!stillOwner()) return
          if (typeof event.button === 'number' && event.button !== 0) return
          if (typeof event.clientY !== 'number') return
          pressRow = sessionRowFrom(event.target)
          if (pressRow === null) return
          pressX = event.clientX
          pressY = event.clientY
        }

        /**
         * 判断现在是不是「要把这一条对话放进 Top」。
         *
         * 只有同时满足这几条才算：
         *   ① 拖的是一条对话，而且知道它属于哪个项目；
         *   ② 这次拖动是**从 Project 那边**开始的（从 Top 自己里面拖的不算，
         *      那是 Top 内部排序 / 移走，不是「往上放」）；
         *   ③ 鼠标落在 Top 那一栏的范围里（标题 + 列表都算）。
         * 命中时把 Top 那一栏点亮（和原生拖拽时一模一样的那圈虚线），并且不再画落点线。
         * @param {number} y 鼠标纵坐标。
         * @returns {void}
         */
        var syncPinTarget = function (y) {
          var box = parts.root === null ? null : parts.root.querySelector('.dsp-sects')
          if (box === null) return
          var owner = draggingSessionId === '' ? '' : ownerOf(draggingSessionId)
          var inside = false
          if (owner !== '' && draggingFromTop === false) {
            var rect = box.getBoundingClientRect()
            inside = rect.height > 0 && y >= rect.top && y <= rect.bottom
          }
          if (inside === topPinTarget) {
            if (inside && box.getAttribute('data-over') !== 'true') box.setAttribute('data-over', 'true')
            return
          }
          topPinTarget = inside
          if (inside) {
            box.setAttribute('data-over', 'true')
            // 要「整块置顶」时不该同时显示某一行上的落点线，两者会互相干扰
            clearEveryDropMark()
          } else {
            box.removeAttribute('data-over')
          }
        }

        var onCustomMove = function (event) {
          if (!stillOwner()) return
          // 坐标必须是真数字：某些程序化派发的 mousemove 没有坐标，
          // 算出来是 NaN，会误判成「拖动了」。
          if (typeof event.clientY !== 'number' || event.clientY !== event.clientY) return
          if (draggingSessionId !== '') {
            if (event.preventDefault) event.preventDefault()
            lastPointerY = event.clientY
            if (ghostNode !== null) ghostNode.style.top = (event.clientY - ghostOffsetY) + 'px'
            syncPinTarget(event.clientY)
            // 指着 Top 的时候整块已经亮起来了，再画一条落点线会让人以为只是插到某一行
            if (!topPinTarget) paint({ clientY: event.clientY })
            return
          }
          if (pressRow === null) return
          var dx = event.clientX - pressX
          var dy = event.clientY - pressY
          // 手抖 3px 以内不算拖（不然「点一下打开对话」会变成拖）
          if (dx * dx + dy * dy < 25) return
          var row = pressRow
          pressRow = null
          // 两栏都要认：Project 的对话行编号在 data-row-key 上，
          // Top 的对话行编号在 data-sess 上（设计要求两栏逻辑一致）。
          var dragId = sessionIdOfRow(row)
          if (dragId === '') return
          if (event.preventDefault) event.preventDefault()
          beginCustomDrag(row, dragId, event.clientY)
        }

        var onCustomUp = function () {
          if (!stillOwner()) return
          if (draggingSessionId !== '') {
            justDraggedAt = Date.now()
            // 先记下「拖的是哪一条、它属于哪个项目、拖动前置顶了哪些项目」，
            // 因为 commitCustomDrag 里会清空拖拽状态。
            var endedOwner = ownerOf(draggingSessionId)
            var pinsBefore = pinsAtDragStart
            commitCustomDrag()
            // 兜底：万一旧实例（热更新前那份）还挂在 document 上，
            // 它会在同一次拖动里把「整个项目」写进置顶 —— 当场撤掉。
            if (endedOwner !== '' && pinsBefore !== null && pinsBefore.indexOf(endedOwner) < 0) {
              pruneProjectPinAddedDuringDrag(endedOwner, pinsBefore)
              // 如果旧实例的监听排在我们后面，同步这一刻还看不到它写的值，
              // 再等一个 tick 收拾一次（正常情况下这次是空操作）。
              window.setTimeout(function () {
                pruneProjectPinAddedDuringDrag(endedOwner, pinsBefore)
              }, 0)
            }
          }
          pressRow = null
        }

        /**
         * 把 Project 里对话行的原生拖拽掐掉。
         *
         * 为什么必须掐？不掐的话浏览器会自己开始拖、把光标换成系统箭头，
         * 我们上面那套「拳头」就白做了。
         * @param {DragEvent} event dragstart 事件。
         * @returns {void}
         */
        var onCustomDragStart = function (event) {
          if (!stillOwner()) return
          var row = sessionRowFrom(event.target)
          if (row === null) return
          // Top 和 Project 两栏的对话行都接管（两栏逻辑一致）
          if (parts.root === null || parts.root.contains(row) === false) return
          if (event.preventDefault) event.preventDefault()
          if (event.stopPropagation) event.stopPropagation()
        }

        /** 刚拖完的那一下 click 要吞掉，否则松手就跳进那条对话。 */
        var onCustomClick = function (event) {
          if (!stillOwner()) return
          if (justDraggedAt === 0) return
          if (Date.now() - justDraggedAt > 400) {
            justDraggedAt = 0
            return
          }
          justDraggedAt = 0
          if (event.preventDefault) event.preventDefault()
          if (event.stopPropagation) event.stopPropagation()
        }

        var onCustomKey = function (event) {
          if (!stillOwner()) return
          if (event.key !== 'Escape') return
          if (draggingSessionId === '') return
          clearCustomDrag()
          pressRow = null
        }

        // 用 bindDocument 记账：新实例接管时整份摘掉，不会再出现「旧实例也处理一次」
        bindDocument(document, 'mousedown', onCustomDown, true)
        bindDocument(document, 'mousemove', onCustomMove, true)
        bindDocument(document, 'mouseup', onCustomUp, true)
        bindDocument(document, 'dragstart', onCustomDragStart, true)
        bindDocument(document, 'click', onCustomClick, true)
        bindDocument(document, 'keydown', onCustomKey, true)
      }
    }


    /** 「正在拖哪个项目」的 document 级监听是否已经绑过（只需绑一次）。 */
    var dropLineStartBound = false

    /** 「自己实现的对话拖拽」的 document 级监听是否已经绑过（只需绑一次）。 */
    var customSessionDragBound = false

    /**
     * 这一份代码挂在 document / window 上的监听（收尾时要一个个摘掉）。
     *
     * ⚠️ 为什么必须记下来？
     *   热更新**不会销毁**上一份代码。用 `document.addEventListener` 直接挂的监听
     *   没有「换实例自动替换」的本事（只有 bindFresh 有）。新旧两份同时收同一次
     *   mousedown / mousemove / mouseup —— 旧那份仍然执行旧逻辑，新那份执行新逻辑。
     *
     *   实际表现是：把一条对话拖进 Top 时，它所属的整个项目也会跟着出现在下面。
     *   新的这份把「这一条对话」放进了 Top，旧的这份还在旁边把「整个项目」也置顶了。
     *
     * 所以：这里挂的每一个监听都记账，等新实例接管（claimOwnership → release）时，
     * 整份摘掉。之后再热更新就不会越叠越多。
     */
    var docBindings = []

    /**
     * 往 document / window 上挂一个「收尾时能整份摘掉」的监听。
     * @param {EventTarget} target 通常是 document 或 window。
     * @param {string} type 事件名。
     * @param {Function} fn 处理函数。
     * @param {boolean} capture 是否捕获阶段。
     * @returns {void}
     */
    function bindDocument(target, type, fn, capture) {
      if (target === null || target === undefined) return
      target.addEventListener(type, fn, capture)
      docBindings.push({ target: target, type: type, fn: fn, capture: capture })
    }

    /**
     * 把这一份挂在 document / window 上的监听全部摘掉。
     * @returns {void}
     */
    function unbindDocumentListeners() {
      var list = docBindings
      docBindings = []
      for (var i = 0; i < list.length; i += 1) {
        try {
          list[i].target.removeEventListener(list[i].type, list[i].fn, list[i].capture)
        } catch (error) {
          /* 摘不掉也不能把收尾流程弄断 */
        }
      }
    }

    function bindOfficialRowFold(parts) {
      if (parts.regionArea === null) return

      /** 把动画留下的临时样式收干净（动画正常结束、被打断、元素没了都要走这里）。 */
      var clearFold = function (section) {
        if (section.__dspFoldTimer !== undefined && section.__dspFoldTimer !== null) {
          window.clearTimeout(section.__dspFoldTimer)
          section.__dspFoldTimer = null
        }
        var running = section.__dspFoldAnim
        if (running !== undefined && running !== null) {
          section.__dspFoldAnim = null
          try {
            running.cancel()
          } catch (error) {
            /* 已经播完了，取消会抛，忽略 */
          }
        }
        section.style.height = ''
        section.style.overflow = ''
      }

      bindFresh(parts.regionArea, 'click', 'rowFold', function (event) {
        // 只认「项目行」和「展开更多对话」那个按钮
        var hit = null
        var node = event.target
        while (node !== null && node !== undefined && node !== parts.regionArea) {
          if (node.nodeType === 1 && typeof node.getAttribute === 'function') {
            var key = node.getAttribute('data-row-key')
            if (key !== null && (key.indexOf('workspace:') === 0 || key.indexOf('overflow:') === 0)) {
              hit = node
              break
            }
          }
          node = node.parentNode
        }
        if (hit === null) return

        // 往上找到装这一组的那一层（官方类名里带 groupSection）
        var section = hit.parentNode
        var hops = 0
        while (section !== null && section !== undefined && section !== parts.regionArea && hops < 4) {
          if (String(section.className || '').indexOf('groupSection') >= 0) break
          section = section.parentNode
          hops += 1
        }
        if (section === null || section === undefined || section === parts.regionArea) return
        if (typeof section.animate !== 'function') return

        clearFold(section)
        var from = section.getBoundingClientRect().height
        if (!(from > 0)) return
        section.style.overflow = 'hidden'
        section.style.height = from + 'px'

        window.requestAnimationFrame(function () {
          window.requestAnimationFrame(function () {
            if (section.parentNode === null) return
            section.style.height = 'auto'
            var to = section.getBoundingClientRect().height
            section.style.height = from + 'px'
            // 逼浏览器把 from 认下来（同一帧内读一下布局），否则动画起点可能被并掉
            void section.offsetHeight
            if (!(to > 0) || Math.abs(to - from) < 1) {
              clearFold(section)
              return
            }
            // 时长和曲线跟着样式表里那份参数走，改一处两边都变
            var opening = to > from
            var style = window.getComputedStyle(parts.root)
            var seconds = parseFloat(style.getPropertyValue(opening ? '--dsp-open-dur' : '--dsp-close-dur'))
            var duration = (seconds > 0 ? seconds : opening ? 0.26 : 0.2) * 1000
            var easing = opening
              ? 'cubic-bezier(.05,.7,.1,1)'
              : 'cubic-bezier(.3,0,.8,.15)'
            var running = section.animate(
              [{ height: from + 'px' }, { height: to + 'px' }],
              { duration: duration, easing: easing },
            )
            section.__dspFoldAnim = running
            // 兜底：万一 finished 没回调（元素被 React 换掉等），也用定时器收干净
            section.__dspFoldTimer = window.setTimeout(function () {
              clearFold(section)
            }, duration + 90)
            if (running !== null && running.finished !== undefined && typeof running.finished.then === 'function') {
              running.finished.then(function () {
                clearFold(section)
              }, function () {
                clearFold(section)
              })
            }
          })
        })
      })
    }

    function bindProjectsHead(parts, ctx, t) {
      if (parts.regionArea === null) return
      var head = parts.regionArea.parentNode.querySelector('[class*="sectionHeader"]')
      if (head === null) return
      var label = head.querySelector('[class*="sectionLabel"]')
      if (label === null) return

      var folded = sections.projFolded
      // 名字写进样式变量（样式表里 content 需要带引号，不包会被当成多个关键字）
      var labelValue = '"' + String(t('projects')).replace(/"/g, '') + '"'
      if (parts.root.style.getPropertyValue('--dsp-proj-label') !== labelValue) {
        parts.root.style.setProperty('--dsp-proj-label', labelValue)
      }

      // 往标题里插一个真 SVG 三角 —— 和「置顶」那个用同一个图标、同一套旋转，
      // 这样两个标题看起来才是一套的（之前工作区用的是文字三角「▾」，形状不一样）。
      var projChev = label.querySelector('.dsp-proj-chev')
      if (projChev === null) {
        projChev = document.createElement('span')
        projChev.className = 'dsp-proj-chev'
        projChev.innerHTML =
          '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
          'stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
          ICONS.chevron +
          '</svg>'
        label.insertBefore(projChev, label.firstChild)
      }
      setAttr(projChev, 'data-fold', folded ? 'true' : 'false')
      setAttr(head, 'title', folded ? t('expandProjects') : t('collapseProjects'))
      // 量出会话列表的真实高度（收起动画靠它）
      // 官方那个会话列表：直接按收起状态设高度。
      // scrollHeight 不管当前高度是多少，报的都是内容高度，所以可以先量后设。
      applyProjectsFold(parts, folded)

      // 给「标题文字」挂点击。
      //
      // 用 bindFresh：热更新后旧实例的监听会被自动换掉。
      // （之前用「已绑定」标记 —— React 重画时可能只换里面的文字节点，
      //   标记还在、监听器却跟着旧节点没了，结果点了没反应。）
      label.style.cursor = 'pointer'
      label.style.userSelect = 'none'
      bindFresh(label, 'click', 'projHead', function (event) {
        event.stopPropagation()
        sections.projFolded = !sections.projFolded
        writeFold('projects', sections.projFolded)
        // 立刻应用，不等重画 —— 重画要等观察器醒，可能等不到。
        applyProjectsFold(parts, sections.projFolded)
        if (repaint !== null) repaint()
      })

      // ── 把项目拖到「Project」标题上 → 挪到列表最上面 ──
      //
      // 把 project 下面的某个项目直接拖到 project 标题（白光区域），
      // 让它排到 project 列表最上面。
      //
      // 拖的是**项目行**（`data-row-key="workspace:<编号>"`）。官方那一行的 dragstart 里写的是
      // `setData('text/plain', row.key)`，而 row.key 就是工作区编号 —— 所以 text/plain 里
      // 拿到的正是我们要的东西（这一点和「拖对话」不同，那里会被覆盖成对话编号）。
      //
      // 挪动用官方的 `workspaces.insertBefore(要挪的, 锚点)`；锚点省略 = 追加到末尾。
      // 要挪到**最上面**，锚点就传「当前列表里第一个工作区的编号」。
      bindFresh(head, 'dragover', 'projHeadOver', function (event) {
        var id = readWorkspaceDragPayload(event.dataTransfer)
        if (id === '') return
        // 只有真的存在这个工作区才响应，免得随便拖个东西过来标题就亮
        var known = readProjects(ctx).some(function (project) {
          return project.id === id
        })
        if (!known) return
        event.preventDefault()
        event.dataTransfer.dropEffect = 'move'
        // 白光：复用「拖东西经过 Project」那套标记（和从 Top 拖回来时一模一样）
        if (!parts.root.hasAttribute('data-dsp-in')) parts.root.setAttribute('data-dsp-in', 'true')
      })

      bindFresh(head, 'dragleave', 'projHeadLeave', function (event) {
        // 只有真的离开标题这一块才熄灯（移到子元素上不算离开）
        if (head.contains(event.relatedTarget)) return
        if (parts.root.hasAttribute('data-dsp-in')) parts.root.removeAttribute('data-dsp-in')
      })

      bindFresh(head, 'drop', 'projHeadDrop', function (event) {
        if (parts.root.hasAttribute('data-dsp-in')) parts.root.removeAttribute('data-dsp-in')
        var id = readWorkspaceDragPayload(event.dataTransfer)
        if (id === '') return
        // 和 dragover 一样要校验「这个工作区真的存在」：
        // 不然拖个不相干的东西过来（比如一段文字），也会去调一次排序接口。
        var known = readProjects(ctx).some(function (project) {
          return project.id === id
        })
        if (!known) return
        event.preventDefault()
        event.stopPropagation()
        moveWorkspaceToTop(ctx, id)
      })
    }

    /**
     * 把一个工作区挪到「Project」列表的最上面。
     *
     * 为什么用官方接口而不是自己排序？
     *   侧栏里那份列表是官方画的，顺序由官方的「工作区注册表」决定。自己排只会排个寂寞，
     *   下一次重画就被官方覆盖回来。所以调用官方的 `workspaces.insertBefore(要挪的, 锚点)`：
     *   锚点传「当前第一个工作区」= 插到它前面 = 排到最上面。
     * @param {object} ctx 客户端插件上下文。
     * @param {string} workspaceId 要挪的工作区编号。
     * @returns {void}
     */
    function moveWorkspaceToTop(ctx, workspaceId) {
      var service = null
      try {
        service = ctx.get('workspaces')
      } catch (error) {
        service = null
      }
      if (service === null || service === undefined || typeof service.insertBefore !== 'function') return

      var all = readProjects(ctx)
      var first = null
      for (var i = 0; i < all.length; i += 1) {
        if (all[i].id !== workspaceId) {
          first = all[i].id
          break
        }
      }
      // 只有一个工作区，或者它本来就在最上面 → 不用动
      if (first === null) return
      if (all.length > 0 && all[0].id === workspaceId) return

      Promise.resolve()
        .then(function () {
          return service.insertBefore(workspaceId, first)
        })
        .then(function () {
          if (repaint !== null) repaint()
        })
        .catch(function () {
          /* 挪不动就算了，别把侧栏弄崩 */
        })
    }

    //#endregion

    //#region 插件入口

    //#endregion

    //#region 插件入口

    /**
     * 本插件所有动画统一用这一套参数（值直接写在下面的样式里）：
     *
     *   高度变化（展开 / 收起）  0.24s
     *   淡入淡出 / 颜色 / 悬停   0.16s
     *   小三角旋转               0.18s
     *   缓动曲线                 官方那条 --ds-ease-in-out
     *
     * 为什么要统一？之前每处各写各的（.24s / .22s / .2s / .18s / .14s / .12s…），
     * 点起来快慢不一，看着就不像一个整体。
     *
     * 缓动用官方那条曲线，是为了和 DSH 自己的侧栏宽度动画完全同步。
     */

    /** 需要 DSH 提供的客户端能力。 */
    var inject = ['slots', 'locale', 'layout', 'uiWorkspace']

    /**
     * 插件入口：注册语言包、样式、MCP 页和「已归档」页，并开始改造侧栏。
     * @param {object} ctx 客户端插件上下文。
     * @returns {void}
     */
    function apply(ctx) {
      pluginCtx = ctx
      var t = ctx.locale.bind(NS)

      // 先抢身份：如果这是「重新加载」出来的新一份，就让旧的那一份退出。
      // 不这么做的话，旧实例画的菜单、旧实例的观察器都还在，界面会重复好几层。
      claimOwnership()

      ctx.effect(function () {
        return ctx.locale.register(NS, { en: en, zh: zh })
      }, 'sidebar-pro: dictionaries')

      ctx.effect(function () {
        var style = document.createElement('style')
        // data-plugin 是 DSH 模块系统的「所有权标记」。少了它，这张样式表会被当成
        // 无主的，记到下一个加载的插件名下，并在那个插件重载时被一起删掉。
        style.setAttribute('data-plugin', '@local/dsh-left-sidebar-pro')
        style.setAttribute('data-dsh-plugin', '@local/dsh-left-sidebar-pro')
        style.textContent = CSS
        document.head.appendChild(style)
        return function () {
          style.remove()
        }
      }, 'sidebar-pro: styles')

      // MCP 管理页：坐进官方「主面板」座位，并在侧栏登记一行（那一行由我们藏起来，
      // 但登记是必要的：官方切页时要能在 main 里找到这个编号，找不到会直接报错）。
      ctx.slots.inject('main', function () {
        return ctx.slots.register(
          {
            name: 'main',
            key: MCP_PANEL_ID,
            locale: NS,
          },
          McpPanel,
        )
      })

      ctx.slots.inject('sidebar.panellist', function () {
        return ctx.slots.register(
          {
            name: 'sidebar.panellist',
            id: MCP_PANEL_ID,
            order: MCP_PANEL_ORDER,
            locale: NS,
            label: function () {
              return t('mcp')
            },
          },
          function McpIcon() {
            return icon(ICONS.plug, 16)
          },
        )
      })

      // 「已归档对话」整页：和 MCP 页同样的坐法 —— 坐进官方「主面板」座位，
      // 并在侧栏登记一行（那一行由我们藏在 More 分组里，登记是必须的：
      // 官方切页时要能在 main 里找到这个编号，找不到会直接报错）。
      //
      // 编号用 'archived'：和侧栏 More 里那一行的 data-sub 一模一样，
      // 所以点那一行（ctx.layout.selectPanel('archived')）就正好切到这一页。
      ctx.slots.inject('main', function () {
        return ctx.slots.register(
          {
            name: 'main',
            key: ARCH_PANEL_ID,
            locale: NS,
          },
          ArchivedPanel,
        )
      })

      ctx.slots.inject('sidebar.panellist', function () {
        return ctx.slots.register(
          {
            name: 'sidebar.panellist',
            id: ARCH_PANEL_ID,
            order: ARCH_PANEL_ORDER,
            locale: NS,
            label: function () {
              return t('archived')
            },
          },
          function ArchivedIcon() {
            return icon(ICONS.archive, 16)
          },
        )
      })

      // ── 拖动时把鼠标锁成「拳头」 ──
      //
      // 为什么要全局监听？因为拖拽事件是**从被拖的元素冒泡到 document** 的，
      // 在这里听一次，不管是谁发起的拖拽都能覆盖。
      // 之前是每个拖拽点自己记得设置标记 —— 漏一个（More 子项）光标就变回箭头了。
      ctx.effect(function () {
        var onStart = function (event) {
          var sidebarRoot = document.querySelector('[data-slot="sidebar"]')
          if (sidebarRoot !== null) sidebarRoot.setAttribute('data-dsp-dragging', 'true')
          try {
            var node = event === undefined ? null : event.target
            var hops = 0
            while (node !== null && node !== undefined && hops < 12) {
              hops += 1
              if (node.nodeType === 1 && typeof node.getAttribute === 'function') {
                var key = node.getAttribute('data-row-key')
                if (typeof key === 'string') {
                  if (key.indexOf('workspace:') === 0) {
                    draggingWorkspaceId = key
                    return
                  }
                  if (key.indexOf('session:') === 0) {
                    // 拖的是对话 → 也要画我们自己的线（设计要求：对话之间也要有线，
                    // 但**不能是 Y 字形**，所以用我们这条纯横线）。
                    draggingWorkspaceId = key
                    return
                  }
                }
              }
              node = node.parentNode
            }
            draggingWorkspaceId = null
          } catch (error) {
            draggingWorkspaceId = null
          }
        }
        var onEnd = function () {
          var sidebarRoot2 = document.querySelector('[data-slot="sidebar"]')
          if (sidebarRoot2 !== null) sidebarRoot2.removeAttribute('data-dsp-dragging')
        }
        bindDocument(document, 'dragstart', onStart, true)
        bindDocument(document, 'dragend', onEnd, true)
        // 兜底：原生拖拽一旦开始，浏览器会接管光标、不再理 CSS 的 cursor。
        // 所以「按下去那一刻」就要把光标锁成握拳（那时 CSS 还生效），
        // 松手再放开。这样从「按住」到「拖动」整个过程都是捏合的手。
        // ── 按下即握拳（只作用在侧栏里那一行，不影响右边聊天区）──
        //
        // 手掌和鼠标过渡时会闪出光标，这个过程中不要再让光标出现。
        // 做法：mousedown 时给**那一行自己**打 data-pressing，CSS 立刻把它的光标锁成握拳；
        //       mouseup / dragend 清掉。范围只到那一行，不碰整页。
        var onPress = function (event) {
          var node = event.target
          var hops = 0
          while (node !== null && node !== undefined && hops < 12) {
            hops += 1
            if (node.nodeType === 1 && typeof node.getAttribute === 'function') {
              var key = node.getAttribute('data-row-key')
              var foldable = node.getAttribute('data-foldable')
              if ((typeof key === 'string' &&
                   (key.indexOf('workspace:') === 0 || key.indexOf('session:') === 0)) ||
                  foldable === 'true') {
                if (!node.hasAttribute('data-pressing')) node.setAttribute('data-pressing', 'true')
                return
              }
            }
            node = node.parentNode
          }
        }
        var onRelease = function () {
          var pressed = document.querySelectorAll('[data-pressing]')
          for (var i = 0; i < pressed.length; i += 1) pressed[i].removeAttribute('data-pressing')
        }
        /**
         * 把「正在按 / 正在拖」的标记一次清干净。
         * @returns {void}
         */
        var clearDragMarks = function () {
          var pressed = document.querySelectorAll('[data-pressing]')
          for (var i = 0; i < pressed.length; i += 1) pressed[i].removeAttribute('data-pressing')
          var side = document.querySelector('[data-slot="sidebar"]')
          if (side !== null) side.removeAttribute('data-dsp-dragging')
        }
        // ── 自愈：捏完之后光标卡住不放，靠这一条救回来 ──
        //
        // 捏合手势结束后有时会卡住，光标一直停在「手掌」状态。
        //
        // 为什么会卡住：解除标记靠的是「松手事件」，可这个事件**不一定来** ——
        //   ① 在窗口外面松手（macOS 上很常见，拖到浏览器外面再松）；
        //   ② 拖到一半那一行被重画掉（切会话、侧栏刷新、热更新）；
        //   ③ 拖到不允许放的位置，浏览器直接结束拖拽、不发 dragend；
        //   ④ 拖拽途中按 Esc 取消。
        // 只要漏掉一次，data-pressing / data-dsp-dragging 就留在页面上了，
        // 那条「光标 = 握拳」的 !important 规则就会一直生效 —— 就是「卡住」。
        //
        // 现在的自检：鼠标只要在动、而且**没按着任何键**，就不可能是「正在按/正在拖」，
        // 这时候还挂着标记 = 上一次没清干净，立刻清。
        // 为什么这条一定可靠：原生拖拽进行中浏览器**根本不发 mousemove**（只发 dragover），
        // 所以「收到 mousemove 且 buttons === 0」只可能是真的空闲状态，不会误清。
        var heal = function (event) {
          if (event !== undefined && event !== null && typeof event.buttons === 'number' && event.buttons !== 0) return
          var side = document.querySelector('[data-slot="sidebar"]')
          var dragging = side !== null && side.hasAttribute('data-dsp-dragging')
          if (!dragging && document.querySelector('[data-pressing]') === null) return
          clearDragMarks()
          draggingWorkspaceId = null
          clearEveryDropMark()
        }
        var onHidden = function () {
          if (document.visibilityState === 'hidden') heal()
        }
        bindDocument(document, 'mousedown', onPress, true)
        bindDocument(document, 'mouseup', onRelease, true)
        bindDocument(document, 'dragend', onRelease, true)
        bindDocument(document, 'mousemove', heal, true)
        bindDocument(window, 'blur', heal, false)
        bindDocument(document, 'visibilitychange', onHidden, false)
        // 拖到窗口外松手时不会触发 dragend，用这两个兜底
        // ⚠️ 这里**不要**把 onEnd 直接挂在 drop 上：
        //    踩过 —— 从 Project 往 Top 拖时，Top 区域会先吃掉一个 drop 事件，
        //    那一瞬间 onEnd 把光标标记清掉了，但拖拽其实还没结束（dragend 还没来），
        //    于是中间闪一帧「普通鼠标」（实际出现的「中间会有一帧跳到鼠标的光标」）。
        //    现在只让 dragend 解除；拖到窗口外松手的情况由 blur 兜底。
        var onDropKeepCursor = function () {
          // drop 只清「正在拖哪个项目」这个记录，**不动光标** —— 光标等 dragend 再放。
          draggingWorkspaceId = null
          clearEveryDropMark()
        }
        bindDocument(document, 'drop', onDropKeepCursor, true)
        bindDocument(window, 'blur', onEnd, false)
        return function () {
          document.removeEventListener('mousedown', onPress, true)
          document.removeEventListener('mouseup', onRelease, true)
          document.removeEventListener('dragend', onRelease, true)
          document.removeEventListener('dragstart', onStart, true)
          document.removeEventListener('dragend', onEnd, true)
          document.removeEventListener('drop', onDropKeepCursor, true)
          document.removeEventListener('mousemove', heal, true)
          document.removeEventListener('visibilitychange', onHidden)
          window.removeEventListener('blur', heal)
          window.removeEventListener('blur', onEnd)
          onEnd()
        }
      }, 'sidebar-pro: drag cursor')

      // 侧栏随时可能被重建（折叠、切会话、热更新），所以持续盯着它。
      ctx.effect(function () {
        var pending = false
        var schedule = function () {
          if (pending) return
          pending = true
          window.requestAnimationFrame(function () {
            pending = false
            // 如果已经被新的一份接管了，这一份就安静地待着，别再动界面。
            // 少了这一句，新旧两份会互相删对方的节点，界面会一直闪、一直重复。
            if (!stillOwner()) return
            ensureSidebar(ctx, t)
          })
        }
        // 只盯「侧栏」那一小块，不盯整个页面。
        //
        // 为什么？之前盯的是整个 document，聊天区每吐一个字、每滚一下，
        // 都会把我们的重画逻辑叫起来跑一遍 —— 于是点「收起 / 展开」时特别卡。
        // 我们只改造侧栏，所以只看侧栏就够；别处的变动与我们无关。
        //
        // 侧栏本身可能被整个换掉（切会话、折叠），所以还要盯着它的「父节点」，
        // 这样侧栏被删除、重建时我们也能立刻发现。
        // 把「请立刻重画」接到 schedule 上（点折叠、拖动排序之后要用）
        repaint = schedule
        var observer = new MutationObserver(schedule)
        var watchSidebar = function () {
          observer.disconnect()
          var anchor = document.querySelector('[data-slot="sidebar"]')
          if (anchor === null) {
            observer.observe(document.body, { childList: true })
            return
          }
          // 只盯侧栏自己这一小块。
          //
          // 为什么不盯它的父节点？因为父节点是整个外框（含聊天区），
          // subtree:true 会把聊天区里的每个变化都报上来 —— 侧栏做宽度动画时
          // 浏览器一直在改布局，重画逻辑就会每帧都跑，动画直接卡住。
          //
          // ⚠️ attributeFilter 是必须的：我们还要监听 aria-current
          //    （「当前选中哪个面板」是靠它表达的，点完要跟着换高亮）。
          //    不加过滤的话，页面上任何属性变化都会叫醒我们，性能会崩。
          observer.observe(anchor, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['aria-current'],
          })
          // 侧栏被整个换掉（切会话、折叠）也要能发现，所以额外盯一层父节点，
          // 但**只要 childList**（不递归），这样只有「侧栏本身被增删」才会通知我们。
          if (anchor.parentNode !== null) {
            observer.observe(anchor.parentNode, { childList: true })
          }
        }
        watchSidebar()
        // 每隔一会儿重新确认一次「盯的目标」还在（侧栏被换掉后要改盯新的）
        var rebind = window.setInterval(watchSidebar, 2000)

        // 官方那份「状态表」一变就重画一次。
        //
        // 为什么非要订这一份不可？因为「点开一条对话 → 未读绿点立刻变灰」这件事，
        // 光靠侧栏的 MutationObserver 等不到：点开对话时侧栏不一定有我们能看见的
        // 变动（我们只监听 childList + aria-current）。状态表是官方清掉未读的
        // 那一刻直接通知的，订它才准。
        var unsubscribeStatus = null
        try {
          var statusService = ctx.get('uiSession')
          var statusStore = statusService === null || statusService === undefined ? null : statusService.sessionStatus
          if (statusStore !== null && statusStore !== undefined && typeof statusStore.subscribe === 'function') {
            unsubscribeStatus = statusStore.subscribe(schedule)
          }
        } catch (error) {
          unsubscribeStatus = null
        }

        /** 收走这一份画的东西、停掉观察器。旧实例被新实例接管时会被调用。 */
        var cleanup = function () {
          observer.disconnect()
          if (typeof unsubscribeStatus === 'function') unsubscribeStatus()
          unsubscribeStatus = null
          window.clearInterval(rebind)
          if (injected.column !== null && injected.column.parentNode !== null) injected.column.parentNode.removeChild(injected.column)
          if (sections.box !== null && sections.box.parentNode !== null) sections.box.parentNode.removeChild(sections.box)
          injected.column = null
          sections.box = null
          // ⚠️ 关键：把这一份挂在 document / window 上的拖拽监听也摘掉。
          //    不摘的话，热更新后旧实例仍然会处理 mousedown / mousemove / mouseup，
          //    旧的「拖对话 = 整个项目置顶」会和新逻辑同时生效 ——
          //    使用者看到的就是「对话上去了，项目也跟着出来」。
          unbindDocumentListeners()
        }
        if (myBadge !== null) myBadge.release = cleanup

        schedule()
        return cleanup
      }, 'sidebar-pro: sidebar decoration')

      // 把「Skill 管理」那一页也挂上。
      skillHalf.apply(ctx)





























































    }

    // ── Skill 管理页（本插件的一部分）──
    //
    // 这一段自带语言包、样式、侧栏那一行图标和整个页面。
    // 只改了三处：
    //   ① 网址前缀 → 主插件的 /dsh-left-sidebar-pro/skill；
    //   ② 口令变量名 → 主插件注入的那个；
    //   ③ 样式所有权标记 → 主插件的包名（不然主插件重载时这张样式表会被当成无主的删掉）。
    // 页面编号仍然是 'skills'，所以 More 里那一行「技能」不用改，照样点得开。
    var skillHalf = (function () {
    var module = { exports: {} }
    var exports = module.exports

    var React = require('react')
    var h = React.createElement

    //#region 常量

    /** 本插件的语言包命名空间。 */
    var NS = 'skillPanel'

    /** 侧栏图标和主面板共用的编号：侧栏点哪一项，主区域就显示哪一页。 */
    var PANEL_ID = 'skills'

    /** 在侧栏里排第几：官方「插件」是 0、「自动化任务」是 10，这里排在它们后面。 */
    var PANEL_ORDER = 30

    /** 宿主半的网址前缀，必须和 index.js 里的一致。 */
    var ROUTE = '/dsh-left-sidebar-pro/skill'

    /** 首页注入的口令变量名（宿主半写进去的）。 */
    var GLOBAL_NAME = '__DSH_LEFT_SIDEBAR_PRO__'

    //#endregion

    //#region 语言包

    /** 英文文案。 */
    var en = {
      panel: 'Skill',
      nav: 'Skill management',
      sectionIntro: 'Every skill this machine has discovered — bundled, user-level and per-workspace. Disable one without deleting anything, read its instructions, or reveal it in Finder.',
      search: 'Search by name or description',
      refresh: 'Refresh',
      loading: 'Reading skills…',
      loadFailed: 'Could not read the skill list',
      retry: 'Retry',
      empty: 'No skill was found on this machine.',
      emptySearch: 'No skill matches this search.',
      incomplete: 'Some folders could not be read, so this list may be incomplete.',
      countOne: '1 skill',
      countMany: '{n} skills',
      disabledCount: '{n} disabled',
      groupProject: 'Project skills',
      groupUser: 'Personal skills',
      groupCustom: 'Custom folders',
      groupRuntime: 'Runtime',
      groupOther: 'Other',
      groupBundled: 'Bundled with DSH',
      sourceProjectDsh: 'Project .dsh',
      sourceProjectAgents: 'Project .agents',
      sourceUserDsh: 'Personal .dsh',
      sourceUserAgents: 'Personal .agents',
      sourceCustom: 'Custom',
      sourceBundled: 'Bundled',
      sourceRuntime: 'Runtime',
      stateOn: 'Enabled',
      statePartial: 'Manual only',
      stateOff: 'Disabled',
      readonly: 'Read-only',
      details: 'Details',
      reveal: 'Show in Finder',
      disable: 'Disable',
      enable: 'Enable',
      trash: 'Move to Trash',
      trashArmed: 'Click again to confirm',
      working: 'Working…',
      close: 'Close',
      description: 'Description',
      whenToUse: 'When to use',
      location: 'File',
      provider: 'Provider',
      workspace: 'Workspace',
      policy: 'Invocation',
      policyText: 'model {model} · manual {user}',
      yes: 'yes',
      no: 'no',
      instructions: 'Instructions',
      frontmatter: 'Front matter',
      truncated: 'This file is long; only the beginning is shown.',
      trashNote: '“Move to Trash” puts the whole skill folder in the macOS Trash, where you can put it back.',
      changed: 'Done. The list was refreshed.',
      readFailed: 'Could not read this skill.',
    }

    /** 中文文案。 */
    var zh = {
      panel: 'Skill',
      nav: 'Skill 管理',
      sectionIntro: '这里列出本机已经发现的全部 skill：DSH 自带的、你自己装在个人目录里的、以及各个工作区项目里的。可以在这里停用、读说明书，或者在访达里找到它。',
      search: '搜索名称或说明',
      refresh: '刷新',
      loading: '正在读取技能列表…',
      loadFailed: '读取技能列表失败',
      retry: '重试',
      empty: '这台电脑上还没有发现任何 skill。',
      emptySearch: '没有匹配的 skill。',
      incomplete: '有个别目录没读到，下面这份名单可能不全。',
      countOne: '共 1 个技能',
      countMany: '共 {n} 个技能',
      disabledCount: '其中 {n} 个已停用',
      groupProject: '项目技能',
      groupUser: '个人技能',
      groupCustom: '自定义目录',
      groupRuntime: '临时注册',
      groupOther: '其他',
      groupBundled: 'DSH 自带',
      sourceProjectDsh: '项目的 .dsh',
      sourceProjectAgents: '项目的 .agents',
      sourceUserDsh: '个人 .dsh',
      sourceUserAgents: '个人 .agents',
      sourceCustom: '自定义',
      sourceBundled: 'DSH 自带',
      sourceRuntime: '临时',
      stateOn: '已启用',
      statePartial: '仅手动可用',
      stateOff: '已停用',
      readonly: '只读',
      details: '详情',
      reveal: '打开文件夹',
      disable: '停用',
      enable: '启用',
      trash: '移入回收站',
      trashArmed: '再点一次确认',
      working: '处理中…',
      close: '关闭',
      description: '说明',
      whenToUse: '什么时候用',
      location: '文件位置',
      provider: '来源',
      workspace: '所属工作区',
      policy: '调用权限',
      policyText: '模型 {model} · 手动 {user}',
      yes: '可以',
      no: '不可以',
      instructions: '说明书正文',
      frontmatter: '前置信息',
      truncated: '这个文件很长，只显示前面一部分。',
      trashNote: '「移入回收站」会把整个 skill 文件夹放进 macOS 的废纸篓，随时可以从废纸篓里还原。',
      changed: '已完成，名单已刷新。',
      readFailed: '这个 skill 读不出来。',
    }

    //#endregion

    //#region 样式

    // 所有颜色都引用 DSH 自己的主题变量（--dsw-alias-*），所以深浅色自动跟随。
    var CSS = [
      '.dsh-skill-page{display:flex;width:100%;min-width:0;height:100%;min-height:0;overflow:hidden;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-size:14px;line-height:1.6}',
      '.dsh-skill-scroll{flex:1;min-height:0;overflow:auto;scrollbar-gutter:stable}',
      '.dsh-skill-content{max-width:960px;margin:0 auto;padding:0 clamp(24px,4vw,48px) 56px}',
      '.dsh-skill-heading{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:6px;padding-top:28px}',
      '[data-platform=darwin] .dsh-skill-heading{padding-top:calc(28px + var(--dsh-frame-top-clearance,0px))}',
      '.dsh-skill-heading h1{flex:1;min-width:0;margin:0;font-size:20px;font-weight:500;line-height:28px}',
      '.dsh-skill-summary{color:var(--dsw-alias-label-tertiary);margin:0 0 16px;font-size:12px}',
      '.dsh-skill-intro{color:var(--dsw-alias-label-tertiary);margin:0 0 18px;font-size:13px}',
      '.dsh-skill-toolbar{display:flex;align-items:center;gap:10px;margin-bottom:20px;flex-wrap:wrap}',
      '.dsh-skill-search{flex:1;min-width:200px;box-sizing:border-box;height:30px;padding:0 10px;border:.5px solid var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font-family:inherit;font-size:13px}',
      '.dsh-skill-search:focus{outline:none;border-color:var(--dsw-alias-border-l4)}',
      '.dsh-skill-button{box-sizing:border-box;display:inline-flex;align-items:center;gap:5px;height:26px;padding:0 10px;border:.5px solid var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-sm);background:0 0;color:var(--dsw-alias-label-secondary);font-family:inherit;font-size:12px;line-height:16px;cursor:pointer;white-space:nowrap}',
      '.dsh-skill-button:hover:not(:disabled){color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}',
      '.dsh-skill-button:disabled{opacity:.5;cursor:default}',
      '.dsh-skill-button[data-danger=armed]{color:var(--dsw-alias-state-error-primary);border-color:var(--dsw-alias-state-error-primary)}',
      '.dsh-skill-group{margin-bottom:26px}',
      '.dsh-skill-groupHead{margin:0 0 8px;letter-spacing:.06em;text-transform:uppercase;color:var(--dsw-alias-label-tertiary);font-size:12px;font-weight:600}',
      '.dsh-skill-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:10px}',
      '.dsh-skill-card{display:flex;align-items:flex-start;gap:14px;box-sizing:border-box;padding:12px 14px;border:.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-lg);background:var(--dsw-alias-bg-layer-2)}',
      '.dsh-skill-card[data-off=true]{opacity:.62}',
      '.dsh-skill-cardMain{flex:1;min-width:0}',
      '.dsh-skill-cardTitle{display:flex;align-items:center;gap:8px;flex-wrap:wrap}',
      '.dsh-skill-name{font-weight:600;font-size:14px}',
      '.dsh-skill-tag{box-sizing:border-box;height:19px;padding:0 7px;border-radius:999px;border:.5px solid var(--dsw-alias-border-l3);color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:18px;white-space:nowrap}',
      '.dsh-skill-tag[data-kind=on]{color:var(--dsw-alias-state-business-primary);border-color:var(--dsw-alias-state-business-primary)}',
      '.dsh-skill-tag[data-kind=partial]{color:var(--dsw-alias-state-warning-primary);border-color:var(--dsw-alias-state-warning-primary)}',
      '.dsh-skill-tag[data-kind=off]{color:var(--dsw-alias-state-error-primary);border-color:var(--dsw-alias-state-error-primary)}',
      '.dsh-skill-desc{margin:6px 0 0;color:var(--dsw-alias-label-secondary);font-size:13px;overflow-wrap:anywhere}',
      '.dsh-skill-path{margin-top:6px;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px;overflow-wrap:anywhere;word-break:break-all}',
      '.dsh-skill-actions{display:flex;flex-direction:column;gap:6px;flex:none}',
      '.dsh-skill-note{color:var(--dsw-alias-label-tertiary);margin:14px 0 0;font-size:12px}',
      '.dsh-skill-error{color:var(--dsw-alias-state-error-primary);margin:0 0 14px;font-size:12px}',
      '.dsh-skill-toast{position:fixed;left:50%;bottom:28px;transform:translateX(-50%);z-index:42;max-width:70vw;padding:8px 14px;border:.5px solid var(--dsw-alias-settings-card-stroke);border-radius:999px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font-family:var(--dsw-font-family);font-size:12px;line-height:18px;box-shadow:0 8px 28px var(--dsw-alias-bg-mask-drop)}',
      /* 详情弹窗 */
      '.dsh-skill-overlay{position:fixed;inset:0;z-index:41;display:flex;align-items:center;justify-content:center;padding:24px;background:var(--dsw-alias-bg-mask-drop)}',
      '.dsh-skill-modal{box-sizing:border-box;width:min(880px,100%);max-height:min(82vh,900px);display:flex;flex-direction:column;border:.5px solid var(--dsw-alias-settings-card-stroke);border-radius:var(--dsw-radius-lg);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-size:13px;line-height:20px;box-shadow:0 16px 48px var(--dsw-alias-bg-mask-drop);overflow:hidden}',
      '.dsh-skill-modalHead{display:flex;align-items:center;gap:10px;padding:11px 14px;border-bottom:.5px solid var(--dsw-alias-border-l2)}',
      '.dsh-skill-modalHead h2{flex:1;min-width:0;margin:0;font-size:15px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.dsh-skill-modalBody{flex:1;min-height:0;overflow:auto;padding:14px 16px;display:flex;flex-direction:column;gap:14px}',
      '.dsh-skill-field{display:flex;flex-direction:column;gap:3px}',
      '.dsh-skill-fieldLabel{color:var(--dsw-alias-label-tertiary);font-size:11px;letter-spacing:.04em;text-transform:uppercase}',
      '.dsh-skill-fieldValue{overflow-wrap:anywhere;word-break:break-word}',
      '.dsh-skill-code{margin:0;padding:10px 12px;border:.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-layer-2);font-family:var(--dsw-font-family-mono,ui-monospace,SFMono-Regular,Menlo,monospace);font-size:12px;line-height:18px;white-space:pre-wrap;overflow-wrap:anywhere;max-height:46vh;overflow:auto}',
    ].join('')

    //#endregion

    //#region 与宿主半通信

    /** 已经拿到的口令（首页注入的，或握手要来的）。 */
    var cachedToken = ''

    /**
     * 取首页注入的口令。
     * @returns {string} 口令，拿不到时是空串。
     */
    function injectedToken() {
      var injected = window[GLOBAL_NAME]
      return injected && typeof injected.token === 'string' ? injected.token : ''
    }

    /**
     * 确保手上有一个口令：先用首页注入的；没有就带着登录 Cookie 找宿主半要一次。
     * @returns {Promise<string>} 口令，失败时是空串。
     */
    function ensureToken() {
      if (cachedToken) return Promise.resolve(cachedToken)
      var injected = injectedToken()
      if (injected) {
        cachedToken = injected
        return Promise.resolve(cachedToken)
      }
      return fetch(ROUTE + '/handshake', { credentials: 'same-origin', cache: 'no-store' })
        .then(function (response) { return response.ok ? response.json() : null })
        .then(function (data) {
          cachedToken = data && typeof data.token === 'string' ? data.token : ''
          return cachedToken
        })
        .catch(function () { return '' })
    }

    /**
     * 真正发一次请求。
     * @param {string} path 例如 `/list`。
     * @param {object} init fetch 选项。
     * @param {string} token 口令。
     * @returns {Promise<any>} 响应里的 JSON。
     */
    function send(path, init, token) {
      var headers = Object.assign({ 'x-dsh-skill-token': token }, init.headers || {})
      if (init.body !== undefined) headers['content-type'] = 'application/json'
      return fetch(ROUTE + path, {
        method: init.method || 'GET',
        body: init.body,
        headers: headers,
        credentials: 'same-origin',
        cache: 'no-store',
      }).then(function (response) {
        return response.json().catch(function () { return {} }).then(function (data) {
          if (!response.ok) {
            var message = data && data.error ? data.error : 'HTTP ' + response.status
            throw new Error(message)
          }
          return data
        })
      })
    }

    /**
     * 调宿主半的接口；口令过期（DSH 重启过）时自动重新握手再试一次。
     * @param {string} path 例如 `/list`。
     * @param {object} [options] fetch 选项。
     * @returns {Promise<any>} 响应里的 JSON。
     */
    function api(path, options) {
      var init = options || {}
      var used = ''
      return ensureToken().then(function (token) {
        used = token
        return send(path, init, token)
      }).catch(function (error) {
        if (used === '' || String(error && error.message) !== 'forbidden') throw error
        cachedToken = ''
        return ensureToken().then(function (token) {
          return send(path, init, token)
        })
      })
    }

    /**
     * 所有后端调用集中在这里，页面组件只认这几个方法。
     * @returns {object} 后端接口集合。
     */
    function createApi() {
      return {
        /** @returns {Promise<any>} 技能名单。 */
        list: function () { return api('/list') },
        /**
         * 读一个 skill 的说明书正文。
         * @param {object} row 名单里的一行（带名字和路径）。
         * @returns {Promise<any>} 正文。
         */
        read: function (row) {
          return api('/read?path=' + encodeURIComponent(row.path) + '&name=' + encodeURIComponent(row.name))
        },
        /**
         * @param {string} path 说明书路径。
         * @param {boolean} enabled 是否启用。
         * @returns {Promise<any>} 结果。
         */
        setEnabled: function (path, enabled) {
          return api('/enabled', { method: 'POST', body: JSON.stringify({ path: path, enabled: enabled }) })
        },
        /** @param {string} path 说明书路径。 @returns {Promise<any>} 结果。 */
        reveal: function (path) {
          return api('/reveal', { method: 'POST', body: JSON.stringify({ path: path }) })
        },
        /** @param {string} path 说明书路径。 @returns {Promise<any>} 结果。 */
        trash: function (path) {
          return api('/trash', { method: 'POST', body: JSON.stringify({ path: path }) })
        },
      }
    }

    //#endregion

    //#region 小组件

    /**
     * 把一句文案里的 {n} 换成真实数字。
     * @param {string} template 文案。
     * @param {object} values 变量表。
     * @returns {string} 替换后的文案。
     */
    function fill(template, values) {
      return template.replace(/\{(\w+)\}/g, function (whole, key) {
        return Object.prototype.hasOwnProperty.call(values, key) ? String(values[key]) : whole
      })
    }

    /**
     * 一个 skill 属于哪一组（决定页面上排在哪个标题下面）。
     * @param {string} source 来源标识。
     * @returns {string} 组名。
     */
    function groupOf(source) {
      if (source === 'project-dsh' || source === 'project-agents') return 'project'
      if (source === 'user-dsh' || source === 'user-agents') return 'user'
      if (source === 'custom') return 'custom'
      if (source === 'runtime') return 'runtime'
      if (source === 'bundled') return 'bundled'
      return 'other'
    }

    /** 分组顺序：项目 → 使用者 → 自定义 → 其他 → DSH 自带。 */
    var GROUP_ORDER = ['project', 'user', 'custom', 'runtime', 'other', 'bundled']

    /**
     * 来源标识翻成页面上显示的短标签。
     * @param {string} source 来源标识。
     * @param {Function} t 翻译函数。
     * @returns {string} 短标签。
     */
    function sourceLabel(source, t) {
      if (source === 'project-dsh') return t('sourceProjectDsh')
      if (source === 'project-agents') return t('sourceProjectAgents')
      if (source === 'user-dsh') return t('sourceUserDsh')
      if (source === 'user-agents') return t('sourceUserAgents')
      if (source === 'custom') return t('sourceCustom')
      if (source === 'bundled') return t('sourceBundled')
      if (source === 'runtime') return t('sourceRuntime')
      return source
    }

    /**
     * 侧栏图标：一本摊开的小书，代表“说明书”。
     * @param {object} props 官方给的尺寸和选中状态。
     * @returns {object} React 元素。
     */
    function PanelIcon(props) {
      var size = props.size === undefined ? 16 : props.size
      return h(
        'svg',
        { viewBox: '0 0 16 16', width: size, height: size, 'aria-hidden': true, focusable: false },
        h('path', {
          d: 'M2.4 3.1h4.2c.8 0 1.4.6 1.4 1.4v8.4c0-.7-.6-1.2-1.2-1.2H2.4z',
          fill: 'currentColor',
        }),
        h('path', {
          d: 'M13.6 3.1H9.4c-.8 0-1.4.6-1.4 1.4v8.4c0-.7.6-1.2 1.2-1.2h4.4z',
          fill: 'currentColor',
          opacity: 0.55,
        }),
      )
    }

    /**
     * 详情弹窗：显示一个 skill 的完整说明书。
     * @param {object} props 名称、路径、正文、关闭回调、翻译函数。
     * @returns {object} React 元素。
     */
    function DetailDialog(props) {
      var t = props.t
      var row = props.row
      var detail = props.detail
      var onClose = props.onClose

      React.useEffect(function () {
        var onKeyDown = function (event) {
          if (event.key === 'Escape') onClose()
        }
        document.addEventListener('keydown', onKeyDown)
        return function () { document.removeEventListener('keydown', onKeyDown) }
      }, [onClose])

      var policy = row.policy
      var fields = [
        [t('description'), row.description],
        [t('whenToUse'), row.whenToUse],
        [t('location'), row.path],
        [t('provider'), row.provider],
        [t('workspace'), (row.workspaces || []).join('、')],
        [t('policy'), fill(t('policyText'), {
          model: policy.model ? t('yes') : t('no'),
          user: policy.user ? t('yes') : t('no'),
        })],
      ].filter(function (pair) { return typeof pair[1] === 'string' && pair[1].length > 0 })

      var body = null
      if (detail.status === 'loading') {
        body = h('p', { className: 'dsh-skill-note' }, t('loading'))
      } else if (detail.status === 'error') {
        body = h('p', { className: 'dsh-skill-error' }, t('readFailed') + ' ' + detail.error)
      } else {
        body = h(
          'div',
          { className: 'dsh-skill-field' },
          h('span', { className: 'dsh-skill-fieldLabel' }, t('instructions')),
          h('pre', { className: 'dsh-skill-code' }, detail.body),
          detail.truncated ? h('p', { className: 'dsh-skill-note' }, t('truncated')) : null,
        )
      }

      return h(
        'div',
        {
          className: 'dsh-skill-overlay',
          onMouseDown: function (event) { if (event.target === event.currentTarget) onClose() },
        },
        h(
          'div',
          { className: 'dsh-skill-modal', role: 'dialog', 'aria-modal': true },
          h(
            'div',
            { className: 'dsh-skill-modalHead' },
            h('h2', {}, row.name),
            h('button', { type: 'button', className: 'dsh-skill-button', onClick: onClose }, t('close')),
          ),
          h(
            'div',
            { className: 'dsh-skill-modalBody' },
            fields.map(function (pair) {
              return h(
                'div',
                { className: 'dsh-skill-field', key: pair[0] },
                h('span', { className: 'dsh-skill-fieldLabel' }, pair[0]),
                h('span', { className: 'dsh-skill-fieldValue' }, pair[1]),
              )
            }),
            body,
          ),
        ),
      )
    }

    //#endregion

    //#region 主页面

    /**
     * 「Skill 管理」主页面。
     * @param {object} props 官方给的翻译函数，加上本插件注入的后端接口。
     * @returns {object} React 元素。
     */
    function SkillPanel(props) {
      var t = props.t
      var api = props.api

      var statePair = React.useState({ status: 'loading', error: null, skills: [], complete: true, trash: '' })
      var state = statePair[0]
      var setState = statePair[1]

      var queryPair = React.useState('')
      var query = queryPair[0]
      var setQuery = queryPair[1]

      var detailPair = React.useState(null)
      var detail = detailPair[0]
      var setDetail = detailPair[1]

      var toastPair = React.useState('')
      var toast = toastPair[0]
      var setToast = toastPair[1]

      var armedPair = React.useState('')
      var armed = armedPair[0]
      var setArmed = armedPair[1]

      var busyPair = React.useState('')
      var busy = busyPair[0]
      var setBusy = busyPair[1]

      /**
       * 拉一次名单。
       * @returns {Promise<void>} 完成即返回。
       */
      var load = React.useCallback(function () {
        setState(function (prev) {
          return { status: 'loading', error: null, skills: prev.skills, complete: prev.complete, trash: prev.trash }
        })
        return api.list().then(function (data) {
          setState({
            status: 'ready',
            error: null,
            skills: Array.isArray(data.skills) ? data.skills : [],
            complete: data.complete !== false,
            trash: typeof data.trash === 'string' ? data.trash : '',
          })
        }).catch(function (error) {
          setState(function (prev) {
            return { status: 'error', error: String((error && error.message) || error), skills: prev.skills, complete: prev.complete, trash: prev.trash }
          })
        })
      }, [api])

      React.useEffect(function () { load() }, [load])

      // 提示条 2.4 秒后自己消失。
      React.useEffect(function () {
        if (toast === '') return undefined
        var timer = setTimeout(function () { setToast('') }, 2400)
        return function () { clearTimeout(timer) }
      }, [toast])

      /**
       * 停用 / 启用一个 skill。
       * @param {object} row 名单里的一行。
       * @returns {void}
       */
      function toggle(row) {
        var next = row.policy.state !== 'on'
        setBusy(row.key)
        api.setEnabled(row.path, next).then(function () {
          setToast(t('changed'))
          return load()
        }).catch(function (error) {
          setToast(String((error && error.message) || error))
        }).then(function () { setBusy('') })
      }

      /**
       * 第一步只是“上膛”，第二步才真的移入废纸篓，防手滑。
       * @param {object} row 名单里的一行。
       * @returns {void}
       */
      function trash(row) {
        if (armed !== row.key) {
          setArmed(row.key)
          setTimeout(function () { setArmed(function (current) { return current === row.key ? '' : current }) }, 4000)
          return
        }
        setArmed('')
        setBusy(row.key)
        api.trash(row.path).then(function () {
          setToast(t('changed'))
          return load()
        }).catch(function (error) {
          setToast(String((error && error.message) || error))
        }).then(function () { setBusy('') })
      }

      /**
       * 打开详情：先弹窗，再把正文读回来填进去。
       * @param {object} row 名单里的一行。
       * @returns {void}
       */
      function openDetail(row) {
        setDetail({ status: 'loading', body: '', truncated: false, error: '', row: row })
        api.read(row).then(function (data) {
          setDetail({
            status: 'ready',
            body: typeof data.body === 'string' ? data.body : '',
            truncated: data.truncated === true,
            error: '',
            row: row,
          })
        }).catch(function (error) {
          setDetail({ status: 'error', body: '', truncated: false, error: String((error && error.message) || error), row: row })
        })
      }

      var skills = state.skills
      var needle = query.trim().toLowerCase()
      var filtered = needle.length === 0 ? skills : skills.filter(function (row) {
        return (row.name + ' ' + row.description).toLowerCase().indexOf(needle) !== -1
      })

      var disabledTotal = skills.filter(function (row) { return row.policy.state !== 'on' }).length
      var summary = skills.length === 1 ? t('countOne') : fill(t('countMany'), { n: skills.length })
      if (disabledTotal > 0) summary = summary + ' · ' + fill(t('disabledCount'), { n: disabledTotal })

      var groups = GROUP_ORDER.map(function (group) {
        var rows = filtered.filter(function (row) { return groupOf(row.source) === group })
        if (rows.length === 0) return null
        var head = group === 'project' ? t('groupProject')
          : group === 'user' ? t('groupUser')
            : group === 'custom' ? t('groupCustom')
              : group === 'runtime' ? t('groupRuntime')
                : group === 'bundled' ? t('groupBundled')
                  : t('groupOther')
        return h(
          'section',
          { className: 'dsh-skill-group', key: group },
          h('h2', { className: 'dsh-skill-groupHead' }, head),
          h(
            'ul',
            { className: 'dsh-skill-list' },
            rows.map(function (row) {
              var off = row.policy.state === 'off'
              var stateLabel = row.policy.state === 'on' ? t('stateOn')
                : row.policy.state === 'partial' ? t('statePartial')
                  : t('stateOff')
              var working = busy === row.key
              return h(
                'li',
                { className: 'dsh-skill-card', key: row.key, 'data-off': String(off) },
                h(
                  'div',
                  { className: 'dsh-skill-cardMain' },
                  h(
                    'div',
                    { className: 'dsh-skill-cardTitle' },
                    h('span', { className: 'dsh-skill-name' }, row.name),
                    h('span', { className: 'dsh-skill-tag' }, sourceLabel(row.source, t)),
                    h('span', { className: 'dsh-skill-tag', 'data-kind': row.policy.state }, stateLabel),
                    row.editable ? null : h('span', { className: 'dsh-skill-tag' }, t('readonly')),
                  ),
                  row.description ? h('p', { className: 'dsh-skill-desc' }, row.description) : null,
                  row.path ? h('div', { className: 'dsh-skill-path' }, row.path) : null,
                ),
                h(
                  'div',
                  { className: 'dsh-skill-actions' },
                  h('button', {
                    type: 'button',
                    className: 'dsh-skill-button',
                    disabled: working,
                    onClick: function () { openDetail(row) },
                  }, t('details')),
                  h('button', {
                    type: 'button',
                    className: 'dsh-skill-button',
                    disabled: working || !row.editable,
                    onClick: function () { api.reveal(row.path).catch(function () {}) },
                  }, t('reveal')),
                  h('button', {
                    type: 'button',
                    className: 'dsh-skill-button',
                    disabled: working || !row.editable,
                    onClick: function () { toggle(row) },
                  }, working ? t('working') : off ? t('enable') : t('disable')),
                  h('button', {
                    type: 'button',
                    className: 'dsh-skill-button',
                    disabled: working || !row.editable,
                    'data-danger': armed === row.key ? 'armed' : 'idle',
                    onClick: function () { trash(row) },
                  }, armed === row.key ? t('trashArmed') : t('trash')),
                ),
              )
            }),
          ),
        )
      }).filter(Boolean)

      var status = null
      if (state.status === 'loading' && skills.length === 0) {
        status = h('p', { className: 'dsh-skill-note', role: 'status' }, t('loading'))
      } else if (state.status === 'error') {
        status = h(
          'p',
          { className: 'dsh-skill-note', role: 'status' },
          t('loadFailed') + '（' + state.error + '）',
          ' ',
          h('button', { type: 'button', className: 'dsh-skill-button', onClick: function () { load() } }, t('retry')),
        )
      } else if (filtered.length === 0) {
        status = h('p', { className: 'dsh-skill-note', role: 'status' }, needle.length > 0 ? t('emptySearch') : t('empty'))
      }

      return h(
        'div',
        { className: 'dsh-skill-page' },
        h(
          'div',
          { className: 'dsh-skill-scroll' },
          h(
            'div',
            { className: 'dsh-skill-content' },
            h(
              'div',
              { className: 'dsh-skill-heading' },
              h('h1', { tabIndex: -1 }, t('nav')),
              h('button', {
                type: 'button',
                className: 'dsh-skill-button',
                onClick: function () { load() },
              }, t('refresh')),
            ),
            h('p', { className: 'dsh-skill-summary' }, summary),
            h('p', { className: 'dsh-skill-intro' }, t('sectionIntro')),
            h(
              'div',
              { className: 'dsh-skill-toolbar' },
              h('input', {
                className: 'dsh-skill-search',
                type: 'search',
                value: query,
                placeholder: t('search'),
                'aria-label': t('search'),
                onChange: function (event) { setQuery(event.target.value) },
              }),
            ),
            state.complete ? null : h('p', { className: 'dsh-skill-note' }, t('incomplete')),
            state.status === 'error' ? h('p', { className: 'dsh-skill-error', role: 'alert' }, state.error) : null,
            status,
            groups,
            h('p', { className: 'dsh-skill-note' }, t('trashNote')),
          ),
        ),
        detail === null ? null : h(DetailDialog, {
          t: t,
          row: detail.row,
          detail: detail,
          onClose: function () { setDetail(null) },
        }),
        toast === '' ? null : h('div', { className: 'dsh-skill-toast', role: 'status' }, toast),
      )
    }

    //#endregion

    //#region 插件入口

    /** 需要 DSH 提供的客户端能力：座位表和语言包。 */
    var inject = ['slots', 'locale']

    /**
     * 插件入口：注册语言包、样式、侧栏图标和主面板。
     * @param {object} ctx 客户端插件上下文。
     * @returns {void}
     */
    function apply(ctx) {
      var t = ctx.locale.bind(NS)
      var api = createApi()

      ctx.effect(function () {
        return ctx.locale.register(NS, { en: en, zh: zh })
      }, 'skill-panel: dictionaries')

      ctx.effect(function () {
        var style = document.createElement('style')
        // data-plugin 是 DSH 模块系统的「所有权标记」。少了它，这张样式表会被当成
        // 无主的，记到下一个加载的插件名下，并在那个插件重载时被一起删掉。
        style.setAttribute('data-plugin', '@local/dsh-left-sidebar-pro')
        style.setAttribute('data-dsh-plugin', '@local/dsh-left-sidebar-pro')
        style.textContent = CSS
        document.head.appendChild(style)
        return function () { style.remove() }
      }, 'skill-panel: styles')

      ctx.slots.inject('sidebar.panellist', function () {
        return ctx.slots.register({
          name: 'sidebar.panellist',
          id: PANEL_ID,
          order: PANEL_ORDER,
          locale: NS,
          label: function () { return t('panel') },
        }, PanelIcon)
      })

      ctx.slots.inject('main', function () {
        return ctx.slots.register({
          name: 'main',
          key: PANEL_ID,
          locale: NS,
          inject: function () { return { api: api } },
        }, SkillPanel)
      })
    }

    //#endregion

    exports.apply = apply
    exports.inject = inject
    return module.exports
    })()

    //#endregion

    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})
