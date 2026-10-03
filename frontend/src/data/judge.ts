/**
 * 判定口径：检验结果与标准规定谁说了算，先按业务定，再做判定。
 * - standard：标准规定说了算，检验结果逐项与标准比对（数值限度 / 区间 / 定性）。
 * - result：检验结果说了算，检验结果必须写明判定性结论（符合规定 / 不符合规定 等）。
 * 口径在业务设置里选定并持久化，未按当前业务口径给出结论的一律先挡回，不替业务拍板。
 */

export type JudgeMode = 'standard' | 'result'

export type VerdictLevel = '合格' | '不合格' | '无法判定'

export type ItemVerdict = {
  item: string
  standard: string
  result: string
  verdict: VerdictLevel
  reason: string
}

const PASS_WORDS = ['符合规定', '符合要求', '合格', '正常', '未检出', '无菌生长', '一致', '符合']
// 否定式措辞要先于肯定式判断，否则「未检出」会被里面的「检出」误判；这里单独留兜底词
const FAIL_WORDS = ['不符合规定', '不符合要求', '不合格', '不符合', '异常', '有菌生长', '超限', '超标']
const FAIL_TAIL_WORDS = ['检出']
const INCONCLUSIVE_WORDS = ['无法判定', '待定']

/** 定性结论识别：先否定式，再肯定式（避免「未检出」撞上「检出」）。 */
function qualitativeVerdict(result: string): VerdictLevel | null {
  if (INCONCLUSIVE_WORDS.some((word) => result.includes(word))) {
    return '无法判定'
  }
  if (FAIL_WORDS.some((word) => result.includes(word))) {
    return '不合格'
  }
  if (PASS_WORDS.some((word) => result.includes(word))) {
    return '合格'
  }
  if (FAIL_TAIL_WORDS.some((word) => result.includes(word))) {
    return '不合格'
  }
  return null
}

function extractNumber(text: string): number | null {
  const match = text.replace(/,/g, '').match(/-?\d+(?:\.\d+)?/)
  return match ? Number(match[0]) : null
}

function extractRange(text: string): [number, number] | null {
  // 4.5～7.0 / 95.0%～105.0% / 1～10，兼容 ~、至、—、-
  const match = text.replace(/,/g, '').match(/(-?\d+(?:\.\d+)?)\s*(?:～|~|至|—|–|-)\s*(-?\d+(?:\.\d+)?)/)
  if (!match) {
    return null
  }
  const low = Number(match[1])
  const high = Number(match[2])
  return low <= high ? [low, high] : [high, low]
}

function evaluateByStandard(standard: string, result: string): { verdict: VerdictLevel; reason: string } {
  const value = extractNumber(result)

  // 限度 ±5%：取结果绝对值与限度比
  const tolerance = standard.match(/[±正负]\s*(\d+(?:\.\d+)?)\s*%?/)
  if (tolerance) {
    const limit = Number(tolerance[1])
    if (value === null) {
      return { verdict: '无法判定', reason: '标准为限度 ±值，但检验结果里读不到数值' }
    }
    return Math.abs(value) <= limit
      ? { verdict: '合格', reason: `|${value}| ≤ ${limit}，符合标准规定` }
      : { verdict: '不合格', reason: `|${value}| > ${limit}，超出标准限度` }
  }

  // 区间：4.5～7.0
  const range = extractRange(standard)
  if (range && /[～~至—–]/.test(standard)) {
    if (value === null) {
      return { verdict: '无法判定', reason: '标准为区间要求，但检验结果里读不到数值' }
    }
    return value >= range[0] && value <= range[1]
      ? { verdict: '合格', reason: `${value} 落在 ${range[0]}～${range[1]} 内` }
      : { verdict: '不合格', reason: `${value} 不在 ${range[0]}～${range[1]} 区间内` }
  }

  // 上限：不得过 / 不得超过 / 小于 / 低于
  const upperLimit = standard.match(/(?:不得过|不得超过|不超过|小于|低于|≤|<=)\s*(\d+(?:\.\d+)?)/)
  if (upperLimit) {
    const limit = Number(upperLimit[1])
    if (value === null) {
      return { verdict: '无法判定', reason: '标准为上限要求，但检验结果里读不到数值' }
    }
    const strict = /小于|低于/.test(standard)
    const passed = strict ? value < limit : value <= limit
    return passed
      ? { verdict: '合格', reason: `${value} ${strict ? '<' : '≤'} ${limit}` }
      : { verdict: '不合格', reason: `${value} ${strict ? '不小于' : '>'} ${limit}，超出标准限度` }
  }

  // 下限：不得少于 / 大于 / 高于
  const lowerLimit = standard.match(/(?:不得少于|不得低于|不少于|大于|高于|≥|>=)\s*(\d+(?:\.\d+)?)/)
  if (lowerLimit) {
    const limit = Number(lowerLimit[1])
    if (value === null) {
      return { verdict: '无法判定', reason: '标准为下限要求，但检验结果里读不到数值' }
    }
    const strict = /大于|高于/.test(standard)
    const passed = strict ? value > limit : value >= limit
    return passed
      ? { verdict: '合格', reason: `${value} ${strict ? '>' : '≥'} ${limit}` }
      : { verdict: '不合格', reason: `${value} 未达到标准限度 ${limit}` }
  }

  // 定性标准（应符合规定 / 应无菌生长 / 应为白色或类白色…）：看结果里的判定性措辞
  const qualitative = qualitativeVerdict(result)
  if (qualitative === '不合格') {
    return { verdict: '不合格', reason: '检验结果写明不符合/异常，按标准规定判定不合格' }
  }
  if (qualitative === '合格') {
    return { verdict: '合格', reason: '检验结果写明符合规定' }
  }
  // 标准描述了应有性状，结果给出具体观察值时，按是否出现否定词判断
  if (/[是为]/.test(standard) && value === null && result.trim() !== '') {
    return { verdict: '合格', reason: '检验结果描述与标准规定一致，未出现不符合表述' }
  }
  return { verdict: '无法判定', reason: '数值与定性措辞都读不出来，需人工复核后再判' }
}

function evaluateByResult(result: string): { verdict: VerdictLevel; reason: string } {
  const qualitative = qualitativeVerdict(result)
  if (qualitative === '无法判定') {
    return { verdict: '无法判定', reason: '检验结果自标“待定/无法判定”，不能出报告' }
  }
  if (qualitative === '不合格') {
    return { verdict: '不合格', reason: '按业务口径以检验结果为准：结果写明不符合' }
  }
  if (qualitative === '合格') {
    return { verdict: '合格', reason: '按业务口径以检验结果为准：结果写明符合规定' }
  }
  return {
    verdict: '无法判定',
    reason: '当前业务口径以检验结果为准，检验结果必须写明“符合规定/不符合规定”等判定性结论',
  }
}

export function evaluateItem(item: string, standard: string, result: string, mode: JudgeMode): ItemVerdict {
  const outcome =
    mode === 'standard' ? evaluateByStandard(standard, result) : evaluateByResult(result)
  return { item, standard, result, ...outcome }
}

export type ReportEvaluation = {
  conclusion: '合格' | '不合格' | null
  verdicts: ItemVerdict[]
  blockedReason: string | null
}

export function evaluateReport(
  items: { item: string; standard: string; result: string }[],
  mode: JudgeMode,
): ReportEvaluation {
  const verdicts = items.map((entry) =>
    evaluateItem(entry.item, entry.standard, entry.result, mode),
  )
  const pending = verdicts.filter((v) => v.verdict === '无法判定')
  if (pending.length > 0) {
    return {
      conclusion: null,
      verdicts,
      blockedReason: `${pending.map((v) => `「${v.item}」${v.reason}`).join('；')}，补齐后再判`,
    }
  }
  const failed = verdicts.filter((v) => v.verdict === '不合格')
  return {
    conclusion: failed.length > 0 ? '不合格' : '合格',
    verdicts,
    blockedReason: null,
  }
}

export const JUDGE_MODE_LABEL: Record<JudgeMode, string> = {
  standard: '标准规定说了算（检验结果逐项比对标准）',
  result: '检验结果说了算（结果须写明判定性结论）',
}
