/**
 * 最小 ZIP 写出器（不压缩，method=0）：仅依赖浏览器 TextEncoder，无需第三方库。
 * 每个条目带 UTF-8 标志位（bit 11），中文文件名在系统解压工具里不乱码。
 */

export type ZipEntry = {
  path: string
  content: string
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    }
    table[n] = c >>> 0
  }
  return table
})()

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

const encoder = new TextEncoder()

function u16(view: DataView, offset: number, value: number): void {
  view.setUint16(offset, value, true)
}

function u32(view: DataView, offset: number, value: number): void {
  view.setUint32(offset, value >>> 0, true)
}

export function buildZip(entries: ZipEntry[]): Blob {
  type Prepared = {
    nameBytes: Uint8Array
    dataBytes: Uint8Array
    crc: number
    localOffset: number
  }
  const prepared: Prepared[] = []
  const localParts: Uint8Array[] = []
  let offset = 0

  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.path)
    const dataBytes = encoder.encode(entry.content)
    const header = new ArrayBuffer(30)
    const view = new DataView(header)
    u32(view, 0, 0x04034b50) // 本地文件头签名
    u16(view, 4, 20) // 解压版本
    u16(view, 6, 0x0800) // UTF-8 文件名标志
    u16(view, 8, 0) // 不压缩
    u16(view, 10, 0) // 修改时间
    u16(view, 12, 0x21) // 修改日期（1980-01-01 占位）
    u32(view, 14, crc32(dataBytes))
    u32(view, 18, dataBytes.length)
    u32(view, 22, dataBytes.length)
    u16(view, 26, nameBytes.length)
    u16(view, 28, 0)
    const headerBytes = new Uint8Array(header)
    localParts.push(headerBytes, nameBytes, dataBytes)
    prepared.push({ nameBytes, dataBytes, crc: crc32(dataBytes), localOffset: offset })
    offset += headerBytes.length + nameBytes.length + dataBytes.length
  }

  const centralParts: Uint8Array[] = []
  let centralSize = 0
  for (const item of prepared) {
    const record = new ArrayBuffer(46)
    const view = new DataView(record)
    u32(view, 0, 0x02014b50) // 中央目录签名
    u16(view, 4, 20) // 制作版本
    u16(view, 6, 20) // 解压版本
    u16(view, 8, 0x0800)
    u16(view, 10, 0)
    u16(view, 12, 0)
    u16(view, 14, 0x21)
    u32(view, 16, item.crc)
    u32(view, 20, item.dataBytes.length)
    u32(view, 24, item.dataBytes.length)
    u16(view, 28, item.nameBytes.length)
    u16(view, 30, 0)
    u16(view, 32, 0)
    u16(view, 34, 0)
    u16(view, 36, 0)
    u32(view, 38, 0)
    u32(view, 42, item.localOffset)
    const recordBytes = new Uint8Array(record)
    centralParts.push(recordBytes, item.nameBytes)
    centralSize += recordBytes.length + item.nameBytes.length
  }

  const eocd = new ArrayBuffer(22)
  const eocdView = new DataView(eocd)
  u32(eocdView, 0, 0x06054b50)
  u16(eocdView, 8, prepared.length)
  u16(eocdView, 10, prepared.length)
  u32(eocdView, 12, centralSize)
  u32(eocdView, 16, offset)
  u16(eocdView, 20, 0)

  return new Blob(
    [...localParts, ...centralParts, new Uint8Array(eocd)].map((part) =>
      part.buffer instanceof ArrayBuffer && part.byteOffset === 0 && part.byteLength === part.buffer.byteLength
        ? part.buffer
        : new Uint8Array(part).slice().buffer,
    ),
    {
      type: 'application/zip',
    },
  )
}
