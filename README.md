# dsh-left-sidebar-pro

**DSH 左侧栏重排插件**：把官方左侧栏重新排成「新建对话 + More 分组 + Top 置顶区 + Project」，
并附三个整页界面：MCP 服务器、已归档对话、Skill 管理。

A sidebar layout plugin for the DeepSeek Harness (DSH) Web UI: a collapsible **More** group,
a **Top** pinned area, session status dots, inline archive buttons, and three full-page
panels (MCP servers, Archived conversations, Skill management).

> 非官方插件。本项目是第三方开源项目，与 DeepSeek 官方没有隶属、授权或合作关系。

---

## 功能

### 1. 侧栏重排

```text
New Chat        ← 官方的新建对话
More ⌄          ← 把官方那几行收进这个可展开的分组
   ├ MCP            ← 本插件提供的「MCP 服务器」整页
   ├ 已归档          ← 本插件提供的「已归档对话」整页
   ├ Skill          ← 本插件提供的「Skill 管理」整页
   ├ 插件            ← 官方页面
   └ 自动化任务       ← 官方页面
Top ⌄           ← 置顶区：置顶整个项目，或单独置顶一条对话
Project ⌄       ← 官方的项目 / 会话列表（原样保留，加了展开收起动画）
```

- `More` 里的各项可以按住拖动排序，顺序记在浏览器本地，下次打开还是你排的顺序。
- 官方侧栏行、会话列表、主面板都保留，插件只是重新摆放并补上动画和入口。

### 2. Top 置顶区

- **单独置顶一条对话**：从 Project 里拖一条对话上来，只把这一条放进 Top，不会把整个项目带上来。
  新拖上去的排在最前；拖回 Project 就自动取消置顶。
- **置顶一整个项目**：拖项目那一行上来，整个项目（连里面的对话）进 Top。
  鼠标划到项目行右边会出现「移回工作区」按钮，点一下送回去。
- **展开看对话**：点项目行展开，点对话打开。
- **在 Top 里直接归档**：对话行右边有「归档」按钮，走官方原路；要停掉正在跑的对话时，官方的确认弹窗照样会出现。
- **排序**：置顶项目之间可以拖动排序。

> 项目整个已经置顶时，它里面的对话仍然可以**单独**置顶。如果那个项目文件夹正好是展开的，
> 同一个标题会出现两次：上面带气泡图标的是「置顶的对话」，文件夹里的是项目内容。这是故意的，不是重复 bug。

### 3. 对话状态点

| 颜色 | 含义 |
|---|---|
| 🟡 黄 | **有弹窗在等你**：审批、计划待审、或者一个问题 |
| 🔵 蓝 | 正在跑（轻微呼吸） |
| 🟢 绿 | 跑完了、你还没看（**打开这条对话后立刻消失**） |
| 无点 | 已读、也没有什么事在等你（不显示点，但保留占位，名字仍然对齐） |

状态直接读 DSH 官方的 `uiSession.sessionStatus`，和官方列表里的点是同一套语义、同一时刻。

### 4. 三个整页

- **MCP 服务器**（`More → MCP`）：列出 / 新增 / 修改 / 停用 / 删除 MCP 服务器。
  改动写进 profile 补丁文件里一个带标记的区块，标记以外的内容一个字都不碰。
- **已归档对话**（`More → 已归档`）：列出已归档的对话、读正文、取消归档；
  「删除」要点两次，第一次只做标记（把那一行划掉），保留期内还能「恢复」，到期才真正删本机文件。
- **Skill 管理**（`More → Skill`）：列出本机已发现的 skill，支持搜索、读说明书、停用 / 启用、
  在访达中显示，以及移进废纸篓。

### 5. 动画

四处展开收起（More 分组 / Top 整栏 / 项目里的对话 / 官方 Project 列表里的对话）用同一套
快慢曲线：展开稍慢、收起稍快、淡入淡出分开时序。想整体调快调慢，改样式表顶部的
`--dsp-open-dur` 等几个 CSS 变量即可。

---

## 安装

### 通过 DSH 插件管理器

1. 打开 DSH 的「插件」页面。
2. 选择从 npm 安装，填入本包的包名；或者选择本地目录。
3. 安装完成后**退出并重新打开 DSH**（宿主半必须重启才生效）。

### 通过命令行

```sh
dsh plugin --profile <profile> add <包名或本目录的绝对路径>
```

例如：

```sh
dsh plugin --profile desktop add @your-scope/dsh-left-sidebar-pro
```

包名以 `package.json` 的 `name` 字段为准。

---

## 配置

`cordis.patch.yml` 里 `sidebar-pro` 那条的 `config`（**整体替换，不是深合并**）：

```yaml
      config:
        archived:
          retentionDays: 3      # 「确认删除」之后保留几天才真删（0 = 下次检查就删）
          sweepMinutes: 10      # 每隔多少分钟检查一次到期的
          # statePath: /绝对/路径.json   # 小账本换地方（默认 ~/.dsh/archived-panel/trash.json）
```

| 字段 | 默认 | 作用 |
|---|---|---|
| `retentionDays` | `3` | 标记待删除后保留几天，期间可以恢复 |
| `sweepMinutes` | `10` | 定时清扫的间隔 |
| `statePath` | `~/.dsh/archived-panel/trash.json` | 记录哪些对话被标记待删除的小账本 |

改完配置要**退出并重新打开 DSH**（宿主半不热重载）。

---

## 文件

| 文件 | 作用 |
|---|---|
| `package.json` | 包信息、图标、入口、`dsh` 加载字段 |
| `index.js` | 宿主半入口：注册 `/dsh-left-sidebar-pro/...` 接口（MCP 读写、口令注入） |
| `archived-host.js` | 宿主半：已归档对话的列表 / 正文 / 删除 / 定时清扫 |
| `skill-host.js` | 宿主半：Skill 的列表 / 正文 / 停用启用 / 定位 / 废纸篓 |
| `client.js` | 网页半：侧栏改造、三个整页、状态点、拖拽与动画 |
| `cordis.patch.yml` | 把本插件插进 DSH 插件树，并声明「已归档」的参数 |
| `icon.svg` | 插件列表里的图标 |
| `locale/en.json`、`locale/zh.json` | 插件列表的标题与说明 |
| `README.md` | 本文件 |

---

## 数据与权限

- **设置存在浏览器本地**（`dsh.sidebar-pro.*`）：置顶了哪些项目 / 对话、折叠状态、More 的排序。
  清除站点数据会把这些设置一起清掉。
- **已归档的小账本**在 `~/.dsh/archived-panel/trash.json`；
  读正文时会读本机的会话文件 `~/.dsh/sessions/...`。
- 宿主半只在 `127.0.0.1` 上注册接口，并要求一个每次启动随机生成的口令；
  口令通过首页注入，只有已经登录的 DSH 页面能拿到。
- 插件不向任何第三方服务器发送数据。

---

## 兼容性

- 需要带客户端插件支持的 DSH Web UI / 桌面版。
- 宿主半（`index.js`、`archived-host.js`、`skill-host.js`）改动后必须重启 DSH；
  网页半（`client.js`）改动后等热重载即可。
- 侧栏改造依赖官方侧栏的 DOM 结构和类名。DSH 升级后如果官方改了结构，可能需要跟着更新选择器。

---

## 开发

发布包只包含运行所需文件。维护者的测试脚本（`test.mjs`、`test-client.mjs`）不随包发布，
在私有开发目录中运行：

```sh
node test.mjs
node test-client.mjs
```

提交前至少做语法检查：

```sh
node --check index.js
node --check archived-host.js
node --check skill-host.js
node --check client.js
```

---

## 许可证

本项目使用 **MIT 许可证**。你可以免费使用、修改、分发，也可以商用；
保留版权声明和许可证文本即可，作者不承担担保责任。

完整文本见 [LICENSE](LICENSE)。
