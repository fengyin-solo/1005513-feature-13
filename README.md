# 制药企业洁净区与批生产记录管理平台

面向洁净区环境监测、批生产记录编录、物料放行、偏差与变更控制、灭菌与清洁验证、成品检验与年度质量回顾的一体化药品生产质量管理工作台。

这是一个**纯前端**管理平台：Vue 3 + Vite + TypeScript，仓库里没有后端服务。业务数据由
`frontend/src/data/` 下的本地数据层提供：首次打开用示例数据播种，之后的登记、筛选与状态流转
结果都持久化在浏览器 `localStorage` 里，刷新或重开浏览器都还在。dev server 已关掉自动打开页面，
启动后按终端打印的地址手工打开。

## 目录结构

```text
.
├── frontend/                 Vue 3 + Vite + TypeScript 前端（唯一运行单元）
│   ├── src/views/            每个业务模块一个页面
│   ├── src/api/local-service.ts   本地数据服务：列表、筛选、动作流转、导出
│   ├── src/data/             模块元数据 / 示例数据 / localStorage 持久化
│   ├── src/stores/           会话与筛选状态
│   └── vite.config.ts        dev server 配置（open: false，无 /api 代理）
├── .gitignore
└── docker-compose.yml
```

## 启动

```bash
cd frontend
npm install
npm run dev
```

前端默认监听 `http://127.0.0.1:5173/`，dev server 不会自动打开浏览器，需要自己访问。

生产构建：

```bash
cd frontend
npm run build
```

## 业务模块

| 模块 | 目录 | 业务对象 | 主要字段 |
| --- | --- | --- | --- |
| 批生产记录 | `batchrecord` | 批生产记录 | 批号、产品名称、生产工序 |
| 洁净区环境监测 | `cleanroom` | 环境监测记录 | 监测点位、洁净级别、悬浮粒子数 |
| 物料放行 | `materialrelease` | 物料放行单 | 物料批号、物料名称、供应商 |
| 偏差处理 | `deviation` | 偏差记录 | 偏差编号、偏差类型、发生工序 |
| 变更控制 | `changecontrol` | 变更申请 | 变更编号、变更类别、涉及工序 |
| 清洁验证 | `cleanvalidate` | 清洁验证记录 | 验证编号、设备名称、清洁规程 |
| 灭菌验证 | `sterilize` | 灭菌验证记录 | 验证编号、灭菌设备、灭菌程序 |
| 培养基模拟灌装 | `mediafill` | 模拟灌装记录 | 灌装编号、灌装规格、灌装批量 |
| 工艺用水监测 | `watermonitor` | 水质监测记录 | 取样点、水系统类别、电导率 |
| 更衣确认 | `gowning` | 更衣确认记录 | 确认编号、洁净级别、更衣步骤 |
| 成品检验 | `finishedqc` | 成品检验报告（按产品分册） | 检验编号、产品批号、检验项目、标准规定、检验结果、复检结果、签字 |
| 留样管理 | `retainsample` | 留样记录（接收检验回写待办） | 留样编号、对应批号、留样数量 |
| 稳定性考察 | `stability` | 稳定性考察记录 | 考察编号、考察批号、考察条件 |
| 产品召回 | `recall` | 召回记录 | 召回编号、涉及批号、召回级别 |
| 供应商审计 | `supplieraudit` | 供应商审计记录 | 审计编号、供应商名称、物料类别 |
| 人员培训 | `training` | 培训记录 | 培训编号、培训主题、受训岗位 |
| 年度质量回顾 | `annualreview` | 年度回顾报告 | 回顾编号、回顾年度、涉及产品 |
| 质量投诉 | `complaint` | 投诉记录 | 投诉编号、投诉来源、涉及产品 |

## 成品检验：按产品分册外发

成品检验是多检验项目结构，独立于通用 `EntryRow`，数据在 `src/data/qc-store.ts`（localStorage
键 `pharma-cleanroom:qc:v1`），业务规则集中在 `src/api/qc-service.ts`：

- **按产品拆包**：已签发报告按「产品 × 出报告日」生成 CSV 分册，每册只放检验编号、检验项目、
  标准规定、检验结果，复检结果另开一栏并带检验人签字；分册名形如
  `检验报告分册_葡萄糖注射液_出报告2026-10-02.csv`。点「按产品拆包导出」选周期（`YYYY-MM`）
  后打包为一个 ZIP 下载，可直接外发注册和车间。
- **无报告不发空包**：周期内没有已签发报告的目录产品，自动附《无报告情况说明》TXT。
- **重复打包只算一次**：打包台账按检验编号去重，同一份报告再打不计入新数，但分册仍照常随包。
- **状态逐级推进**：待检验 → 检验中 → 待判定 → 待签字 → 已签发；不合格可
  待签字 → 复检中 →（再判定）→ 待签字。跳级/逆向一律由服务端挡回；判定被挡回可
  「退回补录结果」后重新送判定。
- **检验人签字**：待签字报告必须录入检验人姓名才签发，未签发报告不能拆包外发。
- **判定口径先按业务定**：页面顶部「判定口径（业务先行）」可选「标准规定说了算」
  （结果逐项比对限度/区间/定性）或「检验结果说了算」（结果须写明“符合/不符合规定”，
  否则挡回）。判定过程逐项留痕。
- **检验项目同一套**：`src/data/catalog.ts` 是产品与检验项目（含别名）主数据；
  pH值/PH值/酸碱度/pH、水分/水份/干燥失重等各处写法都归一到标准项；目录外名称按非法值
  整份打回重填。
- **结果回写留样待办**：判定（含复检再判定）后自动在留样管理页生成待办，按检验编号幂等；
  在留样管理页「登记留样并关闭待办」即生成留样记录。

## 约定

- 每个模块的页面在 `frontend/src/views/<模块>/index.vue`，页面只负责渲染，读写统一走
  `frontend/src/api/local-service.ts`（成品检验走 `src/api/qc-service.ts`）。
- 字段、状态、动作与流转目标集中在 `frontend/src/data/modules.ts`；示例数据在
  `frontend/src/data/seed.ts`，成品检验示例在 `frontend/src/data/seed-qc.ts`。
- 状态流转只允许在服务层里改，页面组件不做业务裁决（按钮按服务端状态机显示，服务端兜底）。
- 想回到初始数据：清掉浏览器里 `pharma-cleanroom:entries:v2` 与 `pharma-cleanroom:qc:v1`。

## 冒烟测试

核心规则（归一/非法值、逐级推进、判定口径、复检、留样回写、拆包去重、ZIP 结构）有一份
零框架冒烟脚本：

```bash
cd frontend
node -e "require('esbuild').build({entryPoints:['tests/smoke.ts'],bundle:true,platform:'node',format:'esm',outfile:'tests/smoke.mjs'})"
node tests/smoke.mjs
```
