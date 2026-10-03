import { isKnownProduct, PRODUCTS, resolveItemName } from '@/data/catalog'
import { evaluateReport, type JudgeMode, type ReportEvaluation } from '@/data/judge'
import { getState, updateState } from '@/data/qc-store'
import type {
  ActionResult,
  EntryRow,
  PackLedgerEntry,
  QcAction,
  QcItem,
  QcReport,
  QcStatus,
  RetainTodo,
} from '@/data/types'
import { listRows, saveRows } from '@/data/local-store'
import { buildZip, type ZipEntry } from '@/utils/zip'

/**
 * 状态机：状态只能一步步往前推，表上每个动作只允许从指定状态出发，
 * 跳级（如待检验直接送判定）、回头路都在这里挡回，页面按钮只是入口，裁决以此为准。
 */
export const QC_STATUS_ORDER: QcStatus[] = ['待检验', '检验中', '待判定', '待签字', '复检中', '已签发']

// 「录入结果」只保存不推进状态（检验中/复检中可反复保存），不进流转表
const ENTRY_ACTION_FROM: QcStatus[] = ['检验中', '复检中']

type FlowAction = Exclude<QcAction, '录入结果'>

export const QC_ACTION_FLOW: Record<FlowAction, { from: QcStatus[]; to: QcStatus; label: string }> = {
  开始检验: { from: ['待检验'], to: '检验中', label: '开始检验' },
  录入完成送判定: { from: ['检验中'], to: '待判定', label: '录入完成送判定' },
  // 判定被挡回时退回检验中补录，仍按流程一步一步走回来，不是跳级
  退回补录结果: { from: ['待判定'], to: '检验中', label: '退回补录结果' },
  执行判定: { from: ['待判定'], to: '待签字', label: '执行判定' },
  判定不合格转复检: { from: ['待签字'], to: '复检中', label: '判定不合格转复检' },
  复检完成再判定: { from: ['复检中'], to: '待签字', label: '复检完成再判定' },
  检验人签字: { from: ['待签字'], to: '已签发', label: '检验人签字' },
}

export function nextActions(status: QcStatus): QcAction[] {
  const actions = (Object.keys(QC_ACTION_FLOW) as FlowAction[]).filter((action) =>
    QC_ACTION_FLOW[action].from.includes(status),
  )
  return ENTRY_ACTION_FROM.includes(status) ? ['录入结果', ...actions] : actions
}

function nowText(): string {
  return new Date().toLocaleString('zh-CN', { hour12: false }).replace(/\//g, '-')
}

function nextReportId(reports: QcReport[]): number {
  return reports.reduce((max, row) => Math.max(max, row.id), 0) + 1
}

function nextTodoId(todos: RetainTodo[]): number {
  return todos.reduce((max, row) => Math.max(max, row.id), 0) + 1
}

// ---------- 查询 ----------

export function listReports(filters: { product?: string; status?: string; keyword?: string } = {}): QcReport[] {
  const rows = getState().reports
  return rows
    .filter((row) => (!filters.product || row.product === filters.product))
    .filter((row) => (!filters.status || row.status === filters.status))
    .filter(
      (row) =>
        !filters.keyword ||
        [row.reportNo, row.product, row.batchNo, row.items.map((i) => i.item).join(' ')]
          .join(' ')
          .includes(filters.keyword.trim()),
    )
    .sort((a, b) => (a.reportNo < b.reportNo ? 1 : -1))
}

export function getReport(id: number): QcReport | undefined {
  return getState().reports.find((row) => row.id === id)
}

// ---------- 登记 / 编辑：检验项目多处取到的属于同一套，非法值打回重填 ----------

export type ReportDraft = {
  reportNo: string
  product: string
  batchNo: string
  reportDate: string
  items: { item: string; standard: string; result: string }[]
}

/**
 * 归一检验项目并校验：任意一项填成目录外的非法值，整份打回重填；
 * 同一项多处取到（重复填写）归并成一条，属于同一套。
 */
export function normalizeDraftItems(
  rawItems: { item: string; standard: string; result: string }[],
): { items: QcItem[]; normalized: { from: string; to: string }[]; errors: string[] } {
  const errors: string[] = []
  const normalized: { from: string; to: string }[] = []
  const byName = new Map<string, QcItem>()

  rawItems.forEach((raw, index) => {
    const label = `第 ${index + 1} 行检验项目`
    if (!raw.item.trim()) {
      errors.push(`${label}不能为空`)
      return
    }
    const standardName = resolveItemName(raw.item)
    if (!standardName) {
      errors.push(`${label}「${raw.item.trim()}」不在检验项目目录内，属非法值，请改用标准项目名后重填`)
      return
    }
    if (standardName !== raw.item.trim()) {
      normalized.push({ from: raw.item.trim(), to: standardName })
    }
    const existing = byName.get(standardName)
    if (existing) {
      // 同一项多处取到：标准/结果后填非空的覆盖，归并为同一套的一条
      if (raw.standard.trim()) existing.standard = raw.standard.trim()
      if (raw.result.trim()) existing.result = raw.result.trim()
      return
    }
    byName.set(standardName, {
      item: standardName,
      standard: raw.standard.trim(),
      result: raw.result.trim(),
      reinspectResult: '',
    })
  })

  return { items: [...byName.values()], normalized, errors }
}

export function createReport(draft: ReportDraft): ActionResult & { report?: QcReport } {
  const reportNo = draft.reportNo.trim()
  const product = draft.product.trim()
  const batchNo = draft.batchNo.trim()
  const errors: string[] = []
  if (!reportNo) errors.push('检验编号不能为空')
  if (!product) errors.push('产品不能为空')
  if (!batchNo) errors.push('产品批号不能为空')
  if (!draft.reportDate) errors.push('出报告日期不能为空')
  if (!isKnownProduct(product)) errors.push(`产品「${product}」不在产品目录内，请从目录中选择`)

  const { reports } = getState()
  if (reports.some((row) => row.reportNo === reportNo)) {
    errors.push(`检验编号「${reportNo}」已存在，不能重复登记`)
  }
  if (draft.items.length === 0) errors.push('至少登记一个检验项目')

  const { items, normalized, errors: itemErrors } = normalizeDraftItems(draft.items)
  errors.push(...itemErrors)
  if (errors.length > 0) {
    return { ok: false, message: errors.join('；') }
  }

  const stamp = nowText()
  const report: QcReport = {
    id: nextReportId(reports),
    reportNo,
    product,
    batchNo,
    reportDate: draft.reportDate,
    items,
    conclusion: '',
    verdictLog: [],
    status: '待检验',
    inspectorSign: '',
    signedAt: '',
    createdAt: stamp,
    updatedAt: stamp,
  }
  updateState({ reports: [report, ...reports] })
  const normalizeNote =
    normalized.length > 0
      ? `；已将 ${normalized.map((n) => `「${n.from}」归一为「${n.to}」`).join('、')}`
      : ''
  return { ok: true, message: `检验报告 ${reportNo} 已登记，状态「待检验」${normalizeNote}`, report }
}

/** 编辑检验项目（检验中录结果、复检中录复检结果都走这里，统一做非法值打回）。 */
export function updateReportItems(
  id: number,
  rawItems: { item: string; standard: string; result: string; reinspectResult?: string }[],
): ActionResult {
  const { reports } = getState()
  const index = reports.findIndex((row) => row.id === id)
  if (index < 0) return { ok: false, message: '没有找到这份检验报告' }
  const report = reports[index]
  if (!['检验中', '复检中'].includes(report.status)) {
    return { ok: false, message: `当前状态「${report.status}」不能录入结果，只有检验中/复检中可以录入` }
  }
  const { items, errors } = normalizeDraftItems(rawItems)
  if (errors.length > 0) return { ok: false, message: errors.join('；') }

  // 复检结果按项目对回原行，不允许借复检新增目录外项目；历史复检栏原样保留
  const nextItems = items.map((item) => {
    const previous = report.items.find((old) => old.item === item.item)
    const raw = rawItems.find((r) => resolveItemName(r.item) === item.item)
    return {
      ...item,
      reinspectResult:
        report.status === '复检中'
          ? (raw?.reinspectResult?.trim() ?? previous?.reinspectResult ?? '')
          : (previous?.reinspectResult ?? ''),
    }
  })

  const next = { ...report, items: nextItems, updatedAt: nowText() }
  const nextReports = [...reports]
  nextReports[index] = next
  updateState({ reports: nextReports })
  return { ok: true, message: '检验结果已保存' }
}

// ---------- 状态流转 ----------

function evaluate(report: QcReport, isReinspection: boolean): ReportEvaluation {
  const mode = getState().judgeMode
  if (!isReinspection) {
    return evaluateReport(
      report.items.map((i) => ({ item: i.item, standard: i.standard, result: i.result })),
      mode,
    )
  }
  // 复检：有复检结果的项目以复检结果为准，其余沿用初检；同一项目只算一条
  return evaluateReport(
    report.items.map((i) => ({
      item: i.item,
      standard: i.standard,
      result: i.reinspectResult.trim() !== '' ? i.reinspectResult : i.result,
    })),
    mode,
  )
}

/** 判定/复检判定后把结论回写到留样管理待办（按检验编号幂等，同一份只留一条）。 */
function upsertRetainTodo(report: QcReport): void {
  const { todos } = getState()
  const failedItems = report.verdictLog
    .filter((log) => log.verdict === '不合格' && !log.item.endsWith('（复检）'))
    .map((log) => log.item)
  const reinspected = report.items.some((i) => i.reinspectResult.trim() !== '')
  const summary =
    report.conclusion === '合格'
      ? `${report.items.length} 个检验项目全部合格`
      : reinspected
        ? `复检后仍不合格，涉及 ${failedItems.join('、') || '相关项目'}`
        : `初检不合格，涉及 ${failedItems.join('、') || '相关项目'}，已转复检`

  const existing = todos.findIndex((todo) => todo.reportNo === report.reportNo)
  const stamp = nowText()
  const nextTodos = [...todos]
  if (existing >= 0) {
    nextTodos[existing] = {
      ...nextTodos[existing],
      conclusion: report.conclusion as '合格' | '不合格',
      summary,
      createdAt: stamp,
    }
  } else {
    nextTodos.push({
      id: nextTodoId(todos),
      product: report.product,
      batchNo: report.batchNo,
      reportNo: report.reportNo,
      conclusion: report.conclusion as '合格' | '不合格',
      summary,
      createdAt: stamp,
      done: false,
      doneAt: '',
    })
  }
  updateState({ todos: nextTodos })
}

export function getJudgeMode(): JudgeMode {
  return getState().judgeMode
}

export function setJudgeMode(mode: JudgeMode): ActionResult {
  if (mode !== 'standard' && mode !== 'result') return { ok: false, message: '判定口径非法' }
  updateState({ judgeMode: mode })
  return { ok: true, message: '判定口径已按业务设定保存' }
}

export type QcActionResult = ActionResult & { evaluation?: ReportEvaluation }

export function executeAction(id: number, action: QcAction, signer = ''): QcActionResult {
  // 「录入结果」不推进状态，只校验后保存
  if (action === '录入结果') {
    return { ok: false, message: '录入结果请通过结果编辑窗口保存' }
  }
  const flow = QC_ACTION_FLOW[action]
  if (!flow) return { ok: false, message: `没有登记「${action}」这个动作` }

  const { reports } = getState()
  const index = reports.findIndex((row) => row.id === id)
  if (index < 0) return { ok: false, message: '没有找到这份检验报告' }
  const report = reports[index]

  if (!flow.from.includes(report.status)) {
    // 跳级 / 逆向一律挡回，并指出当前该走的下一步
    const allowed = nextActions(report.status)
    const hint = allowed.length > 0 ? `当前状态「${report.status}」只能先执行：${allowed.join('、')}` : `当前状态「${report.status}」没有可推进的动作`
    return { ok: false, message: `不能从「${report.status}」直接「${action}」，状态只能一步步往前推。${hint}` }
  }

  let next: QcReport = { ...report }
  const stamp = nowText()
  let evaluation: ReportEvaluation | undefined

  if (action === '录入完成送判定') {
    const blank = report.items.filter((item) => item.result.trim() === '')
    if (blank.length > 0) {
      return { ok: false, message: `还有 ${blank.length} 个检验项目未录入检验结果（${blank.map((i) => i.item).join('、')}），补齐后再送判定` }
    }
  }

  if (action === '执行判定' || action === '复检完成再判定') {
    const isReinspection = action === '复检完成再判定'
    if (isReinspection) {
      const missing = report.items.filter(
        (item) => isFailVerdictLog(report, item.item) && item.reinspectResult.trim() === '',
      )
      if (missing.length > 0) {
        return { ok: false, message: `以下不合格项目还没录复检结果：${missing.map((i) => i.item).join('、')}` }
      }
    }
    evaluation = evaluate(report, isReinspection)
    if (!evaluation.conclusion) {
      return { ok: false, message: `判定被挡回：${evaluation.blockedReason}` }
    }
    next.conclusion = evaluation.conclusion
    next.verdictLog = [
      ...report.verdictLog.filter(
        // 复检重判时，替换掉上一轮「复检」留痕，保留初检留痕
        (log) => !(isReinspection && log.item.endsWith('（复检）')),
      ),
      ...evaluation.verdicts.map((v) => ({
        item: isReinspection ? `${v.item}（复检）` : v.item,
        verdict: v.verdict,
        reason: v.reason,
        at: stamp,
      })),
    ]
  }

  if (action === '判定不合格转复检') {
    if (report.conclusion !== '不合格') {
      return { ok: false, message: '只有判定不合格的报告才能转复检' }
    }
  }

  if (action === '检验人签字') {
    if (!signer.trim()) {
      return { ok: false, message: '检验人必须签字（输入姓名）后才能签发报告' }
    }
    next.inspectorSign = signer.trim()
    next.signedAt = stamp
  }

  next.status = flow.to
  next.updatedAt = stamp
  const nextReports = [...reports]
  nextReports[index] = next
  updateState({ reports: nextReports })

  if (action === '执行判定' || action === '复检完成再判定') {
    upsertRetainTodo(next)
  }

  const note =
    action === '检验人签字'
      ? `检验人 ${next.inspectorSign} 已签字`
      : action === '判定不合格转复检'
        ? '报告已转复检，请在复检栏录入复检结果'
        : ''
  return {
    ok: true,
    message: `报告 ${report.reportNo}「${action}」完成，当前状态「${flow.to}」${note ? '，' + note : ''}`,
    evaluation,
  }
}

function isFailVerdictLog(report: QcReport, itemName: string): boolean {
  return report.verdictLog.some(
    (log) => (log.item === itemName || log.item === `${itemName}（复检）`) && log.verdict === '不合格',
  )
}

// ---------- 留样待办 ----------

export function listRetainTodos(includeDone = false): RetainTodo[] {
  return getState()
    .todos.filter((todo) => includeDone || !todo.done)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
}

/** 从待办登记留样：回写结果落到留样管理，登记后关闭待办。 */
export function registerRetainFromTodo(
  todoId: number,
  payload: { retainNo: string; quantity: number; period: string; storage: string },
): ActionResult {
  const { todos } = getState()
  const todoIndex = todos.findIndex((todo) => todo.id === todoId)
  if (todoIndex < 0) return { ok: false, message: '没有找到这条留样待办' }
  const todo = todos[todoIndex]
  if (todo.done) return { ok: false, message: '该待办已登记留样，无需重复办理' }
  if (!payload.retainNo.trim()) return { ok: false, message: '留样编号不能为空' }

  const retainRows = listRows('retainsample')
  if (retainRows.some((row) => String(row['留样编号']) === payload.retainNo.trim())) {
    return { ok: false, message: `留样编号「${payload.retainNo.trim()}」已存在` }
  }

  const stamp = nowText()
  const row: EntryRow = {
    id: retainRows.reduce((max, r) => Math.max(max, Number(r.id)), 0) + 1,
    status: '已留样',
    pending: true,
    abnormal: todo.conclusion === '不合格',
    留样编号: payload.retainNo.trim(),
    对应批号: todo.batchNo,
    产品名称: todo.product,
    留样数量: payload.quantity,
    留样期限: payload.period,
    存放条件: payload.storage,
    取样日期: stamp.slice(0, 10),
    销毁日期: '',
    关联检验编号: todo.reportNo,
    检验结论: todo.conclusion,
    留样状态: '已留样',
  }
  saveRows('retainsample', [...retainRows, row])

  const nextTodos = [...todos]
  nextTodos[todoIndex] = { ...todo, done: true, doneAt: stamp }
  updateState({ todos: nextTodos })
  return { ok: true, message: `批号 ${todo.batchNo} 已登记留样 ${payload.retainNo.trim()}，待办已关闭` }
}

// ---------- 按产品拆包导出 ----------

export type PackPreview = {
  period: string
  product: string
  reportDate: string
  reports: QcReport[]
  alreadyPacked: number
  isNew: boolean
}

export type PackPreviewResult = {
  packs: PackPreview[]
  noReportProducts: string[]
  newCount: number
  alreadyCount: number
}

export function listPackableProducts(period: string): string[] {
  // 当期所有在目录里的产品都要交代：有报告给分册，没报告给说明文件，不给空包
  const issued = getState().reports.filter(
    (row) => row.status === '已签发' && row.reportDate.startsWith(period),
  )
  const withReports = new Set(issued.map((row) => row.product))
  return PRODUCTS.filter((name) => withReports.has(name))
}

export function previewPacks(period: string): PackPreviewResult {
  const issued = getState()
    .reports.filter((row) => row.status === '已签发' && row.reportDate.startsWith(period))
    .sort((a, b) => (a.reportDate < b.reportDate ? -1 : 1))

  const groups = new Map<string, QcReport[]>()
  for (const report of issued) {
    const key = `${report.product}|${report.reportDate}`
    groups.set(key, [...(groups.get(key) ?? []), report])
  }

  const ledger = getState().ledger
  const packs: PackPreview[] = []
  for (const [key, reports] of groups) {
    const [product, reportDate] = key.split('|')
    const alreadyPacked = reports.filter((r) =>
      ledger.some((entry) => entry.reportNo === r.reportNo),
    ).length
    packs.push({
      period,
      product,
      reportDate,
      reports,
      alreadyPacked,
      isNew: reports.length - alreadyPacked > 0,
    })
  }

  const productsWithReports = new Set(issued.map((row) => row.product))
  const noReportProducts = PRODUCTS.filter((name) => !productsWithReports.has(name))
  return {
    packs: packs.sort((a, b) => (a.product < b.product ? -1 : 1)),
    noReportProducts,
    newCount: packs.reduce((sum, p) => sum + (p.reports.length - p.alreadyPacked), 0),
    alreadyCount: packs.reduce((sum, p) => sum + p.alreadyPacked, 0),
  }
}

function csvCell(value: string | number): string {
  const text = String(value ?? '')
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

function safeFileName(name: string): string {
  // Windows 文件名禁用字符替换掉，外发给车间/注册不能因为文件名打不开
  return name.replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, '')
}

/** 检验报告按产品分册：每个产品 × 出报告日一包；复检另开一栏；检验人签字栏。 */
function buildFascicleCsv(pack: PackPreview): { path: string; bytes: Uint8Array } {
  const header = [
    '产品名称',
    '出报告日期',
    '产品批号',
    '检验编号',
    '检验项目',
    '标准规定',
    '检验结果',
    '复检结果（另栏）',
    '判定结论',
    '检验人签字',
  ]
  const lines = [header.map(csvCell).join(',')]
  for (const report of pack.reports) {
    for (const item of report.items) {
      lines.push(
        [
          report.product,
          report.reportDate,
          report.batchNo,
          report.reportNo,
          item.item,
          item.standard,
          item.result,
          item.reinspectResult || '—',
          report.conclusion,
          report.inspectorSign || '未签字',
        ]
          .map(csvCell)
          .join(','),
      )
    }
  }
  const fileName = `检验报告分册_${safeFileName(pack.product)}_出报告${pack.reportDate}.csv`
  return { path: `${safeFileName(pack.period)}检验报告按产品分包/${fileName}`, bytes: encodeFile(`﻿${lines.join('\r\n')}`) }
}

function buildNoReportNote(period: string, product: string): { path: string; bytes: Uint8Array } {
  const text = [
    '检验报告情况说明',
    '',
    `产品名称：${product}`,
    `报告周期：${period}`,
    `出具日期：${nowText().slice(0, 10)}`,
    '',
    `说明：${period} 周期内该产品无已签发的成品检验报告，故不随附空报告包。`,
    '如对报告安排有疑问，请联系质量管理部成品检验岗。',
    '',
  ].join('\r\n')
  const path = `${safeFileName(period)}检验报告按产品分包/无报告说明_${safeFileName(product)}_${period}.txt`
  return { path, bytes: encodeFile(text) }
}

function buildManifest(period: string, packs: PackPreview[], noReportProducts: string[]): { path: string; bytes: Uint8Array } {
  const lines = ['包内序号,产品名称,出报告日期,检验编号,产品批号,判定结论,是否重复打包']
  let seq = 1
  for (const pack of packs) {
    for (const report of pack.reports) {
      const packed = getState().ledger.some((entry) => entry.reportNo === report.reportNo)
      lines.push(
        [seq++, pack.product, pack.reportDate, report.reportNo, report.batchNo, report.conclusion, packed ? '是（不重复计数）' : '否']
          .map(csvCell)
          .join(','),
      )
    }
  }
  for (const product of noReportProducts) {
    lines.push([seq++, product, period, '—', '—', '当期无报告，附情况说明', '—'].map(csvCell).join(','))
  }
  return {
    path: `${safeFileName(period)}检验报告按产品分包/分包清单_${period}.csv`,
    bytes: encodeFile(`﻿${lines.join('\r\n')}`),
  }
}

const textEncoder = new TextEncoder()
function encodeFile(text: string): Uint8Array {
  return textEncoder.encode(text)
}

export type PackResult = {
  ok: boolean
  message: string
  filename?: string
  blob?: Blob
  newCount?: number
}

/**
 * 导出当期全部产品包：有报告的产品按「产品 × 出报告日」分册（每册只放
 * 检验编号/检验项目/标准规定/检验结果，加复检栏与签字栏）；当期没报告的产品
 * 附情况说明，不给空包。同一份报告重复打包台账里只算一次。
 */
export function exportPeriodPacks(period: string): PackResult {
  if (!/^\d{4}-\d{2}$/.test(period)) {
    return { ok: false, message: '打包周期格式应为 YYYY-MM，例如 2026-10' }
  }
  const preview = previewPacks(period)
  const entries: ZipEntry[] = [
    ...preview.packs.map(buildFascicleCsv).map((entry) => ({ path: entry.path, content: entry.bytes })),
    ...preview.noReportProducts
      .map((product) => buildNoReportNote(period, product))
      .map((entry) => ({ path: entry.path, content: entry.bytes })),
    (() => {
      const manifest = buildManifest(period, preview.packs, preview.noReportProducts)
      return { path: manifest.path, content: manifest.bytes }
    })(),
  ]

  const zipBytes = buildZip(entries)
  const blob = new Blob([zipBytes as BlobPart], { type: 'application/zip' })
  const filename = `检验报告按产品分包_${period}.zip`

  // 写台账：同一份检验编号只记一次，重复打包只算一次
  const stamp = nowText()
  const existing = getState().ledger
  const known = new Set(existing.map((entry) => entry.reportNo))
  const additions: PackLedgerEntry[] = []
  for (const pack of preview.packs) {
    for (const report of pack.reports) {
      if (!known.has(report.reportNo)) {
        additions.push({
          reportNo: report.reportNo,
          product: report.product,
          batchNo: report.batchNo,
          reportDate: report.reportDate,
          period,
          packedAt: stamp,
        })
      }
    }
  }
  updateState({ ledger: [...existing, ...additions] })

  return {
    ok: true,
    message: `已生成 ${preview.packs.length} 个产品报告包（新计入 ${additions.length} 份，重复打包不计 ${preview.alreadyCount} 份），并为 ${preview.noReportProducts.length} 个无报告产品附情况说明`,
    filename,
    blob,
    newCount: additions.length,
  }
}

export function listLedger(): PackLedgerEntry[] {
  return [...getState().ledger].sort((a, b) => (a.packedAt < b.packedAt ? 1 : -1))
}

export function packedReportNos(): Set<string> {
  return new Set(getState().ledger.map((entry) => entry.reportNo))
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

// ---------- 看板指标 ----------

export function qcStats(): { label: string; value: number }[] {
  const reports = getState().reports
  return [
    { label: '待检验/检验中', value: reports.filter((r) => r.status === '待检验' || r.status === '检验中').length },
    { label: '待判定/待签字', value: reports.filter((r) => r.status === '待判定' || r.status === '待签字').length },
    { label: '复检中', value: reports.filter((r) => r.status === '复检中').length },
    { label: '留样待办', value: getState().todos.filter((t) => !t.done).length },
  ]
}
