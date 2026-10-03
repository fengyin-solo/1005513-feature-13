import {
  MODULE_BY_KEY,
} from '@/data/modules'
import { listRows, saveRows } from '@/data/local-store'
import {
  appendPackage,
  clearPackages,
  listPackages,
  packagedRowIds,
  type PackageLedgerItem,
} from '@/data/aux-store'
import type { ActionResult, EntryRow } from '@/data/types'
import { evaluateReport, parseItems, validateItems } from './qc-rules'
import { csvCell, downloadBlob, safeName } from '@/utils/csv'
import { buildZip, type ZipEntry } from '@/utils/zip'

const QC_KEY = 'finishedqc'
const RETAIN_KEY = 'retainsample'

export function qcMeta() {
  const meta = MODULE_BY_KEY.get(QC_KEY)
  if (!meta) {
    throw new Error('成品检验模块未登记')
  }
  return meta
}

/** 检验编号去掉复检后缀（-R2、-R3…），同一份初复检报告归到同一基础编号。 */
export function baseReportNo(reportNo: string): string {
  return String(reportNo ?? '').replace(/-R\d+$/, '')
}

function isTerminal(status: string): boolean {
  return ['已合格', '不合格', '复检合格'].includes(status)
}

function isRoundReinspection(round: string): boolean {
  return String(round ?? '') !== '初次检验'
}

// ---------- 登记：非法项目打回重填 ----------

export type ReportDraft = {
  检验编号: string
  产品名称: string
  产品批号: string
  报告日期: string
  检验项目: string
  标准规定: string
  检验结果: string
}

export type SaveReportResult = ActionResult & { id?: number }

export function createReport(draft: ReportDraft): SaveReportResult {
  const no = draft.检验编号.trim()
  const product = draft.产品名称.trim()
  const batchNo = draft.产品批号.trim()
  const date = draft.报告日期.trim()
  if (!no || !product || !batchNo || !date) {
    return { ok: false, message: '检验编号、产品名称、产品批号、出报告日均为必填，请补全后再提交' }
  }
  const rows = listRows(QC_KEY)
  if (rows.some((row) => String(row['检验编号']) === no)) {
    return { ok: false, message: `检验编号「${no}」已存在，请核对后重填` }
  }
  const itemCheck = validateItems(draft.检验项目)
  if (!itemCheck.ok) {
    return { ok: false, message: itemCheck.message }
  }
  if (!String(draft.标准规定 ?? '').trim() || !String(draft.检验结果 ?? '').trim()) {
    return { ok: false, message: '标准规定与检验结果必须同时填写，请补齐后重填' }
  }
  const now = new Date()
  const id = rows.length ? Math.max(...rows.map((row) => Number(row.id))) + 1 : 1
  const row: EntryRow = {
    id,
    status: '待检验',
    pending: true,
    abnormal: false,
    检验编号: no,
    产品名称: product,
    产品批号: batchNo,
    检验轮次: '初次检验',
    报告日期: date,
    检验项目: itemCheck.items.join('；'),
    标准规定: String(draft.标准规定).trim(),
    检验结果: String(draft.检验结果).trim(),
    判定结论: '',
    检验人签字: '',
    创建时间: now.toISOString(),
  }
  saveRows(QC_KEY, [...rows, row])
  return { ok: true, message: `成品检验报告「${no}」已登记，状态「待检验」`, id }
}

// ---------- 检验人签字 ----------

export function signReport(id: number, signer: string): ActionResult {
  const name = signer.trim()
  if (!name) {
    return { ok: false, message: '检验人必须亲笔签字，签名不能为空' }
  }
  const rows = listRows(QC_KEY)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的成品检验报告` }
  }
  const current = String(rows[index].status)
  if (current === '待检验') {
    return { ok: false, message: '报告尚未提交检验，不能签字，请先「提交检验」' }
  }
  const date = new Date().toISOString().slice(0, 10)
  const next = [...rows]
  next[index] = { ...rows[index], 检验人签字: `${name}（${date}）` }
  saveRows(QC_KEY, next)
  return { ok: true, message: `检验人 ${name} 已签字` }
}

// ---------- 判定：标准规定说了算，并回写留样待办 ----------

export function judgeReport(id: number, wanted: '合格' | '不合格'): ActionResult {
  const rows = listRows(QC_KEY)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的成品检验报告` }
  }
  const row = rows[index]
  const current = String(row.status)
  if (!['检验中', '复检中'].includes(current)) {
    return { ok: false, message: `报告当前是「${current}」，不在可判定环节，请按状态一步步推进` }
  }
  const verdict = evaluateReport(row)
  if (verdict.verdict === '无法判定') {
    return { ok: false, message: verdict.message }
  }
  // 业务口径先定：标准规定与人工想要的结论矛盾时，以标准规定为准，挡回。
  if (verdict.verdict !== wanted) {
    return {
      ok: false,
      message: `检验结果与标准规定比对为「${verdict.verdict}」，以标准规定为准，不能判定${wanted}。${verdict.message}`,
    }
  }
  const reinspection = current === '复检中'
  const target = wanted === '合格' ? (reinspection ? '复检合格' : '已合格') : '不合格'
  const updated: EntryRow = {
    ...row,
    status: target,
    pending: false,
    abnormal: wanted === '不合格',
    判定结论: `${wanted}（按标准规定判定）`,
  }
  const next = [...rows]
  next[index] = updated
  saveRows(QC_KEY, next)
  writeBackRetainTodo(updated)
  return { ok: true, message: verdict.message }
}

/** 判定到终态后，把结论回写到留样管理同批号记录的待办，留样室据此安排放行留样/隔离。 */
function writeBackRetainTodo(row: EntryRow): void {
  const batchNo = String(row['产品批号'] ?? '')
  if (!batchNo) {
    return
  }
  const retainRows = listRows(RETAIN_KEY)
  const no = String(row['检验编号'] ?? '')
  const round = String(row['检验轮次'] ?? '初次检验')
  const conclusion = row.status === '不合格' ? '不合格，留样隔离待处置' : '合格，可安排放行留样'
  const todo = `检验报告 ${no}（${round}）${conclusion}`
  let touched = false
  const next = retainRows.map((item) => {
    if (String(item['对应批号']) !== batchNo || ['已销毁'].includes(String(item.status))) {
      return item
    }
    touched = true
    const previous = String(item['待办事项'] ?? '')
    const tasks = previous.split(/\r?\n/).map((t) => t.trim()).filter(Boolean)
    // 同一份基础报告的结论只保留最新一条，避免初复检重复堆待办。
    const baseNo = baseReportNo(no)
    const filtered = tasks.filter((task) => !task.includes(`检验报告 ${baseNo}`))
    filtered.push(todo)
    return { ...item, 待办事项: filtered.join('\n'), pending: true }
  })
  if (touched) {
    saveRows(RETAIN_KEY, next)
  }
}

// ---------- 发起复检：另开一条复检记录 ----------

export function startReinspection(id: number): SaveReportResult {
  const rows = listRows(QC_KEY)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的成品检验报告` }
  }
  const source = rows[index]
  if (String(source.status) !== '不合格') {
    return { ok: false, message: `报告当前是「${source.status}」，只有「不合格」的报告才能发起复检` }
  }
  const baseNo = baseReportNo(String(source['检验编号']))
  const rounds = rows
    .filter((row) => baseReportNo(String(row['检验编号'])) === baseNo)
    .map((row) => String(row['检验编号']))
  const roundNo = rounds.length + 1
  const newId = rows.length ? Math.max(...rows.map((row) => Number(row.id))) + 1 : 1
  const copy: EntryRow = {
    ...source,
    id: newId,
    status: '复检中',
    pending: true,
    abnormal: false,
    检验编号: `${baseNo}-R${roundNo}`,
    检验轮次: `复检第${roundNo - 1}次`,
    判定结论: '',
    检验人签字: '',
  }
  saveRows(QC_KEY, [...rows, copy])
  // 原不合格报告保持「不合格」终态；复检记录直接进入复检环节，不回写状态机。
  return { ok: true, message: `已为报告「${baseNo}」另开复检栏：复检编号 ${copy.检验编号}`, id: newId }
}

// ---------- 按产品分册打包 ----------

export type Period = { start: string; end: string }

export type PackageReport = {
  rows: EntryRow[]
  baseNo: string
  product: string
  batchNo: string
  date: string
  signed: boolean
  round: string
}

/** 把同一基础检验编号下的多行（初检+各次复检）归并成一份报告。 */
function groupReports(rows: EntryRow[]): PackageReport[] {
  const map = new Map<string, EntryRow[]>()
  for (const row of rows) {
    const baseNo = baseReportNo(String(row['检验编号']))
    const group = map.get(baseNo) ?? []
    group.push(row)
    map.set(baseNo, group)
  }
  return [...map.values()].map((group) => {
    const sorted = [...group].sort((a, b) => String(a['检验编号']).localeCompare(String(b['检验编号'])))
    const dates = sorted.map((row) => String(row['报告日期'] ?? '')).filter(Boolean).sort()
    return {
      rows: sorted,
      baseNo: baseReportNo(String(sorted[0]['检验编号'])),
      product: String(sorted[0]['产品名称'] ?? '未登记产品'),
      batchNo: String(sorted[0]['产品批号'] ?? ''),
      date: dates[dates.length - 1] ?? '',
      signed: sorted.every((row) => String(row['检验人签字'] ?? '').trim() !== ''),
      round: sorted.some((row) => isRoundReinspection(String(row['检验轮次']))) ? '含复检' : '初检',
    }
  })
}

function inPeriod(date: string, period: Period): boolean {
  const value = String(date ?? '')
  if (!value) {
    return false
  }
  return (!period.start || value >= period.start) && (!period.end || value <= period.end)
}

/** 当期产品名册：当期有批生产记录的产品 ∪ 当期出了报告的产品；名册外不发任何东西。 */
function periodProducts(period: Period): string[] {
  const names = new Set<string>()
  for (const row of listRows('batchrecord')) {
    const product = String(row['产品名称'] ?? '').trim()
    if (product) {
      names.add(product)
    }
  }
  for (const report of groupReports(listRows(QC_KEY))) {
    if (inPeriod(report.date, period)) {
      names.add(report.product)
    }
  }
  return [...names].sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'))
}

export type PackagePlan = {
  reports: PackageReport[]
  ready: PackageReport[]
  unsigned: PackageReport[]
  productsWithReport: string[]
  productsWithoutReport: string[]
}

export function buildPackagePlan(period: Period): PackagePlan {
  const reports = groupReports(listRows(QC_KEY)).filter((report) => inPeriod(report.date, period))
  const ready = reports.filter((report) => isTerminalReport(report) && report.signed)
  const unsigned = reports.filter((report) => isTerminalReport(report) && !report.signed)
  const productsWithReport = [...new Set(ready.map((report) => report.product))]
  const productsWithoutReport = periodProducts(period).filter(
    (product) => !productsWithReport.includes(product),
  )
  return { reports, ready, unsigned, productsWithReport, productsWithoutReport }
}

function isTerminalReport(report: PackageReport): boolean {
  // 一组报告以最后一条的状态定生死；最后一条已到终态才允许出包。
  const last = report.rows[report.rows.length - 1]
  return isTerminal(String(last.status))
}

function sectionRows(rows: EntryRow[], reinspection: boolean): EntryRow[] {
  return rows.filter((row) => isRoundReinspection(String(row['检验轮次'])) === reinspection)
}

function renderSection(title: string, rows: EntryRow[]): string[] {
  const lines: string[] = [`【${title}】`]
  lines.push(['检验编号', '检验项目', '标准规定', '检验结果', '检验人签字'].map(csvCell).join(','))
  for (const row of rows) {
    const items = parseItems(row['检验项目'])
    const specs = String(row['标准规定'] ?? '').split(/[;；\n\r]+/).map((s) => s.trim()).filter(Boolean)
    const results = String(row['检验结果'] ?? '').split(/[;；\n\r]+/).map((s) => s.trim()).filter(Boolean)
    const max = Math.max(items.length, specs.length, results.length, 1)
    for (let i = 0; i < max; i += 1) {
      lines.push(
        [
          i === 0 ? String(row['检验编号']) : '',
          items[i] ?? '',
          specs[i] ?? '',
          results[i] ?? '',
          i === 0 ? String(row['检验人签字'] ?? '') : '',
        ]
          .map(csvCell)
          .join(','),
      )
    }
  }
  return lines
}

/** 单个产品分册：初检一栏、复检另开一栏。 */
export function renderProductBooklet(product: string, reports: PackageReport[]): { filename: string; content: string } {
  const sorted = [...reports].sort((a, b) => a.baseNo.localeCompare(b.baseNo, 'zh-Hans-CN'))
  const date = sorted.map((r) => r.date).filter(Boolean).sort().reverse()[0] ?? ''
  const parts: string[] = []
  for (const report of sorted) {
    parts.push(
      `产品名称：${product}，产品批号：${report.batchNo}，基础检验编号：${report.baseNo}，分册出报告日：${report.date}`,
    )
    const initial = sectionRows(report.rows, false)
    const reinspection = sectionRows(report.rows, true)
    if (initial.length > 0) {
      parts.push(...renderSection('初次检验', initial))
    }
    if (reinspection.length > 0) {
      parts.push('')
      parts.push(...renderSection('复检', reinspection))
    }
    parts.push('')
  }
  const filename = `${safeName(product)}-${safeName(date)}.csv`
  return { filename, content: addBom(parts.join('\r\n')) }
}

function addBom(text: string): string {
  return `﻿${text}`
}

function renderNoReportNote(product: string, period: Period): { filename: string; content: string } {
  const text = [
    `产品名称：${product}`,
    `报告期间：${period.start || '不限'} 至 ${period.end || '不限'}`,
    '',
    `说明：该产品在上述报告期间内没有形成已判定并签字的成品检验报告，故本包不附检验分册，不发空包。`,
    '出具人：质量管理部',
    `出具日期：${new Date().toISOString().slice(0, 10)}`,
  ].join('\r\n')
  return { filename: `${safeName(product)}-本期无报告说明.txt`, content: text }
}

export type PackageResult = ActionResult & {
  zipName?: string
  included?: number
  duplicates?: number
  noteCount?: number
  ledger?: PackageLedgerItem
}

/** 出包：未签字的终态报告一律挡回；同一份报告重复打包只算一次。 */
export function packageReports(period: Period): PackageResult {
  const plan = buildPackagePlan(period)
  if (plan.unsigned.length > 0) {
    const names = plan.unsigned.map((report) => report.baseNo).join('、')
    return {
      ok: false,
      message: `以下终态报告尚未经检验人签字，不能外发：${names}。请先签字再打包。`,
    }
  }
  if (plan.ready.length === 0 && plan.productsWithoutReport.length === 0) {
    return { ok: false, message: '当期没有可出包的成品检验报告，也没有当期在产产品，未生成包' }
  }

  const alreadyPackaged = packagedRowIds()
  const byProduct = new Map<string, PackageReport[]>()
  let duplicateReports = 0
  let newReports = 0
  for (const report of plan.ready) {
    const anyRowPackaged = report.rows.some((row) => alreadyPackaged.has(Number(row.id)))
    if (anyRowPackaged) {
      duplicateReports += 1
    } else {
      newReports += 1
    }
    const list = byProduct.get(report.product) ?? []
    list.push(report)
    byProduct.set(report.product, list)
  }

  const zipEntries: ZipEntry[] = []
  const ledgerEntries = []
  for (const [product, reports] of byProduct) {
    const booklet = renderProductBooklet(product, reports)
    const date = reports.map((r) => r.date).filter(Boolean).sort().reverse()[0] ?? ''
    zipEntries.push({ path: `${safeName(product)}-${safeName(date)}/${booklet.filename}`, content: booklet.content })
    for (const report of reports) {
      for (const row of report.rows) {
        ledgerEntries.push({
          rowId: Number(row.id),
          baseNo: report.baseNo,
          product,
          batchNo: report.batchNo,
          round: String(row['检验轮次'] ?? '初次检验'),
        })
      }
    }
  }
  for (const product of plan.productsWithoutReport) {
    const note = renderNoReportNote(product, period)
    zipEntries.push({ path: note.filename, content: note.content })
  }

  const stamp = new Date()
  const stampText = `${stamp.getFullYear()}${String(stamp.getMonth() + 1).padStart(2, '0')}${String(
    stamp.getDate(),
  ).padStart(2, '0')}-${String(stamp.getHours()).padStart(2, '0')}${String(stamp.getMinutes()).padStart(2, '0')}`
  const zipName = `成品检验分册外发包-${period.start || '不限'}_${period.end || '不限'}-${stampText}.zip`
  const ledger: PackageLedgerItem = {
    batchId: `PKG-${stampText}`,
    periodStart: period.start,
    periodEnd: period.end,
    packagedAt: stamp.toISOString(),
    zipName,
    entries: ledgerEntries,
  }
  appendPackage(ledger)
  downloadBlob(buildZip(zipEntries), zipName)

  return {
    ok: true,
    zipName,
    included: newReports,
    duplicates: duplicateReports,
    noteCount: plan.productsWithoutReport.length,
    ledger,
    message:
      `已生成并下载外发包：${zipName}；本次新计入报告 ${newReports} 份，重复打包只算一次 ${duplicateReports} 份，` +
      `无报告产品说明 ${plan.productsWithoutReport.length} 份。`,
  }
}

export function packageHistory(): PackageLedgerItem[] {
  return listPackages()
}

/** 重置成品检验时同步清空打包台账，回到初始口径。 */
export function resetFinishedqc(): void {
  clearPackages()
}
