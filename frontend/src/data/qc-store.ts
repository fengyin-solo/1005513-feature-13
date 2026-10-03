import { SEED_QC_REPORTS, SEED_RETAIN_TODOS } from './seed-qc'
import type { JudgeMode } from './judge'
import type { PackLedgerEntry, QcReport, RetainTodo } from './types'

// 成品检验专用存储：报告是多检验项目结构，和通用 EntryRow 分开存，互不干扰。
const QC_KEY = 'pharma-cleanroom:qc:v1'

export type QcState = {
  reports: QcReport[]
  todos: RetainTodo[]
  ledger: PackLedgerEntry[]
  judgeMode: JudgeMode
}

const FALLBACK: QcState = {
  reports: JSON.parse(JSON.stringify(SEED_QC_REPORTS)),
  todos: JSON.parse(JSON.stringify(SEED_RETAIN_TODOS)),
  ledger: [],
  judgeMode: 'standard',
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

let cache: QcState | null = null

function readState(): QcState {
  if (cache) {
    return cache
  }
  if (typeof window === 'undefined' || !window.localStorage) {
    cache = clone(FALLBACK)
    return cache
  }
  const raw = window.localStorage.getItem(QC_KEY)
  if (!raw) {
    cache = clone(FALLBACK)
    writeState(cache)
    return cache
  }
  try {
    const parsed = JSON.parse(raw) as Partial<QcState>
    cache = {
      reports: Array.isArray(parsed.reports) ? parsed.reports : clone(FALLBACK.reports),
      todos: Array.isArray(parsed.todos) ? parsed.todos : clone(FALLBACK.todos),
      ledger: Array.isArray(parsed.ledger) ? parsed.ledger : [],
      judgeMode: parsed.judgeMode === 'result' ? 'result' : 'standard',
    }
    return cache
  } catch {
    cache = clone(FALLBACK)
    writeState(cache)
    return cache
  }
}

function writeState(state: QcState): void {
  cache = state
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(QC_KEY, JSON.stringify(state))
  }
}

export function getState(): QcState {
  return readState()
}

export function updateState(patch: Partial<QcState>): QcState {
  const next = { ...readState(), ...patch }
  writeState(next)
  return next
}

export function resetQc(): QcState {
  const fresh = clone(FALLBACK)
  writeState(fresh)
  return fresh
}

/** 测试用：强制回到种子状态并清掉持久化（忽略浏览器里残留）。 */
export function __resetQcForTest(): QcState {
  cache = null
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.removeItem(QC_KEY)
  }
  return readState()
}
