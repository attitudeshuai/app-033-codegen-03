# 信鸽竞翔分速与成绩计算 · Pigeon Race Calculator

> 类型：前端 Web 应用（纯前端）｜难度：★★★｜技术栈：**Vue 3 + TypeScript + Vite**（`<script setup>` 单文件组件；球面距离与成绩计算；禁用 UI 组件库与地图库，见 README §5.1）

## 1. 一句话简介
信鸽比赛计成绩：放飞点到各鸽舍的**球面空距**、飞行时间、分速（米/分），自动排名次、出成绩单，成绩改动全程留痕。

## 2. 真实场景与痛点
- 信鸽比赛的名次差常常只有几米/分的分速差，**空距算错 1 公里就会改写名次**，而空距是球面距离，用平面坐标算长距离会差好几公里。
- 报到记录来自电子踏板或电话报到，格式乱、时间要算到秒，手工录成绩表要两三个人核半天。
- **并列名次**处理不统一：分速相同时有的写同名次、有的随便排，事后纠纷多。
- 成绩一旦公布，改放飞时间或坐标就必须重算，但**旧成绩要能查**（谁改的、什么时候改的、改前的名次是什么），否则无法向会员交代。
- 成绩单要打印张贴、还要报上级协会，格式不能乱。

## 3. 目标用户
- 信鸽协会/俱乐部的司放与成绩裁判。
- 鸽友（自己核成绩、算分速）。
- 市县信鸽协会（汇总上报）。

## 4. 核心功能（MVP）
1. **赛事设置**：赛事名称、司放点（坐标，支持度分秒/十进制度输入）、放飞时间（到秒）、司放裁判、参赛羽数、名次取奖数、成绩规则（是否按分速排名、并列规则）。
2. **鸽舍与会员**：会员号、姓名/鸽舍名、坐标（**坐标录入必须支持度分秒 ↔ 十进制度互转**）、联系方式。
3. **参赛与报到**：足环号、鸽舍、性别/羽色（可选）；报到记录（报到方式：电子踏板/电话/鸽钟，报到时间到秒）；**支持批量导入报到数据（dry_run 预览）**。
4. **成绩计算（核心）**：
   - 空距（球面距离，默认 Vincenty，可选 Haversine 对照）；
   - 飞行时间（报到时间 − 放飞时间，秒精度）；
   - 分速（米/分，保留 4 位小数）；
   - 排名（分速降序；**并列处理规则显式可选**：同名次跳号 / 顺序编号）；
   - 名次取奖与奖励标记。
5. **成绩单与导出**：成绩表（名次、会员、鸽舍、足环号、空距、飞行时间、分速）、取奖名单、打印版（A4 张贴用）+ CSV/Excel 上报。
6. **重算与留痕**：修改放飞时间/坐标/报到时间后**必须重算**并生成新版本成绩快照，旧版本可查看；每次改动记录操作人、时间、改动内容、改动前后的名次变化。

## 5. 进阶功能
- 多关赛（同一批鸽多场分速累加/平均，按规则加权）。
- 团体赛（同一会员多羽取前 N 羽成绩合计）。
- 空距对照（Vincenty vs Haversine 差异高亮，超过 0.05% 时提示核查坐标）。
- 报到异常检测（报到时间早于放飞时间、分速异常高如 > 2000 m/min → 标为待核实，**不直接判成绩有效**）。

## 6. 页面结构
```
/                 赛事列表
/race/:id         赛事设置（司放点/放飞时间/规则）
/lofts            会员与鸽舍坐标
/entries/:id      参赛与报到录入/导入
/results/:id      成绩计算与排名（含并列标记、异常标记）
/versions/:id     成绩版本历史（含改动对比）
/export/:id       成绩单打印与上报导出
```

## 7. 数据模型
```ts
type Geo = { lat: number; lon: number };                    // 十进制度，南纬/西经为负
type DistanceMethod = 'vincenty'|'haversine';
type Race = {
  id: string; name: string; releasePoint: Geo; releaseAtUtc: string;
  judge: string; expectedBirds: number; prizeRanks: number;
  distanceMethod: DistanceMethod;
  tieRule: 'same_rank_skip'| 'sequential';
  abnormalSpeedMm: number;                                  // 异常分速上限，默认 2000
};
type Loft = { id: string; memberNo: string; name: string; geo: Geo; phone?: string };
type Entry = { id: string; raceId: string; loftId: string; ringNo: string;
               reportAtUtc?: string; reportChannel: 'epad'|'phone'|'clock'|'manual';
               note?: string };
type ResultRow = {
  rank?: number; entryId: string; loftId: string; ringNo: string;
  distanceM: number; flightSeconds: number; speedMPerMin: number;
  isTie: boolean; flagged?: 'speed_too_high'|'before_release'|'missing_report';
};
type ResultVersion = { id: string; raceId: string; version: number; method: DistanceMethod;
                       releaseAtUtc: string; rows: ResultRow[]; computedAt: number;
                       changes: { field: string; from: unknown; to: unknown; diffRanks: number }[];
                       by: string };
```

## 8. 关键实现点
- **距离必须用球面公式（本项目的命门）**：
  ```
  Vincenty（椭球，默认）或 Haversine（球面近似）：
  R = 6371.0088 km（Haversine 用平均半径）
  空距精确到米，保留整数；误差目标 < 0.1%（用例与权威工具对照）
  ```
  **绝不能用平面欧氏距离**（几十公里跨度下会差出数百米到数公里，直接改写名次）；坐标录入必须做**度分秒换算**（`31°12'36" = 31 + 12/60 + 36/3600`）并有往返用例（转换后 ±0.1" 内一致）。
- **时间处理**：所有时间统一存 UTC（`reportAtUtc`/`releaseAtUtc`），展示按 `Asia/Shanghai`；飞行时间 = 报到 − 放飞（秒），**跨天与夏令/时区问题必须由 UTC 存储规避**（用例：跨零点报到）。
- **分速与排名**：
  ```
  分速 = distanceM / (flightSeconds / 60)，保留 4 位小数
  排名：按分速降序；
  tieRule = 'same_rank_skip' → 相同分速同名次，下一名次跳号（1,2,2,4）
  tieRule = 'sequential'      → 名次连续（1,2,3,4，遇并列按入舍顺序）
  并列判定用「保留 4 位小数后相等」，并在界面说明该口径
  ```
- **异常不从宽**：报到时间早于放飞时间 → `before_release` 标记且不参与排名；分速 > `abnormalSpeedMm` → `flagged = speed_too_high`，**只标记不自动通过**（裁判必须人工确认后才计入名次，确认动作留痕）。
- **版本与重算**：任何影响成绩的字段变更（放飞时间、坐标、报到时间）都触发重算并生成新 `ResultVersion`；`changes` 必须记录**名次位次变化幅度**（`diffRanks`），旧版本**不可删除**。
- **导入**：报到数据支持 CSV/Excel，两步 `dry_run`（新增/更新/错误）；足环号重复或未报名时明确报错行号，**不静默丢弃**。
- **性能**：5000 羽成绩计算（含球面距离）< 300ms（避免重复计算同一鸽舍距离，按 loftId 缓存）。

## 9. 交互与视觉要点
- 成绩表按名次排序，并列行加「并列」标记，异常行用醒目图标 + 原因文字（不单靠颜色）。
- 赛事设置页实时显示「已录入羽数 / 应参赛羽数」，缺报的鸽子列出未报到清单。
- 版本历史用左右对比（旧名次 → 新名次，箭头显示升降），一键导出「成绩变更说明」用于公示。
- 打印成绩单为 A4 竖排、字号适合张贴（名次与分速加粗）。

## 10. 验收标准
- 距离精度：10 组已知坐标（含跨半球、高纬度）与权威测距工具对比，误差 < 0.1%（Haversine 与 Vincenty 都要测）。
- 坐标换算：度分秒 ↔ 十进制度往返一致（±0.1"）；`31°12'36"` 换算结果正确（断言）。
- 分速与排名：构造 30 组用例（含相同分速、4 位小数边界、异常快、报到早于放飞、缺报到），名次与并列处理 100% 符合规则；两种 tieRule 结果正确。
- 时间：跨零点报到飞行时间计算正确（UTC 存储断言）。
- 重算留痕：修改放飞时间后新版本生成，旧版本可查；`changes.diffRanks` 正确反映名次升降；旧版本不可删除（断言）。
- 异常不从宽：`speed_too_high` 的鸽子未人工确认前不进入名次（断言）。
- 导入：100 行含 5 条错误精确定位；正式导入重传不重复。
- 5000 羽计算 < 300ms；成绩单打印与页面一致。

## 11. 边界（刻意不做）
不做电子踏板/鸽钟的硬件对接与实时采集（只做导入与手工录入）、不做在线直播与赛事社交、不做奖金发放与支付、不做地图轨迹与鸽舍地理分布图——核心只做**空距 + 分速 + 排名 + 成绩单 + 变更留痕**，避开黑名单中的支付、社交、地图方向。

## 12. 容器化与构建（Docker）

- **Dockerfile（多阶段）**：`node:20-alpine` 构建 → `nginx:1.27-alpine` 只拷 `dist/` 与 `nginx.conf`
- **docker-compose.yml**：服务名 `app-033`，端口 **`8113:80`**，`restart: unless-stopped`；`HEALTHCHECK` 请求 `/healthz`
- **nginx.conf**：SPA 回退；哈希资源 `immutable`；`index.html` no-cache；gzip
- 无后端依赖，断网可用（司放现场在野外，常常没信号）；成绩数据存本地 IndexedDB，支持导出备份文件
- 中文字体本地打包（成绩单打印对字体有要求）

```bash
cd frontend/app-033
docker compose up -d --build
curl http://localhost:8113/healthz
docker compose down
```

- **验收**：`http://localhost:8113` 完成「建赛事 → 录会员坐标 → 导入报到 → 算分速排名 → 改放飞时间看版本对比 → 打成绩单」；断网可用；镜像 < 60MB。

### 忽略文件（.dockerignore / .gitignore）

- **`.dockerignore`**：`node_modules`、`dist`、`.git`、`.gitignore`、`.env`、`.env.*`、`*.log`、`coverage`、`.vscode`、`.idea`、`Dockerfile`、`nginx.conf`、`README.md`
  - `node_modules` 必须排除；**保留** `package-lock.json`、示例赛事数据（`public/samples/`，用**虚构会员**）
- **`.gitignore`**：`node_modules/`、`dist/`、`.env*`、`*.log`、`coverage/`、`.DS_Store`、`.vscode/`、`.idea/`，另排**真实会员信息与赛事成绩** `races/`、`members/`、`exports/`、`backups/`、`*.json`（成绩备份含会员姓名与坐标，属个人信息）
- **自检**：构建上下文 < 5MB 且示例数据全部为虚构（断言）；`git status` 不出现真实会员名单与成绩
