# All in Graph 程序设计文档

版本：v0.1（初稿）  
更新日期：2025-11-30  
目标读者：产品、架构、前端、客户端、算法/LLM 工程师、测试与运维

## 1. 项目综述
- 项目目标：在传统文字对话的基础上，提供并行的图形化交互方式，让 AI 主动维护图结构（创建/更新/嵌套/优化），帮助用户在复杂主题下更清晰地组织信息与上下文。
- 交互结构：左侧会话与画布树导航；中间主画布（支持多类型图与节点嵌套）；右侧聊天区（类即时通讯，支持图片与文件）。
- 设计原则：
  - 完整的文字交互与图形交互并行输出。
  - 图形风格统一（几何线条、像素色块、克制动效）。
  - 多层级嵌套组织复杂信息，控制每画布节点与分支复杂度。
  - AI 即时响应用户操作并同步更新图结构。

## 2. 范围与非目标
- 范围：桌面端（Windows 首发）、单机为主、可选联网调用云端/本地 LLM；图形创建与维护、嵌套画布、Markdown/LaTeX 显示、上下文语义记忆与检索。
- 非目标（v0.1）：网页端、多人协作云同步、复杂的团队权限体系、长链路的企业级治理与审计。

## 3. 用户体验与界面布局
- 布局：
  - 左栏：会话列表与画布树；支持双击会话展开其主画布的子画布树；支持搜索与过滤。
  - 中间：主画布区域；支持多图并存与切换；面包屑显示当前层级；返回上一层操作便捷。
  - 右栏：聊天区；支持文本、图片文件；消息与图操作日志并列展示。
- 交互手势：
  - 左键拖拽框选批量节点；拖拽节点/边；快捷键复制/粘贴/撤销重做。
  - 双击节点：AI 给出详细解释并可生成子画布扩展结构。
  - 右键节点/边：弹出 Markdown 解释面板，支持插入注释、生成子画布、优化布局。
- 主题风格：
  - 线条：工程蓝图风几何线条，统一线宽与箭头样式。
  - 色彩：灰白主色，少量黑/红像素块点缀；重要节点可用波形角标。
  - 动效：150–200ms，丝滑但非炫技；进入/展开/折叠保持一致化过渡。

## 4. 功能需求映射
- 图形系统：创建/修改/删除多类型图（思维导图、流程图、概念关系图）；统一主题；节点与连接箭头基础操作。
- 画布与嵌套：画布作为独立操作单元；单画布多图；画布含自身描述；节点可展开为独立画布；支持多层嵌套。
- 导航与视图：节点单击跳转内部画布；返回上一层与面包屑；画布切换直观。
- 内容展示：右键解释（Markdown）；节点支持 LaTeX；解释可转注释或结构扩展。
- AI 集成：
  - AI 自动维护图形（创建、添加、嵌套、布局优化）。
  - 框选与节点选择可触发解释与结构整理；选中文本段落触发解释请求。
  - 长对话上下文管理：基于节点定位相关历史，降低记忆负担。
- 性能与设计：
  - Windows 稳定流畅；GPU 加速；分块重绘与布局异步化；增量更新。
  - 画布管理采用左侧竖向浏览器式窗口设计。

## 5. 技术选型
- 客户端壳层：Tauri（Rust + WebView）首选；Electron 备选。
- 前端框架：React + TypeScript。
- 图形引擎：AntV G6（WebGL/GPU、树/关系/DAG、Combo 组、可插拔交互）。
- Markdown/LaTeX：remark/rehype + KaTeX。
- 状态与协作：Yjs（CRDT，同步图模型与会话状态）。
- 数据存储：SQLite（JSON/TEXT 列）；向量检索：sqlite-vss 或外部向量库。
- 智能体服务：Node.js 或 Rust 后端进程，统一适配 OpenAI/Anthropic/DeepSeek/本地 LLM；工具调用层可插拔。
- 视觉识别：可选云端模型或本地模块；产出节点候选与边关系建议。

## 6. 系统架构
- 分层结构：
  - UI 层（React + G6）：导航树、画布、聊天、解释面板、主题系统。
  - 状态层（Yjs）：`GraphModel`、`CanvasModel`、`SessionState`、`MessageState`；提供 CRDT 文档与事件总线。
  - 智能体层：LLM 调用与工具编排、上下文打包、GraphDelta 生成、策略控制（节点上限/分支深度）。
  - 数据层：SQLite（结构化）+ 资源文件系统；嵌入与检索索引。
  - 平台层：Tauri 后端插件（文件/数据库/网络/本地模型）。
- 进程与通信：
  - 前端（WebView）与 Tauri 后端（Rust）通过 IPC；智能体服务可作为同进程插件或子进程 HTTP/IPC。
  - 事件总线驱动：UI 操作与 Agent 响应解耦，统一产出 GraphDelta。

## 7. 数据模型
- 实体：Workspace、Session、Canvas、Graph、Node、Edge、NestedCanvasLink、Message、Resource。
- SQL 结构示例：
```sql
CREATE TABLE session (
  id TEXT PRIMARY KEY,
  title TEXT,
  created_at INTEGER,
  updated_at INTEGER
);

CREATE TABLE canvas (
  id TEXT PRIMARY KEY,
  session_id TEXT,
  title TEXT,
  description TEXT,
  root_graph_id TEXT,
  style_theme TEXT,
  stats TEXT,
  FOREIGN KEY(session_id) REFERENCES session(id)
);

CREATE TABLE graph (
  id TEXT PRIMARY KEY,
  canvas_id TEXT,
  type TEXT,          -- mindmap | flow | concept
  layout TEXT,        -- tree | dagre | force | hierarchy
  schema_json TEXT,
  FOREIGN KEY(canvas_id) REFERENCES canvas(id)
);

CREATE TABLE node (
  id TEXT PRIMARY KEY,
  graph_id TEXT,
  label_md TEXT,
  latex_json TEXT,
  type TEXT,
  has_child_canvas INTEGER,
  metadata_json TEXT,
  embedding BLOB,
  FOREIGN KEY(graph_id) REFERENCES graph(id)
);

CREATE TABLE edge (
  id TEXT PRIMARY KEY,
  graph_id TEXT,
  source_id TEXT,
  target_id TEXT,
  kind TEXT,
  metadata_json TEXT,
  FOREIGN KEY(graph_id) REFERENCES graph(id)
);

CREATE TABLE nested_canvas_link (
  parent_node_id TEXT PRIMARY KEY,
  child_canvas_id TEXT
);

CREATE TABLE message (
  id TEXT PRIMARY KEY,
  session_id TEXT,
  role TEXT,
  content_md TEXT,
  related_node_ids TEXT,
  embedding BLOB,
  attachments_json TEXT,
  created_at INTEGER,
  FOREIGN KEY(session_id) REFERENCES session(id)
);
```
- 资源目录按 `Session/Canvas` 分层；消息与节点双向索引以便检索与上下文组装。

## 8. 状态与数据流
- GraphDelta：原子图操作表示（新增/更新/删除节点与边、布局变更、注释更新、嵌套关联）。
- 事件流：
  - 用户操作 → 事件总线 → 上下文打包 → LLM 工具调用 → GraphDelta → Yjs 应用 → G6 局部重绘。
  - 撤销/重做：基于 GraphDelta 的可逆日志；定期快照与崩溃恢复。
- 并发：Yjs CRDT 解决冲突；策略为“人类优先”，AI 检测冲突后重试或合并。

## 9. AI 交互模式
- 工具函数（方向性签名）：
```ts
create_graph({ canvasId, type, title }) => { graphId }
add_node({ graphId, labelMarkdown, type, position, latexBlocks }) => { nodeId }
add_edge({ graphId, sourceId, targetId, kind }) => { edgeId }
expand_node_to_canvas({ nodeId, strategy }) => { childCanvasId }
explain_node({ nodeId, contextStrategy }) => { markdown }
summarize_canvas({ canvasId }) => { markdown }
optimize_layout({ graphId, constraints }) => { delta }
find_related_history({ nodeIds, limit }) => { messages[] }
attach_resource_to_node({ nodeId, filePath, kind }) => { ok }
```
- 提示词策略：
  - 输入：节点/画布摘要、相关消息片段、图结构简表（节点上限与分支深度）、用户最新意图与操作日志。
  - 产出：解释 Markdown + 图操作计划（结构化 JSON）；计划转 GraphDelta。
- 上下文管理：
  - 节点级嵌入与摘要；框选触发组合解释与折叠建议；检索最相关 5–8 条消息。
  - 控制复杂度：每画布节点上限（如 30–50）、分支深度（3–4），超限自动提示折叠为子画布。
- 视觉输入：图片识别为概念/关系候选；置信度阈值与用户确认机制。

## 10. API 设计（IPC/HTTP）
- 主要端点：
```http
POST /agent/execute               # 执行工具调用，返回解释与 GraphDelta
POST /graph/create                # 创建图
POST /graph/{id}/nodes            # 新增节点
POST /graph/{id}/edges            # 新增边
POST /node/{id}/expand            # 节点展开为子画布
GET  /node/{id}/explain           # 获取节点解释（可触发 LLM）
POST /canvas/{id}/summarize       # 画布摘要
POST /graph/{id}/optimize_layout  # 布局优化
POST /context/retrieve            # 基于节点/框选检索相关历史
```
- 负载示例（`/agent/execute`）：
```json
{
  "tools": [
    {"name": "explain_node", "args": {"nodeId": "n1", "contextStrategy": "neighbors+history"}},
    {"name": "expand_node_to_canvas", "args": {"nodeId": "n1", "strategy": "auto"}}
  ],
  "sessionId": "s-001",
  "canvasId": "c-001"
}
```
- 返回：
```json
{
  "explanations": [{"nodeId": "n1", "markdown": "..."}],
  "graphDelta": [{"op": "add_node", "graphId": "g1", "node": {"id": "n2", "labelMarkdown": "..."}}]
}
```

## 11. 关键算法与策略
- 布局选择：
  - 思维导图：`compactBox/tree`（左右或径向）。
  - 流程图：`dagre` 有向分层，保证箭头有序与交叉最小化。
  - 概念关系：`force` 初排 + 人工微调，密度过高时分组为 Combo。
- 复杂度控制：
  - 节点上限与分支深度阈值；自动折叠与迁移到子画布；保留“摘要节点”。
- 选区解释与整理：
  - 框选区域 → 统计主题与边密度 → 建议分组/折叠 → 生成摘要节点与链接。
- 上下文召回：
  - 多路检索（节点嵌入、邻接关系、最近交互权重），排名融合；提示词列出“结构摘要”与“限制条款”。
- 冲突解决：
  - 人类操作优先；若 AI 改动与人类冲突，进行 Delta 局部回退并提示复审。

## 12. 性能设计
- 渲染：G6 WebGL + 局部重绘；虚拟化节点标签；高频交互节流。
- 布局：异步与分块；背景线程计算；大图增量布局。
- 数据：SQLite 事务与批量写；快照与自动保存；崩溃恢复。

## 13. 安全与隐私
- 密钥不入库；本地加密存储会话与资源；可选离线模型。
- 内容安全：Markdown/HTML 消毒；文件沙箱与路径白名单。
- 权限：资源访问按会话与画布隔离；外部调用域名列表可配置。

## 14. 日志与可观测性
- 分类：UI 交互日志、Agent 工具调用日志、GraphDelta 操作日志、错误与性能指标。
- 指标：渲染帧率、布局耗时、Delta 应用耗时、LLM 响应延迟、召回准确率。
- 导出：故障报告与最小复现场景（匿名化）。

## 15. 测试策略
- 单元测试：工具层、GraphDelta 应用、数据模型与序列化。
- 集成测试：画布操作与 AI 同步、撤销/重做与快照恢复。
- 端到端：核心交互脚本（双击解释、右键面板、框选折叠）。
- 性能基准：大图场景（1k–3k 节点）渲染与布局指标。

## 16. 构建与发布
- Windows 打包：Tauri bundler；自动更新可选。
- 配置：LLM 供应商与密钥、向量检索开关、渲染性能参数（阈值与节流）。
- 文件结构草案：
```
all-in-graph/
  docs/
    all-in-graph-设计文档.md
  src/
    ui/            # React 组件与主题
    graph/         # G6 封装与模型
    agent/         # 工具调用与上下文打包
    state/         # Yjs 文档与事件总线
    data/          # SQLite 访问层
    platform/      # Tauri 插件与桥接
```

## 17. 路线图与里程碑
- M1 原型闭环（4–6 周）：Tauri + React + G6；右侧聊天、左侧导航树、主画布；节点/边基础操作与右键解释；双击展开子画布；LaTeX/Markdown；AI 工具调用驱动图更新。
- M2 语义记忆与检索（3–4 周）：节点级摘要与向量；框选召回；长对话分段；布局优化建议。
- M3 性能与稳定性（4 周）：GPU 优化、CRDT 同步、崩溃恢复与快照；资源管理与批量导入。
- M4 MCP 适配器（可选，3 周）：在现有工具签名上提供 MCP Host/Client 适配，灰度切换。

## 18. 风格与设计令牌（附录）
- 颜色：`--bg: #f5f5f5; --fg: #111; --accent: #e33; --muted: #999`。
- 线条：`1.5px` 为基线，箭头统一样式；节点圆角 `8px`；像素块点缀 `6px` 方块；波形角标可用于重点节点。
- 动效：进入/展开/折叠过渡 150–200ms，缓动统一（如 `ease-in-out`）。
- 字体：等宽或几何无衬线；数学公式由 KaTeX 渲染。

---
本设计文档用于指导 v0.1–v0.3 的架构实现与迭代，随着落地过程将补充详细 API 规格、协议与错误码表以及更完整的测试用例集。
