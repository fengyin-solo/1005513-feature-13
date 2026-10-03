// 纯 Node 冒烟：桩掉浏览器 API 后验证成品检验核心规则。
// 运行：npx esbuild tests/smoke.ts --bundle --platform=node --format=esm --outfile=tests/smoke.mjs && node tests/smoke.mjs

const store: Record<string, string> = {}
;(globalThis as any).window = {
  localStorage: {
    getItem: (k: string) => (k in store ? store[k] : null),
    setItem: (k: string, v: string) => { store[k] = v },
    removeItem: (k: string) => { delete store[k] },
  },
}
;(globalThis as any).localStorage = (globalThis as any).window.localStorage

let pass = 0
let fail = 0
function check(name: string, condition: boolean, detail = '') {
  if (condition) {
    pass += 1
    console.log(`  ✓ ${name}`)
  } else {
    fail += 1
    console.error(`  ✗ ${name} ${detail}`)
  }
}

const {
  createReport,
  executeAction,
  listReports,
  normalizeDraftItems,
  previewPacks,
  exportPeriodPacks,
  listLedger,
  nextActions,
  updateReportItems,
  listRetainTodos,
  getJudgeMode,
  setJudgeMode,
} = await import('../src/api/qc-service')
const { __resetQcForTest } = await import('../src/data/qc-store')
const { resolveItemName } = await import('../src/data/catalog')

__resetQcForTest()

console.log('1) 检验项目归一：多处取到属于同一套')
check('pH / PH值 / 酸碱度 归一到 pH值', resolveItemName('PH值') === 'pH值' && resolveItemName('酸碱度') === 'pH值' && resolveItemName('pH') === 'pH值')
check('别名 外观性状 归一到 性状', resolveItemName('外观性状') === '性状')
check('目录外非法值返回 null', resolveItemName('随便编的项目') === null)
{
  const r = normalizeDraftItems([
    { item: 'pH值', standard: '4.5～7.0', result: '5.0，符合规定' },
    { item: '酸碱度', standard: '4.5～7.0', result: '5.1，符合规定' },
    { item: '水分', standard: '不得过 3.0%', result: '1.2%' },
    { item: '不存在的项目', standard: 'x', result: 'y' },
  ])
  check('重复项归并为一条（同一套）', r.items.length === 2, `实际 ${r.items.length}`)
  check('归并后取最后一条非空结果', r.items.find((i) => i.item === 'pH值')?.result.includes('5.1'))
  check('记录了归一映射', r.normalized.some((n) => n.from === '酸碱度' && n.to === 'pH值'))
  check('非法值打回错误', r.errors.some((e) => e.includes('非法值')))
}

console.log('2) 登记非法项目 → 整份打回')
{
  const r = createReport({
    reportNo: 'QC-TEST-01', product: '葡萄糖注射液', batchNo: 'T-01', reportDate: '2026-10-03',
    items: [{ item: '瞎写', standard: '', result: '' }],
  })
  check('非法项目登记失败', !r.ok && r.message.includes('非法值'))
  const r2 = createReport({
    reportNo: 'QC-TEST-02', product: '不存在的产品', batchNo: 'T-02', reportDate: '2026-10-03',
    items: [{ item: '性状', standard: '', result: '' }],
  })
  check('目录外产品打回', !r2.ok && r2.message.includes('产品目录'))
}

console.log('3) 状态逐级推进，跳级挡回')
{
  const created = createReport({
    reportNo: 'QC-FLOW-01', product: '葡萄糖注射液', batchNo: 'F-01', reportDate: '2026-10-03',
    items: [{ item: '性状', standard: '应符合规定', result: '' }],
  })
  const id = created.report!.id
  check('待检验只能开始检验', nextActions('待检验').join() === '开始检验')
  const skip = executeAction(id, '录入完成送判定')
  check('待检验直接送判定被挡回', !skip.ok && skip.message.includes('一步步往前推'), skip.message)
  check('开始检验通过', executeAction(id, '开始检验').ok)
  const missing = executeAction(id, '录入完成送判定')
  check('结果未录完送判定被挡回', !missing.ok && missing.message.includes('未录入'), missing.message)
  check('录入结果保存', updateReportItems(id, [{ item: '性状', standard: '应符合规定', result: '符合规定' }]).ok)
  check('送判定通过', executeAction(id, '录入完成送判定').ok)
  const signEarly = executeAction(id, '检验人签字', '张三')
  check('待判定直接签字（跳级）被挡回', !signEarly.ok && signEarly.message.includes('一步步往前推'))
}

console.log('4) 判定口径：先按业务定（默认标准规定说了算）')
{
  check('默认 standard 口径', getJudgeMode() === 'standard')
  const created = createReport({
    reportNo: 'QC-JUDGE-01', product: '葡萄糖注射液', batchNo: 'J-01', reportDate: '2026-10-03',
    items: [
      { item: 'pH值', standard: '4.5～7.0', result: '8.2' },
      { item: '性状', standard: '应符合规定', result: '符合规定' },
    ],
  })
  const id = created.report!.id
  executeAction(id, '开始检验')
  executeAction(id, '录入完成送判定')
  const judged = executeAction(id, '执行判定')
  check('pH 8.2 超区间 → 不合格', judged.ok && judged.evaluation?.conclusion === '不合格', judged.message)
  check('进入待签字', listReports().find((r) => r.id === id)?.status === '待签字')

  // 换成"检验结果说了算"：只写数值没有判定性措辞 → 挡回
  setJudgeMode('result')
  check('已切到 result 口径', getJudgeMode() === 'result')
  const created2 = createReport({
    reportNo: 'QC-JUDGE-02', product: '维生素C片', batchNo: 'J-02', reportDate: '2026-10-03',
    items: [{ item: '水分', standard: '不得过 3.0%', result: '2.5%' }],
  })
  const id2 = created2.report!.id
  executeAction(id2, '开始检验')
  executeAction(id2, '录入完成送判定')
  const blocked = executeAction(id2, '执行判定')
  check('结果口径下无数值结论措辞 → 挡回', !blocked.ok && blocked.message.includes('判定性结论'), blocked.message)
  check('判定挡回后可退回补录', executeAction(id2, '退回补录结果').ok)
  updateReportItems(id2, [{ item: '水分', standard: '不得过 3.0%', result: '2.5%，符合规定' }])
  check('补录后重新送判定', executeAction(id2, '录入完成送判定').ok)
  const passed = executeAction(id2, '执行判定')
  check('结果写明符合规定 → 合格', passed.evaluation?.conclusion === '合格')
  setJudgeMode('standard')
}

console.log('5) 复检另开一栏 + 签字后才签发')
{
  const created = createReport({
    reportNo: 'QC-REIN-01', product: '氯化钠注射液', batchNo: 'R-01', reportDate: '2026-10-03',
    items: [
      { item: 'pH值', standard: '4.5～7.0', result: '7.8' },
      { item: '性状', standard: '应符合规定', result: '符合规定' },
    ],
  })
  const id = created.report!.id
  executeAction(id, '开始检验')
  executeAction(id, '录入完成送判定')
  executeAction(id, '执行判定')
  const noSign = executeAction(id, '检验人签字', '')
  check('不签字不能签发', !noSign.ok && noSign.message.includes('签字'))
  executeAction(id, '判定不合格转复检')
  const missingRe = executeAction(id, '复检完成再判定')
  check('复检结果没录不能再判', !missingRe.ok && missingRe.ok !== true && missingRe.message.includes('复检结果'))
  updateReportItems(id, [
    { item: 'pH值', standard: '4.5～7.0', result: '7.8', reinspectResult: '5.2，符合规定' },
    { item: '性状', standard: '应符合规定', result: '符合规定', reinspectResult: '' },
  ])
  const rejudged = executeAction(id, '复检完成再判定')
  check('复检合格翻案', rejudged.evaluation?.conclusion === '合格', rejudged.message)
  const signed = executeAction(id, '检验人签字', '王雅琴')
  check('签字后签发', signed.ok && listReports().find((r) => r.id === id)?.status === '已签发')
  const report = listReports().find((r) => r.id === id)!
  check('复检结果保留在另栏', report.items.find((i) => i.item === 'pH值')?.reinspectResult.includes('5.2'))
}

console.log('6) 结果回写留样待办（幂等）')
{
  const todos = listRetainTodos()
  check('判定后生成留样待办', todos.some((t) => t.reportNo === 'QC-JUDGE-01'))
  const todoCount = listRetainTodos().length
  // 同一份报告重新判定（再走一次）不新增待办：通过复检再判覆盖
  const before = listRetainTodos(true).filter((t) => t.reportNo === 'QC-REIN-01').length
  check('同一检验编号待办只有一条', before === 1, `实际 ${before}`)
  void todoCount
}

console.log('7) 按产品拆包：分册 + 无报告说明 + 重复打包只算一次')
{
  const created = createReport({
    reportNo: 'QC-PACK-01', product: '维生素C片', batchNo: 'PK-01', reportDate: '2026-10-03',
    items: [{ item: '性状', standard: '应符合规定', result: '符合规定' }],
  })
  const id = created.report!.id
  executeAction(id, '开始检验')
  executeAction(id, '录入完成送判定')
  executeAction(id, '执行判定')
  executeAction(id, '检验人签字', '李志强')

  const preview = previewPacks('2026-10')
  check('已签发报告按产品×日期分组', preview.packs.length >= 4, `包数 ${preview.packs.length}`)
  const vcPack = preview.packs.find((p) => p.product === '维生素C片' && p.reportDate === '2026-10-03')
  check('维C 10-03 包含新报告 QC-PACK-01', vcPack?.reports.some((r) => r.reportNo === 'QC-PACK-01') ?? false)
  check('无报告产品给说明（布洛芬/阿莫西林至少其一）', preview.noReportProducts.includes('布洛芬缓释胶囊') || preview.noReportProducts.includes('阿莫西林胶囊'), `无报告: ${preview.noReportProducts.join('、')}`)
  const first = exportPeriodPacks('2026-10')
  check('首次导出 zip 生成', first.ok && first.blob!.size > 1000, first.message)
  const ledgerAfterFirst = listLedger()
  const known = ledgerAfterFirst.filter((e) => ['QC-PACK-01', 'QC-20261001'].includes(e.reportNo)).length
  check('台账记录新打包报告', known === 2, `台账 ${known}`)
  const second = exportPeriodPacks('2026-10')
  check('重复打包新计为 0', second.newCount === 0, `新计 ${second.newCount}`)
  check('台账条数不增加', listLedger().length === ledgerAfterFirst.length)

  const sepPreview = previewPacks('2026-09')
  check('9 月周期只含 9 月报告', sepPreview.packs.every((p) => p.reportDate.startsWith('2026-09')))
  check('9 月无报告产品也附说明', sepPreview.noReportProducts.length >= 5)
}

console.log('')
console.log(`结果：${pass} 通过，${fail} 失败`)
if (fail > 0) process.exit(1)
