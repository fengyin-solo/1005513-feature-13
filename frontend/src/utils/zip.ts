/**
 * 零依赖 ZIP 打包：STORE（不压缩）+ CRC32，文件名走 UTF-8 标志位，Excel/资源管理器都能认出中文。
 * 纯前端没有后端，按产品拆出来的多个文件要一次下载外发，直接在浏览器里组一个 zip。
 */

export type ZipEntry = {
  path: string
  content: Uint8Array
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let i = 0; i < 256; i += 1) {
    let crc = i
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1
    }
    table[i] = crc >>> 0
  }
  return table
})()

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (let i = 0; i < bytes.length; i += 1) {
    crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

const encoder = new TextEncoder()

function u16(value: number): number[] {
  return [value & 0xff, (value >>> 8) & 0xff]
}

function u32(value: number): number[] {
  return [value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff]
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

export function buildZip(entries: ZipEntry[]): Uint8Array {
  const localChunks: Uint8Array[] = []
  const centralChunks: Uint8Array[] = []
  let offset = 0

  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.path)
    const data = entry.content
    const crc = crc32(data)
    const flags = 0x0800 // bit 11：文件名与注释按 UTF-8 解析

    const localHeader = new Uint8Array([
      ...u32(0x04034b50), // 本地文件头签名
      ...u16(20), // 解压所需版本
      ...u16(flags),
      ...u16(0), // 压缩方式 0 = STORE
      ...u16(0), // 修改时间
      ...u16(0), // 修改日期
      ...u32(crc),
      ...u32(data.length), // 压缩后大小
      ...u32(data.length), // 原始大小
      ...u16(nameBytes.length),
      ...u16(0), // 额外字段长度
    ])
    localChunks.push(localHeader, nameBytes, data)

    const central = new Uint8Array([
      ...u32(0x02014b50), // 中央目录签名
      ...u16(20), // 制作版本
      ...u16(20), // 解压版本
      ...u16(flags),
      ...u16(0),
      ...u16(0),
      ...u16(0),
      ...u32(crc),
      ...u32(data.length),
      ...u32(data.length),
      ...u16(nameBytes.length),
      ...u16(0), // 额外字段
      ...u16(0), // 注释
      ...u16(0), // 盘号
      ...u16(0), // 内部属性
      ...u32(0), // 外部属性
      ...u32(offset), // 本地文件头偏移
    ])
    centralChunks.push(central, nameBytes)

    offset += localHeader.length + nameBytes.length + data.length
  }

  const localPart = concat(localChunks)
  const centralPart = concat(centralChunks)
  const end = new Uint8Array([
    ...u32(0x06054b50), // EOCD 签名
    ...u16(0),
    ...u16(0),
    ...u16(entries.length),
    ...u16(entries.length),
    ...u32(centralPart.length),
    ...u32(localPart.length),
    ...u16(0),
  ])
  return concat([localPart, centralPart, end])
}
