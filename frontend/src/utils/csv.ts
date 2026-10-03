// 清单/分册导出统一走这里：带 BOM 的 CRLF CSV，Excel 打开中文不乱码，特殊字符正确转义。

export function csvCell(value: unknown): string {
  const text = String(value ?? '')
  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`
  }
  return text
}

export function toCsv(rows: unknown[][]): string {
  return `﻿${rows.map((row) => row.map(csvCell).join(',')).join('\r\n')}`
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

/** 文件名/目录名里不允许的字符统一替换，保证各操作系统都能解压。 */
export function safeName(name: string): string {
  return String(name ?? '')
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ')
    .trim() || '未命名'
}
