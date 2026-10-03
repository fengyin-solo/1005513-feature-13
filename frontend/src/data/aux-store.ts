// 业务台账类数据（不随业务行播种）的本地持久化：目前只放成品检验的分册打包台账。

const AUX_STORAGE_KEY = 'pharma-cleanroom:aux'

export type PackageEntryRecord = {
  rowId: number
  baseNo: string
  product: string
  batchNo: string
  round: string
}

export type PackageLedgerItem = {
  batchId: string
  periodStart: string
  periodEnd: string
  packagedAt: string
  zipName: string
  /** 本次实际新入包的报告行。 */
  entries: PackageEntryRecord[]
}

type AuxState = {
  finishedqcPackages: PackageLedgerItem[]
}

const EMPTY: AuxState = { finishedqcPackages: [] }

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function readAux(): AuxState {
  if (typeof window === 'undefined' || !window.localStorage) {
    return clone(EMPTY)
  }
  const raw = window.localStorage.getItem(AUX_STORAGE_KEY)
  if (!raw) {
    return clone(EMPTY)
  }
  try {
    return { ...clone(EMPTY), ...(JSON.parse(raw) as Partial<AuxState>) }
  } catch {
    return clone(EMPTY)
  }
}

let cache: AuxState | null = null

function state(): AuxState {
  if (cache === null) {
    cache = readAux()
  }
  return cache
}

function persist(): void {
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(AUX_STORAGE_KEY, JSON.stringify(state()))
  }
}

export function listPackages(): PackageLedgerItem[] {
  return state().finishedqcPackages
}

export function appendPackage(item: PackageLedgerItem): void {
  state().finishedqcPackages = [item, ...state().finishedqcPackages]
  persist()
}

/** 哪些报告行已经打进过包（同一份报告重复打包只算一次）。 */
export function packagedRowIds(): Set<number> {
  const ids = new Set<number>()
  for (const item of state().finishedqcPackages) {
    for (const entry of item.entries) {
      ids.add(entry.rowId)
    }
  }
  return ids
}

export function clearPackages(): void {
  state().finishedqcPackages = []
  persist()
}
