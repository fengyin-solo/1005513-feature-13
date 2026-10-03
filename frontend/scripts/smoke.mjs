// 业务规则冒烟测试：node scripts/smoke.mjs。用 esbuild 即时转译 TS，打桩浏览器存储。
import { build } from 'esbuild'
import { writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const storage = new Map()
globalThis.window = {
  localStorage: {
    getItem: (k) => (storage.has(k) ? storage.get(k) : null),
    setItem: (k, v) => storage.set(k, String(v)),
    removeItem: (k) => storage.delete(k),
  },
}
let downloadCalled = false
globalThis.Blob = class Blob {
  constructor(parts, opts) {
    this.parts = parts
    this.type = opts?.type ?? ''
    this.size = parts.reduce((n, p) => n + (p.byteLength ?? p.length ?? 0), 0)
  }
}
globalThis.URL = { createObjectURL: () => 'blob:stub', revokeObjectURL: () => {} }
globalThis.document = {
  createElement: () => ({ click: () => (downloadCalled = true), set href(_) {}, set download(_) {} }),
  body: { appendChild: () => {}, removeChild: () => {} },
}

const result = await build({
  entryPoints: ['src/smoke-entry.ts'],
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node',
  alias: { '@': join(process.cwd(), 'src') },
})
const dir = mkdtempSync(join(tmpdir(), 'qc-smoke-'))
const file = join(dir, 'smoke.mjs')
writeFileSync(file, result.outputFiles[0].text)
const smoke = await import(pathToFileURL(file).href)

const cases = smoke.default
let passed = 0
for (const test of cases) {
  try {
    test.run()
    console.log(`PASS  ${test.name}`)
    passed += 1
  } catch (error) {
    console.error(`FAIL  ${test.name}`)
    console.error(String(error?.stack ?? error))
    process.exitCode = 1
  }
}
console.log(`\n${passed}/${cases.length} passed；下载动作触发：${downloadCalled}`)
