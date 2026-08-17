# 账户积分与对局持久化设计

## 目标

将现有账号、对局结果和撞机奖励从本地 JSON/进程内存迁移到 Supabase PostgreSQL，同时保持联机操作的低延迟。

本次改造在产品层面停用局内道具体系，但保留现有道具实现代码，方便以后恢复。撞机产生的积分不再进入单局资源池，也不再用于购买道具，而是直接累计到已登录玩家的永久账户积分。

## 已确认的产品规则

- 部署面向中国大陆玩家：Node/WebSocket 服务和 Supabase 项目均放在新加坡区域。
- 保留现有自建用户名、邮箱和密码登录，不迁移到 Supabase Auth。
- 通过统一功能开关停用道具模式、四种道具、局内积分条、100 分上限和积分消费；相关实现代码保留。
- 普通模式撞掉敌方飞机时获得账户积分。
- 欢乐模式碰撞敌方飞机时获得账户积分，同时保留原有奖励前进规则。
- 普通撞机沿用现有公式：`(15 + 对手损失完成度 × 0.85) × 棋子数倍率`。
- 棋子数倍率沿用现有值：2 子为 1.35、3 子为 1.15、4 子为 1.0；1 子按 1.0 处理。
- 欢乐模式碰撞积分沿用现有值：`20 × 本次碰撞的敌方棋子数`。
- 账户积分使用精确两位小数，不设置余额上限。
- AI 没有账户，不获得永久账户积分。

## 不采用的方案

### 只在用户表增加积分和统计列

实现最少，但无法追溯积分来源，也难以防止重连或重复消息造成重复发奖。

### 保存完整棋盘事件流

可以完整回放和审计，但需要保存每次掷骰、动画和棋子移动，超出朋友间轻量游戏的需求。

### 采用余额快照加不可变流水（采用）

账户余额用于快速读取，积分流水用于审计和幂等。对局只保存结果、玩家统计以及撞机等关键事件。

## 总体架构

```text
浏览器
  ↕ WebSocket
新加坡 Node 游戏服务
  ├─ 内存：实时房间、棋盘和回合状态
  ├─ 立即广播：掷骰、移动、撞机和积分提示
  └─ 后台写入：Supabase PostgreSQL（新加坡）
```

数据库不参与每次掷骰和普通移动。只有账号操作、对局创建/结束、撞机奖励和账户查询访问数据库。

Node 服务使用长期 PostgreSQL 连接池。优先使用 Supabase 直连；运行环境仅支持 IPv4 时使用 Supavisor Session 模式。

## 数据库边界

业务表放在不向 Supabase Data API 暴露的 `app` schema 中。浏览器不能直接写账户积分；所有写入只能通过 Node 后端的数据库角色完成。

时间统一存储为 UTC `timestamptz`。主键使用 UUID。积分字段使用 `numeric(12,2)`。

## 表结构

### `app.users`

| 字段 | 类型 | 约束/说明 |
|---|---|---|
| `id` | `uuid` | 主键 |
| `username` | `citext` | 非空、唯一 |
| `email` | `citext` | 非空、唯一 |
| `display_name` | `varchar(16)` | 非空 |
| `password_salt` | `text` | 非空 |
| `password_hash` | `text` | 非空 |
| `created_at` | `timestamptz` | 非空、默认当前时间 |
| `updated_at` | `timestamptz` | 非空、默认当前时间 |

现有 `backend/data/users.json` 数据按 UUID、用户名、邮箱、显示名和密码哈希原样迁移。第一阶段登录 session 继续保存在 Node 内存中，避免扩大改造范围；服务重启会要求重新登录，但用户、积分和对局不会丢失。

### `app.user_wallets`

| 字段 | 类型 | 约束/说明 |
|---|---|---|
| `user_id` | `uuid` | 主键、外键指向 `app.users` |
| `points_balance` | `numeric(12,2)` | 非空、默认 0、不得小于 0 |
| `version` | `bigint` | 非空、默认 0，用于并发更新 |
| `updated_at` | `timestamptz` | 非空 |

每个用户注册时同时创建钱包。余额是流水的快速汇总，不作为唯一审计来源。

### `app.user_stats`

| 字段 | 类型 | 约束/说明 |
|---|---|---|
| `user_id` | `uuid` | 主键、外键指向 `app.users` |
| `games_played` | `bigint` | 默认 0 |
| `games_won` | `bigint` | 默认 0 |
| `planes_defeated` | `bigint` | 默认 0 |
| `happy_collisions` | `bigint` | 默认 0 |
| `lifetime_points_earned` | `numeric(14,2)` | 默认 0 |
| `updated_at` | `timestamptz` | 非空 |

该表仅用于快速显示个人资料。真实来源仍是对局玩家记录和积分流水。

### `app.matches`

| 字段 | 类型 | 约束/说明 |
|---|---|---|
| `id` | `uuid` | 主键 |
| `room_code` | `varchar(4)` | 可空，记录当时房间号 |
| `status` | `text` | `playing`、`finished`、`abandoned` |
| `end_reason` | `text` | 正常结束、强制结算、房间销毁等 |
| `happy_mode` | `boolean` | 非空、默认 false |
| `team_mode` | `boolean` | 非空、默认 false |
| `piece_count` | `smallint` | 1–4 |
| `launch_number` | `text` | `even`、`2`、`4`、`6` |
| `started_at` | `timestamptz` | 非空 |
| `ended_at` | `timestamptz` | 可空 |
| `duration_ms` | `bigint` | 可空、不得小于 0 |
| `winner_user_id` | `uuid` | 可空、外键指向 `app.users` |
| `winner_team_no` | `smallint` | 可空 |
| `created_at` | `timestamptz` | 非空 |

新对局不再保存有效的 `skill_mode`；兼容字段可以暂时保留并始终写为 `false`。

### `app.match_players`

| 字段 | 类型 | 约束/说明 |
|---|---|---|
| `id` | `uuid` | 主键 |
| `match_id` | `uuid` | 外键指向 `app.matches` |
| `user_id` | `uuid` | 真人非空，AI 为空 |
| `seat` | `smallint` | 1–4 |
| `team_no` | `smallint` | 可空 |
| `is_ai` | `boolean` | 非空 |
| `display_name_snapshot` | `varchar(32)` | 保存对局时昵称 |
| `placement` | `smallint` | 可空 |
| `planes_defeated` | `integer` | 默认 0 |
| `happy_collisions` | `integer` | 默认 0 |
| `account_points_earned` | `numeric(12,2)` | 默认 0 |
| `movement_distance` | `integer` | 默认 0 |
| `bounce_distance` | `integer` | 默认 0 |
| `dice_statistics` | `jsonb` | 默认空对象 |
| `titles` | `jsonb` | 默认空数组；仅保留非道具称号 |
| `finished_at` | `timestamptz` | 可空 |

唯一约束：`(match_id, seat)`；真人另设 `(match_id, user_id)` 的条件唯一索引。

### `app.match_events`

只保存需要审计或驱动账户积分的关键事件。

| 字段 | 类型 | 约束/说明 |
|---|---|---|
| `id` | `uuid` | 主键 |
| `match_id` | `uuid` | 外键指向 `app.matches` |
| `sequence_no` | `integer` | 对局内递增序号 |
| `event_type` | `text` | `plane_defeated`、`happy_collision`、`game_finished` |
| `actor_user_id` | `uuid` | 可空，AI 时为空 |
| `target_user_id` | `uuid` | 可空 |
| `target_piece_index` | `smallint` | 可空 |
| `reward_points` | `numeric(12,2)` | 默认 0 |
| `payload` | `jsonb` | 规则计算输入和必要上下文 |
| `created_at` | `timestamptz` | 非空 |

唯一约束：`(match_id, sequence_no)`。

### `app.points_ledger`

| 字段 | 类型 | 约束/说明 |
|---|---|---|
| `id` | `uuid` | 主键 |
| `user_id` | `uuid` | 外键指向 `app.users` |
| `amount` | `numeric(12,2)` | 本次变化量；当前业务仅产生正数 |
| `reason` | `text` | `plane_defeated`、`happy_collision`、`migration`、`admin_adjustment` |
| `match_id` | `uuid` | 可空、外键指向 `app.matches` |
| `match_event_id` | `uuid` | 可空、外键指向 `app.match_events` |
| `balance_after` | `numeric(12,2)` | 非空 |
| `idempotency_key` | `text` | 非空、唯一 |
| `metadata` | `jsonb` | 默认空对象 |
| `created_at` | `timestamptz` | 非空 |

撞机奖励的幂等键格式为 `match:{matchId}:event:{sequence}:user:{userId}`。相同事件重复上报时，唯一约束保证账户只加一次。

## 奖励事务

后端 `pointsService` 根据撞机事实计算奖励，并通过同一个 PostgreSQL transaction 完成事件、余额、流水和统计写入。浏览器不能传入最终奖励值。

事务顺序：

1. 插入 `match_events`；若 `(match_id, sequence_no)` 已存在，返回已处理结果。
2. 后端按确认的公式计算并四舍五入到两位小数。
3. 原子更新 `user_wallets.points_balance` 和 `version`。
4. 插入 `points_ledger`，记录 `balance_after`。
5. 增加 `match_players.account_points_earned`、撞机/碰撞次数。
6. 增加 `user_stats` 的长期汇总。
7. 提交事务并返回奖励值及新余额。

浏览器不能自行指定奖励值或最终账户余额，也不能直接访问这些业务表。

## 实时数据流与延迟

1. 游戏服务在内存中确认撞机或欢乐碰撞。
2. 游戏服务立即广播棋盘结果和积分提示，不等待数据库。
3. 后台任务调用奖励事务。
4. 成功后向对应玩家发送 `accountPointsUpdated`，校准显示余额。
5. 失败时按指数退避重试，并在对局结算前再次刷新未完成事件。

数据库暂时不可用不能阻塞走棋。未入库奖励在界面上显示为“同步中”，成功后变为已到账。进程在数据库恢复前异常退出可能丢失尚未提交的内存任务；引入外部持久化队列不在本次朋友间轻量部署范围内。

## API 与 WebSocket 变更

### HTTP

- 现有注册、登录、资料和改密接口改为读取 `app.users`。
- 新增 `GET /api/account/summary`：返回用户资料、积分余额和汇总统计。
- 新增 `GET /api/account/matches`：游标分页返回个人对局记录。
- 新增 `GET /api/account/points`：游标分页返回积分流水。

### WebSocket

- 新增 `accountPointsUpdated`：包含本次奖励、最新余额、对局和事件标识。
- `energyChange`、`energyGainAnimation`、`teleportIcon`、`polyhedralDice`、`mysteryBoxIcon` 等道具/局内积分消息处理代码保留，但在功能开关关闭时不发送、不执行。
- 撞机客户端只上报事实数据；最终账户积分由服务器按公式计算。

## 前端改造

- 新增统一的 `ITEMS_ENABLED = false` 功能开关，并在入口处注释停用原因和恢复方式。
- 大厅三个配置区中的道具模式开关保留在源码中，但当前不渲染或保持隐藏。
- 道具规则说明、游戏页道具按钮、道具面板、局内积分条和积分调试控件保留在源码中，但当前不渲染或保持隐藏。
- 盲盒、传送门、多面骰子、遥控骰子及相关动画和 AI 决策代码保留；初始化、事件绑定和消息发送由功能开关短路。
- 不采用把上千行实现整段注释掉的方式；只在功能入口和兼容分支写清晰注释，避免代码腐化和语法检查失效。
- 撞机或欢乐碰撞后显示“账户积分 +X”，到账后更新账户余额。
- 结算页保留积分获得统计，名称改为“本局账户积分”。
- 道具称号配置代码保留，但功能开关关闭时不参与称号计算和展示。
- 账户页增加当前积分、累计获得积分、总对局、胜场和撞机次数。

## 后端模块边界

现有 `backend/server.cjs` 过大。本次只拆分与数据库改造直接相关的模块：

- `backend/db/pool.cjs`：连接池和健康检查。
- `backend/repositories/userRepository.cjs`：用户读写。
- `backend/repositories/matchRepository.cjs`：对局与玩家结果。
- `backend/services/pointsService.cjs`：公式、幂等和积分事务。
- `backend/migrations/`：可重复执行的 SQL migration。

WebSocket 房间和棋盘同步逻辑继续留在现有服务中，避免无关重构。

## 迁移与兼容

1. 创建 Supabase 新加坡项目和 `app` schema。
2. 执行数据库 migration。
3. 将现有 JSON 用户导入 `app.users`，并为每个用户创建余额为 0 的钱包和统计行。
4. 部署新后端，确认账号登录、注册和资料修改正常。
5. 开启对局与积分持久化。
6. 停止本地 JSON 写入；关闭道具入口和执行路径，但不删除道具实现代码。

部署失败时回滚到旧版本；数据库新增表不会影响旧版本运行。旧版本不认识的新账户积分不会自动同步回 JSON，因此切换后不再双写。

## 错误处理

- 用户名或邮箱唯一冲突返回明确的 409。
- 数据库不可用时账号写操作失败并提示重试；已建立的对局继续运行。
- 重复奖励返回第一次事务的结果，不重复增加余额。
- AI、未登录用户或不存在的 match player 不写账户奖励。
- 非法积分输入、负完成度损失、超范围棋子数和无效事件类型拒绝处理。
- 账户余额不得出现负数或非有限数值。

## 测试要求

- 积分公式单元测试：不同完成度、棋子数、欢乐碰撞和两位小数。
- 幂等测试：同一奖励事件并发提交多次只增加一次。
- 事务回滚测试：流水插入失败时余额和统计均不改变。
- 用户迁移测试：现有 UUID 和密码哈希登录结果不变。
- 对局集成测试：创建、撞机、结算后各表数据一致。
- WebSocket 延迟测试：人为延迟数据库写入时，移动广播仍立即发生。
- UI 测试：不存在道具入口，撞机提示和账户余额能够更新。
- 重连测试：重复收到撞机/积分消息不会重复发奖。

## 完成标准

- 用户数据、积分、积分流水、对局和玩家结果均持久化到 Supabase。
- 服务重启后用户积分与对局记录不丢失。
- 项目运行时不存在可使用的道具模式和局内积分消费入口，但源码保留完整道具实现及恢复说明。
- 每个撞机奖励最多入账一次。
- 数据库响应变慢或暂时失败时，不阻塞实时走棋和动画。
- 现有在线房间、欢乐模式、2v2、聊天、观战和重连功能继续可用。
