# 信鸽竞翔分速与成绩计算 · Pigeon Race Calculator

纯前端应用：给定放飞点与各鸽舍坐标，计算**球面空距**、飞行时间与分速（米/分），自动排名、出成绩单，成绩改动全程留痕。无后端依赖，断网可用（数据存本地 IndexedDB）。

## 技术栈

- Vue 3 + TypeScript + Vite 6，全部为 `<script setup>` 单文件组件，样式为手写 CSS（`style scoped`）
- 状态用 Vue 自带的 `ref` / `reactive` / `computed` / `watch`
- 路由：`vue-router`（history 模式）—— 本项目唯一的额外运行时依赖
- 测距：Vincenty 椭球逆解（WGS-84，默认）与 Haversine 球面近似，均为手写实现
- 持久化：手写 IndexedDB 封装（无第三方依赖），支持导出/导入备份文件
- 未使用任何 UI 组件库、游戏/物理引擎、图表库、地图库、Pinia/Vuex
- 字体本地打包（`public/fonts/*.woff2`，由系统字体子集化生成），不引用任何外网 CDN

## 目录结构

```
app-033/
├── index.html                 入口 HTML
├── package.json               依赖与脚本
├── vite.config.ts             Vite 配置（@ → ./src 别名）
├── tsconfig.json              TypeScript 配置（strict）
├── Dockerfile                 多阶段构建：node:20-alpine → nginx:1.27-alpine
├── docker-compose.yml         服务 app-033，8113:80，HEALTHCHECK /healthz
├── nginx.conf                 SPA 回退、哈希资源 immutable、index.html no-cache、gzip
├── .dockerignore / .gitignore
├── public/
│   ├── fonts/                 PigeonCN-Regular.woff2 / PigeonCN-Bold.woff2（本地中文子集）
│   └── samples/               虚构示例数据 lofts-sample.csv / reports-sample.csv
└── src/
    ├── main.ts  App.vue  router/index.ts  styles.css  types.ts  env.d.ts
    ├── lib/                   geo.ts（DMS/Vincenty/Haversine）· time.ts（UTC↔上海）·
    │                          csv.ts（解析/导出 BOM）· calc.ts（排名/异常/团体/多关）· util.ts
    ├── db/db.ts               IndexedDB 读写封装
    ├── composables/           store.ts（全局状态/重算/版本快照/备份）·
    │                          useReportImport.ts（dry_run 导入）· useSample.ts（示例载入）
    ├── components/GeoInput.vue  度分秒 ↔ 十进制度实时互转
    └── views/                 7 个页面：赛事列表 / 赛事设置 / 会员鸽舍 / 参赛报到 /
                               成绩计算 / 版本历史 / 成绩单打印导出
```

页面路由与规格书 §6 一致：`/`、`/race/:id`、`/lofts`、`/entries/:id`、`/results/:id`、`/versions/:id`、`/export/:id`。

## 本地启动

```bash
npm install
npm run dev            # 开发服务器，默认 http://localhost:8113
```

其他脚本：

```bash
npm run build          # vue-tsc 类型检查 + vite 生产构建，输出 dist/
npm run preview        # 预览构建产物（端口 8113）
```

## Docker 构建与运行

```bash
docker compose build           # 构建镜像
docker compose up -d           # 启动，映射 8113:80
curl http://localhost:8113/healthz
docker compose down
```

## 验收结果

### 算法层自检（Node + esbuild 打包临时脚本运行，验完已删除）

- **距离精度**：10 组已知坐标（含跨半球、68°N 高纬）与 GeographicLib 权威值对比，Vincenty 与 Haversine 各 10 组，误差全部 < 0.1%（阈值内），重合点距离为 0
- **坐标换算**：`31°12'36" = 31.21` 断言通过；空格/冒号/纯十进制/半球字母（S/W）解析通过；6 组数值 `formatDms → parseDms` 往返误差均 ≤ 0.1″
- **分速与排名**：30 组用例（含相同分速并列、1200.0000 / 1200.0001 的 4 位小数边界、异常快、报到早于放飞、缺报到）× 两种 `tieRule`，名次、并列标记、取奖标记与独立 oracle 100% 一致（`same_rank_skip` → 1,2,2,4；`sequential` → 连续编号）
- **时间**：跨零点报到飞行时间正确（UTC 存储）
- **留痕**：`changes.diffRanks` 逐条核对正确；旧版本无删除入口
- **异常不从宽**：`speed_too_high` 未人工确认前 `rank === null`；`before_release`、`missing_report` 同样不排名
- **导入**：100 行含 5 条错误，逐行精确定位（行号 + 原因）；重传只更新不重复
- **性能**：5000 羽计算 < 300ms（按 loftId 缓存空距）
- **团体赛 / 多关赛 / 空距对照**：均通过

### 构建

`npm run build` 通过：`vue-tsc --noEmit` 无类型错误，Vite 生产构建成功（无构建警告）。

### 浏览器实测（规格书 §10）

已按「建赛事 → 录会员坐标 → 导入报到 → 算分速排名 → 改放飞时间看版本对比 → 打成绩单」完整走通，控制台无报错、无警告：

| 验收项 | 结果 | 关键证据 |
| --- | --- | --- |
| 距离精度 | 通过 | 成绩表空距与坐标一致，误差在 0.1% 阈值内；空距算法（Vincenty / Haversine）可切换 |
| 坐标换算往返 | 通过 | GeoInput 十进制度 ↔ 度分秒双向实时互转，往返 ±0.1″ |
| 分速与排名 | 通过 | 并列对 CHN26-001010 / 001011 同为第 26 名（跳号）；切换 tieRule 后连续编号 |
| 异常不从宽 | 通过 | CHN26-001020 分速 2144.1259 标「待核实」，未排名；裁判确认后升至第 1 名，其余 33 羽顺延 |
| 早于放飞 | 通过 | CHN26-001025 标「报到早于放飞」，飞行时间显示「—」，不排名 |
| 缺报 | 通过 | CHN26-001036 未报到，列入未报到清单 |
| 重算留痕 | 通过 | 改放飞时间（提前 10 分钟）生成第 3 版，`diffRanks` ↓21，旧版本可查、不可删除 |
| 版本对比与导出 | 通过 | 左右对比箭头显示升降；导出「成绩变更说明」CSV |
| 打印成绩单 | 通过 | A4 竖排（210mm）预览，名次与分速加粗；`@page A4 portrait`、打印时隐藏导航与 `.no-print`；预览内容与成绩页数据一致（同一份 `ResultRow`） |
| 导入 dry_run | 通过 | 100 行含 5 条错误精确定位行号（第 2 / 26 / 51 / 76 / 100 行，分别提示未报名、文件内重复、时间格式、缺少时间、未报名），错误存在时「确认正式导入」自动禁用；修正后 100 条全部导入；再次导入同一文件显示「新增 0、更新 100」，库中仍为 100 条（重传不重复） |
| 断网可用 | 通过 | 无外网请求，字体/示例数据本地打包 |
| Docker 构建 | 通过 | `docker compose build` 成功（exit 0，`Image app-033:latest Built`）；镜像压缩体积 22.05MB（< 60MB），未压缩落盘 78.1MB —— 其中 `nginx:1.27-alpine` 基础镜像自身未压缩即 74.5MB，本项目内容仅约 2.3MB |

### 验收中发现并修复的缺陷

1. **备份恢复 / 批量导入 / 手工报到保存写库失败**：`idbPut` / `idbBulkPut` 直接写入 Vue 响应式对象，IndexedDB 结构化克隆报
   `could not be cloned`，导致「恢复备份」提示失败、导入与手工报到不落库。已在 [db.ts](file:///d:/charlesshuai/LearningSpace/projects/AI/md项目/fe%20source/app-033/app-033/src/db/db.ts) 写入前统一深拷贝为普通对象修复；实测三项均已正常落库并在刷新后保持。
2. **备份恢复残留旧数据**：恢复后旧记录仍留在 IndexedDB，刷新会重新出现。已改为恢复前先清空业务数据（`idbClearAll`，保留 meta）。
3. **`ExportView` 的 `<tr>` 直挂 `<table>`**：触发 Vite 警告，已补 `<tbody>`，构建与运行均无警告。
4. **早于放飞的飞行时间显示 `-1:-20:00`**：负飞行时间改为显示「—」。

### 未在浏览器中自动化的部分（说明）

- **5000 羽 < 300ms**：在 Node 自检脚本中对 `calcResults` 实测通过（按 loftId 缓存空距）；浏览器侧未再单独造 5000 羽数据。
- **原生打印对话框**：未通过自动化触发 `window.print()`（会弹出系统模态框阻塞自动化），改以 A4 预览 + 打印样式表核对。