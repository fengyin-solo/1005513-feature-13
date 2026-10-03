/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

export type EntryRow = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  [field: string]: string | number | boolean
}

export type ModuleMeta = {
  key: string
  name: string
  entity: string
  desc: string
  fields: string[]
  statuses: string[]
  actions: string[]
  actionTargets: Record<string, string>
  metrics: string[]
}

export type PageResult = {
  items: EntryRow[]
  total: number
  page: number
  size: number
}

export type ActionResult = {
  ok: boolean
  message: string
}

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: { name: string; created: number; pending: number; abnormal: number }[]
}

/** 成品检验：一份报告含多个检验项目，复检结果与初检结果并排另开一栏。 */
export type QcItem = {
  /** 归一后的标准检验项目名 */
  item: string
  standard: string
  result: string
  /** 复检结果；未复检时为空，分册导出时单独成栏 */
  reinspectResult: string
}

/** 状态只能逐级推进，允许的边都在 qc-service 的 QC_ACTION_FLOW 里，跳级一律挡回。 */
export type QcStatus = '待检验' | '检验中' | '待判定' | '待签字' | '复检中' | '已签发'

export type QcAction =
  | '开始检验'
  | '录入结果'
  | '录入完成送判定'
  | '退回补录结果'
  | '执行判定'
  | '检验人签字'
  | '判定不合格转复检'
  | '复检完成再判定'

export type QcReport = {
  id: number
  /** 检验编号（业务唯一），重复打包按它去重 */
  reportNo: string
  product: string
  batchNo: string
  reportDate: string
  items: QcItem[]
  conclusion: '合格' | '不合格' | ''
  /** 单项判定依据，随判定动作留痕 */
  verdictLog: { item: string; verdict: string; reason: string; at: string }[]
  status: QcStatus
  inspectorSign: string
  signedAt: string
  createdAt: string
  updatedAt: string
}

/** 检验结果回写到留样管理的待办；批号+检验编号相同只回写一次。 */
export type RetainTodo = {
  id: number
  product: string
  batchNo: string
  reportNo: string
  conclusion: '合格' | '不合格'
  summary: string
  createdAt: string
  done: boolean
  doneAt: string
}

export type PackLedgerEntry = {
  reportNo: string
  product: string
  batchNo: string
  reportDate: string
  period: string
  packedAt: string
}

