import { writeFileSync } from 'node:fs'

const store: Record<string, string> = {}
;(globalThis as any).window = {
  localStorage: {
    getItem: (k: string) => (k in store ? store[k] : null),
    setItem: (k: string, v: string) => { store[k] = v },
    removeItem: (k: string) => { delete store[k] },
  },
}
;(globalThis as any).localStorage = (globalThis as any).window.localStorage

const qc = await import('../src/api/qc-service')
const result = qc.exportPeriodPacks('2026-10')
// Blob 在 Node 20 是全局类；取出字节
const buffer = Buffer.from(await result.blob!.arrayBuffer())
writeFileSync('tests/out-2026-10.zip', buffer)
console.log('wrote tests/out-2026-10.zip', buffer.length, 'bytes')
console.log(result.message)
