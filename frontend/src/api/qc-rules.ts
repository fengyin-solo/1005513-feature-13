import type { EntryRow } from '@/data/types'

/**
 * 成品检验业务规则：检验项目字典、项目归并、标准规定与检验结果的比对判定。
 * 判定口径先按业务规则定：检验结果与标准规定矛盾时，以标准规定为准，人工结论挡回。
 */

// 检验项目的「同一套」字典：成品检验报告里多处填到的项目，统一归并到这套法定项目名。
export const LEGAL_ITEMS = [
  '性状',
  '鉴别',
  '重量差异',
  '装量差异',
  '溶出度',
  '含量均匀度',
  '水分',
  '干燥失重',
  '粒度',
  '含量测定',
  '有关物质',
  '微生物限度',
  '细菌内毒素',
] as const

const ITEM_SPLIT_RE = /[;；、\n\r]+/
// 「；」分项目，但同一项目的子句（如含逗号的描述）不拆开；逗号不作为项目分隔符。
const CLAUSE_SPLIT_RE = /[;；\n\r]+/

/** 把一处或多处文本里的检验项目拆开、去空白、去重；项目名本身不做字典外改写。 */
export function parseItems(raw: unknown): string[] {
  const text = String(raw ?? '')
  const seen = new Set<string>()
  const items: string[] = []
  for (const part of text.split(ITEM_SPLIT_RE)) {
    const name = part.replace(/^[\s，,：:·-]+|[\s，,：:·-]+$/g, '').trim()
    if (name && !seen.has(name)) {
      seen.add(name)
      items.push(name)
    }
  }
  return items
}

export type ItemValidation = {
  ok: boolean
  items: string[]
  invalid: string[]
  message: string
}

/** 登记/改填时校验：项目不能为空，且每一项都必须在法定项目字典里，非法值打回重填。 */
export function validateItems(raw: unknown): ItemValidation {
  const items = parseItems(raw)
  if (items.length === 0) {
    return { ok: false, items, invalid: [], message: '检验项目不能为空，请按法定项目重填' }
  }
  const invalid = items.filter((item) => !LEGAL_ITEMS.includes(item as (typeof LEGAL_ITEMS)[number]))
  if (invalid.length > 0) {
    return {
      ok: false,
      items,
      invalid,
      message: `检验项目「${invalid.join('、')}」不是法定检验项目，请打回重填（法定项目：${LEGAL_ITEMS.join('、')}）`,
    }
  }
  return { ok: true, items, invalid: [], message: '' }
}

/** 同一份报告多处行取到的项目并成同一套：按字典顺序归并去重。 */
export function mergeReportItems(rows: EntryRow[]): string[] {
  const union = new Set<string>()
  for (const row of rows) {
    for (const item of parseItems(row['检验项目'])) {
      union.add(item)
    }
  }
  return [...union].sort((a, b) => {
    const ia = LEGAL_ITEMS.indexOf(a as (typeof LEGAL_ITEMS)[number])
    const ib = LEGAL_ITEMS.indexOf(b as (typeof LEGAL_ITEMS)[number])
    if (ia === -1 && ib === -1) return a.localeCompare(b, 'zh-Hans-CN')
    if (ia === -1) return 1
    if (ib === -1) return -1
    return ia - ib
  })
}

const NUMBER_RE = /-?\d+(?:\.\d+)?/

type NumericRule =
  | { kind: 'range'; low: number; high: number; percent: boolean }
  | { kind: 'gte'; value: number; percent: boolean }
  | { kind: 'lte'; value: number; percent: boolean }
  | { kind: 'eq'; value: number; percent: boolean }

function toNumber(match: RegExpMatchArray, index: number): number {
  return Number(match[index])
}

/** 从一条标准规定子句里解析数值限度；解析不出来就走文本口径。 */
function parseNumericRule(text: string): NumericRule | null {
  const percent = /%|％|百分之|标示量/.test(text)
  const range = text.match(/(\d+(?:\.\d+)?)\s*(?:%|％)?\s*(?:~|～|－|—|-|至)\s*(\d+(?:\.\d+)?)\s*(?:%|％)?/)
  if (range) {
    return { kind: 'range', low: toNumber(range, 1), high: toNumber(range, 2), percent }
  }
  const gte = text.match(/(?:≥|>=|不低于|不小于|不得少于|不少于|大于等于|高于)(-?\d+(?:\.\d+)?)/)
  if (gte) {
    return { kind: 'gte', value: toNumber(gte, 1), percent }
  }
  const lte = text.match(/(?:≤|<=|不高于|不大于|不得过|不得超过|不超过|小于等于|低于)(-?\d+(?:\.\d+)?)/)
  if (lte) {
    return { kind: 'lte', value: toNumber(lte, 1), percent }
  }
  const eq = text.match(/(?:应为|=|等于)(?:标示量的)?\s*(\d+(?:\.\d+)?)\s*(?:%|％)?(?!\s*(?:~|～|-|至))/)
  if (eq && /应|=|等于/.test(text)) {
    return { kind: 'eq', value: toNumber(eq, 1), percent }
  }
  return null
}

/** 结果里取数值：优先取带与标准相同单位的数值，否则取第一个数值。 */
function extractResultNumber(result: string, percent: boolean): number | null {
  const matches = [...result.matchAll(new RegExp(NUMBER_RE.source, 'g'))].map((m) => Number(m[0]))
  if (matches.length === 0) {
    return null
  }
  if (percent) {
    const withPercent = result.match(/(\d+(?:\.\d+)?)\s*(?:%|％)/)
    if (withPercent) {
      return Number(withPercent[1])
    }
  }
  return matches[0]
}

/** 同一份标准与结果若一个写百分数、一个写小数，按量级归一后再比。 */
function normalizePair(ruleValue: number, resultValue: number): number {
  if (ruleValue >= 1 && resultValue > 0 && resultValue <= 1.5) {
    return resultValue * 100
  }
  if (ruleValue <= 1.5 && resultValue >= 10) {
    return resultValue / 100
  }
  return resultValue
}

function compareNumeric(rule: NumericRule, result: string): '合格' | '不合格' {
  const raw = extractResultNumber(result, rule.percent)
  if (raw === null) {
    return '不合格'
  }
  const value =
    rule.kind === 'range'
      ? normalizePair(rule.low, raw)
      : normalizePair(rule.kind === 'eq' ? rule.value : rule.value, raw)
  switch (rule.kind) {
    case 'range':
      return value >= rule.low && value <= rule.high ? '合格' : '不合格'
    case 'gte':
      return value >= rule.value ? '合格' : '不合格'
    case 'lte':
      return value <= rule.value ? '合格' : '不合格'
    case 'eq':
      // 等值限度给出 ±0.1 的数值容差，避免有效数字导致误判。
      return Math.abs(value - rule.value) <= 0.1 ? '合格' : '不合格'
  }
}

/** 文本型标准的口径：「应符合规定」「不得检出」「应为白色或类白色」等。 */
function compareText(spec: string, result: string): '合格' | '不合格' | '无法判定' {
  const negated = /不得|不应|不许|禁止/.test(spec)
  if (/检出/.test(spec) && negated) {
    // 标准要求「不得检出」：结果写未检出/无菌生长为合格，写检出为不合格，其余无法判定。
    if (/未检出|无菌生长|无菌|未检出菌|未发现菌落/.test(result)) {
      return '合格'
    }
    if (/检出|菌落生长|有菌|生长/.test(result)) {
      return '不合格'
    }
    return '无法判定'
  }
  if (/应符合|符合规定|符合要求|符合限度/.test(spec)) {
    if (/不符合|未符合|超出规定|超出限度|超限|超标|超限度|超过规定|不合格/.test(result)) return '不合格'
    if (/符合规定|符合要求|符合限度/.test(result)) return '合格'
    return '无法判定'
  }
  const expectMatch = spec.match(/(?:应为|应呈|应显|应)([一-龥A-Za-z0-9.%～~]+(?:或[一-龥A-Za-z0-9.%～~]+)*)/)
  if (expectMatch) {
    const tokens = expectMatch[1].split('或').map((t) => t.trim()).filter(Boolean)
    if (tokens.some((token) => result.includes(token))) {
      return '合格'
    }
    // 结果明确否定（不/非/未 + 性状词）判不合格；描述不清的交回人工核对。
    if (new RegExp(`(?:不|非|未)${tokens.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')}`).test(result)) {
      return '不合格'
    }
    return '无法判定'
  }
  return '无法判定'
}

export type ClauseVerdict = {
  spec: string
  result: string
  outcome: '合格' | '不合格' | '无法判定'
}

function splitClauses(raw: unknown): string[] {
  return String(raw ?? '')
    .split(CLAUSE_SPLIT_RE)
    .map((part) => part.trim())
    .filter(Boolean)
}

/** 标准子句与结果子句配对：优先按子句里出现的项目名配对，配不上再按行号对齐。 */
function pairClauses(specs: string[], results: string[], items: string[]): ClauseVerdict[] {
  const usedResult = new Set<number>()
  const verdicts: ClauseVerdict[] = specs.map((spec) => {
    let matchedIndex = results.findIndex(
      (result, index) =>
        !usedResult.has(index) && items.some((item) => spec.includes(item) && result.includes(item)),
    )
    if (matchedIndex < 0) {
      matchedIndex = results.findIndex((_, index) => !usedResult.has(index))
    }
    const result = matchedIndex >= 0 ? results[matchedIndex] : ''
    if (matchedIndex >= 0) {
      usedResult.add(matchedIndex)
    }
    return judgeClause(spec, result)
  })
  return verdicts
}

function judgeClause(spec: string, result: string): ClauseVerdict {
  if (!result) {
    return { spec, result, outcome: '无法判定' }
  }
  const rule = parseNumericRule(spec)
  if (rule) {
    return { spec, result, outcome: compareNumeric(rule, result) }
  }
  return { spec, result, outcome: compareText(spec, result) }
}

export type ReportVerdict = {
  verdict: '合格' | '不合格' | '无法判定'
  clauses: ClauseVerdict[]
  message: string
}

/**
 * 按业务规则判定整份报告：任一项不符合即整份不合格；全部符合才合格；
 * 标准写得无法比对（结果缺失或口径不清）的，挡回补数据，不让人工硬判。
 */
export function evaluateReport(row: EntryRow): ReportVerdict {
  const items = parseItems(row['检验项目'])
  const specs = splitClauses(row['标准规定'])
  const results = splitClauses(row['检验结果'])
  if (specs.length === 0 || results.length === 0) {
    return { verdict: '无法判定', clauses: [], message: '标准规定或检验结果缺失，无法判定，请补齐后再提交' }
  }
  const clauses = pairClauses(specs, results, items)
  if (clauses.some((c) => c.outcome === '不合格')) {
    const bad = clauses.filter((c) => c.outcome === '不合格').map((c) => c.spec)
    return { verdict: '不合格', clauses, message: `按标准规定判定不合格：${bad.join('；')}（以标准规定为准）` }
  }
  if (clauses.some((c) => c.outcome === '无法判定')) {
    return { verdict: '无法判定', clauses, message: '部分项目的标准规定与检验结果无法按业务口径比对，请核对后重填' }
  }
  return { verdict: '合格', clauses, message: '按标准规定判定合格' }
}
