/**
 * 成品检验主数据：产品目录 + 检验项目目录（含别名）。
 * 检验项目在各模块、各登记入口多处取到，都归一到同一份标准目录，
 * 填进来的名称命中不了标准项（含别名）时，视为非法值打回重填。
 */

export type CatalogItem = {
  /** 标准项目名称，登记、判定、分册都以它为准 */
  name: string
  /** 默认标准规定，登记时自动带出，可按批修改 */
  defaultStandard: string
  /** 各处可能填到的不同写法，命中任意一个都归一到标准项 */
  aliases: string[]
}

export const PRODUCTS: string[] = [
  '注射用头孢曲松钠',
  '葡萄糖注射液',
  '氯化钠注射液',
  '维生素C片',
  '布洛芬缓释胶囊',
  '阿莫西林胶囊',
]

export const INSPECTION_ITEMS: CatalogItem[] = [
  {
    name: '性状',
    defaultStandard: '应为白色或类白色结晶性粉末',
    aliases: ['外观', '外观性状', '色泽'],
  },
  {
    name: '鉴别',
    defaultStandard: '应符合规定',
    aliases: ['鉴别试验', '鉴别反应'],
  },
  {
    name: '装量差异',
    defaultStandard: '限度 ±5%',
    aliases: ['装量', '重量差异', '含量差异'],
  },
  {
    name: 'pH值',
    defaultStandard: '4.5～7.0',
    aliases: ['pH', '酸碱度', 'PH值', 'ph'],
  },
  {
    name: '水分',
    defaultStandard: '不得过 3.0%',
    aliases: ['水份', '干燥失重', '含水量'],
  },
  {
    name: '有关物质',
    defaultStandard: '总杂质不得过 1.0%',
    aliases: ['杂质', '相关物质', '有关物质检查'],
  },
  {
    name: '含量测定',
    defaultStandard: '应为标示量的 95.0%～105.0%',
    aliases: ['含量', '主成分含量', '效价测定', 'assay'],
  },
  {
    name: '细菌内毒素',
    defaultStandard: '应小于 0.50 EU/mg',
    aliases: ['内毒素', 'BET', '热原'],
  },
  {
    name: '无菌',
    defaultStandard: '应无菌生长',
    aliases: ['无菌检查', '无菌试验'],
  },
  {
    name: '可见异物',
    defaultStandard: '应符合规定',
    aliases: ['异物', '澄清度', '不溶性微粒'],
  },
]

function normalizeKey(value: string): string {
  // 归一规则：去空白、全角转半角、英文小写，让「pH值 / PH值 / ph / pH」落到同一套
  return value
    .replace(/　/g, ' ')
    .trim()
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .toLowerCase()
}

const ITEM_INDEX: { key: string; item: CatalogItem }[] = INSPECTION_ITEMS.flatMap((item) =>
  [item.name, ...item.aliases].map((name) => ({ key: normalizeKey(name), item })),
)

/** 把各处填到的项目名称归一到标准项目；查不到返回 null（调用方按非法值打回）。 */
export function resolveItemName(raw: string): string | null {
  const key = normalizeKey(raw)
  if (!key) {
    return null
  }
  const hit = ITEM_INDEX.find((entry) => entry.key === key)
  return hit ? hit.item.name : null
}

export function isKnownProduct(raw: string): boolean {
  const key = normalizeKey(raw)
  return PRODUCTS.some((name) => normalizeKey(name) === key)
}

export function findItem(name: string): CatalogItem | undefined {
  return INSPECTION_ITEMS.find((item) => item.name === name)
}
