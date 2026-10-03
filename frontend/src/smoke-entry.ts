import assert from 'node:assert/strict'

import { resetRows, listRows, saveRows } from '@/data/local-store'
import { clearPackages } from '@/data/aux-store'
import { actionAllowed, runAction } from '@/api/local-service'
import { MODULE_BY_KEY } from '@/data/modules'
import { evaluateReport, mergeReportItems, parseItems, validateItems } from '@/api/qc-rules'
import {
  baseReportNo,
  buildPackagePlan,
  createReport,
  judgeReport,
  packageReports,
  renderProductBooklet,
  signReport,
  startReinspection,
} from '@/api/qc-service'

const QC = 'finishedqc'
const RETAIN = 'retainsample'

function reset() {
  resetRows(QC)
  resetRows(RETAIN)
  clearPackages()
}

const period = { start: '2026-09-01', end: '2026-09-30' }

export default [
  {
    name: '种子场景：布洛芬初检含量偏低且有关物质超限，整体判不合格',
    run() {
      reset()
      const row = listRows(QC).find((r) => r['检验编号'] === 'FINI-2609-02')!
      const verdict = evaluateReport(row)
      assert.equal(verdict.verdict, '不合格', verdict.message)
      // 复检行复测内容全部符合 → 复检合格
      const reRow = listRows(QC).find((r) => r['检验编号'] === 'FINI-2609-02-R2')!
      assert.equal(evaluateReport(reRow).verdict, '合格')
      // 阿莫西林种子行：8 项全部符合
      const amx = listRows(QC).find((r) => r['检验编号'] === 'FINI-2609-01')!
      assert.equal(evaluateReport(amx).verdict, '合格', evaluateReport(amx).message)
    },
  },
  {
    name: '检验项目多处取值归并为同一套：拆分、去重并按法定顺序排列',
    run() {
      assert.deepEqual(parseItems('含量测定；性状\n含量测定；、'), ['含量测定', '性状'])
      const merged = mergeReportItems([
        { 检验项目: '性状；含量测定' },
        { 检验项目: '微生物限度；性状' },
      ] as never[])
      assert.deepEqual(merged, ['性状', '含量测定', '微生物限度'])
    },
  },
  {
    name: '检验项目填成非法值：登记打回重填，空项目同样打回',
    run() {
      reset()
      const bad = createReport({
        检验编号: 'FINI-X-1',
        产品名称: '测试片',
        产品批号: 'T-1',
        报告日期: '2026-09-15',
        检验项目: '含量测定；编外项目',
        标准规定: '应为标示量的95.0%~105.0%',
        检验结果: '标示量的99.0%',
      })
      assert.equal(bad.ok, false)
      assert.match(bad.message, /编外项目/)
      assert.equal(validateItems('').ok, false)
      // 打回后库里不应落数据
      assert.equal(listRows(QC).some((r) => r['检验编号'] === 'FINI-X-1'), false)
      const dup = createReport({
        检验编号: 'FINI-2609-01',
        产品名称: 'x',
        产品批号: 'x',
        报告日期: '2026-09-15',
        检验项目: '性状',
        标准规定: '应符合规定',
        检验结果: '符合规定',
      })
      assert.equal(dup.ok, false)
      assert.match(dup.message, /已存在/)
    },
  },
  {
    name: '标准规定说了算：结果越限时人工判合格被挡，只能按标准判不合格',
    run() {
      reset()
      const created = createReport({
        检验编号: 'FINI-T-2',
        产品名称: '测试颗粒',
        产品批号: 'T-2',
        报告日期: '2026-09-16',
        检验项目: '水分',
        标准规定: '不得过14.0%',
        检验结果: '15.2%',
      })
      assert.equal(created.ok, true, created.message)
      const submit = runAction(QC, created.id!, '提交检验')
      assert.equal(submit.ok, true)
      const wantPass = judgeReport(created.id!, '合格')
      assert.equal(wantPass.ok, false)
      assert.match(wantPass.message, /以标准规定为准/)
      const fail = judgeReport(created.id!, '不合格')
      assert.equal(fail.ok, true)
      assert.equal(listRows(QC).find((r) => Number(r.id) === created.id)?.status, '不合格')
      // 范围与百分数归一化口径：0.992 与 95%~105% 同量级
      assert.equal(
        evaluateReport({
          检验项目: '含量测定',
          标准规定: '应为标示量的95.0%~105.0%',
          检验结果: '标示量的0.992',
        } as never).verdict,
        '合格',
      )
    },
  },
  {
    name: '状态只能一步步推进：通用状态机跳级挡回，分支动作按登记来源放行',
    run() {
      const batch = MODULE_BY_KEY.get('batchrecord')!
      assert.equal(actionAllowed(batch, '归档批记录', '待编制'), false)
      assert.equal(actionAllowed(batch, '归档批记录', '已复核'), true)
      const material = MODULE_BY_KEY.get('materialrelease')!
      assert.equal(actionAllowed(material, '冻结物料', '待放行'), true)
      assert.equal(actionAllowed(material, '冻结物料', '已放行'), false)
      const review = MODULE_BY_KEY.get('annualreview')!
      assert.equal(actionAllowed(review, '批准回顾', '待回顾'), false)
      assert.equal(actionAllowed(review, '批准回顾', '回顾中'), true)
      // 实物演练：检验中不能再「提交检验」（跳/重复都挡）
      reset()
      const probing = runAction(QC, 5, '提交检验')
      assert.equal(probing.ok, false)
    },
  },
  {
    name: '复检另开一栏：不合格后发起复检生成 -R2 复检记录，复检合格落到复检合格',
    run() {
      reset()
      const created = createReport({
        检验编号: 'FINI-T-3',
        产品名称: '测试胶囊',
        产品批号: 'T-3',
        报告日期: '2026-09-17',
        检验项目: '水分',
        标准规定: '不得过14.0%',
        检验结果: '15.8%',
      })
      runAction(QC, created.id!, '提交检验')
      assert.equal(judgeReport(created.id!, '不合格').ok, true)
      // 只有不合格能发起复检
      assert.equal(startReinspection(1).ok, false)
      const re = startReinspection(created.id!)
      assert.equal(re.ok, true, re.message)
      const reRow = listRows(QC).find((r) => Number(r.id) === re.id)!
      assert.equal(String(reRow['检验编号']), 'FINI-T-3-R2')
      assert.equal(reRow.status, '复检中')
      assert.equal(String(reRow['检验轮次']), '复检第1次')
      assert.equal(baseReportNo(String(reRow['检验编号'])), 'FINI-T-3')
      // 复检复测合格：改结果后判定，落到「复检合格」而不是「已合格」
      reRow['检验结果'] = '13.1%'
      saveRows(QC, listRows(QC).map((r) => (Number(r.id) === re.id ? reRow : r)))
      const verdict = judgeReport(re.id!, '合格')
      assert.equal(verdict.ok, true, verdict.message)
      assert.equal(listRows(QC).find((r) => Number(r.id) === re.id)?.status, '复检合格')
    },
  },
  {
    name: '检验人签字：未提交不能签，未签字的终态报告打包挡回，签后放行',
    run() {
      reset()
      const created = createReport({
        检验编号: 'FINI-T-4',
        产品名称: '测试片',
        产品批号: 'T-4',
        报告日期: '2026-09-17',
        检验项目: '性状',
        标准规定: '应为白色片',
        检验结果: '白色片',
      })
      assert.equal(signReport(created.id!, '张三').ok, false) // 待检验不能签
      assert.equal(signReport(999, '张三').ok, false) // 报告不存在
      // 种子数据里 FINI-2609-04（id=4）已合格但未签字
      const before = buildPackagePlan(period)
      assert.ok(before.unsigned.some((r) => r.baseNo === 'FINI-2609-04'))
      const blocked = packageReports(period)
      assert.equal(blocked.ok, false)
      assert.match(blocked.message, /签字/)
      const sign = signReport(4, '张三')
      assert.equal(sign.ok, true)
      assert.match(String(listRows(QC).find((r) => Number(r.id) === 4)?.['检验人签字']), /张三/)
      // 空签名也挡回
      assert.equal(signReport(created.id!, '  ').ok, false)
    },
  },
  {
    name: '按产品分册：初检/复检各一栏，四列齐全；无报告产品附说明不发空包',
    run() {
      reset()
      signReport(4, '张三')
      const plan = buildPackagePlan(period)
      const ibu = plan.ready.find((r) => r.baseNo === 'FINI-2609-02')!
      const booklet = renderProductBooklet('布洛芬片', [ibu])
      assert.equal(booklet.filename, '布洛芬片-2026-09-18.csv')
      assert.match(booklet.content, /【初次检验】/)
      assert.match(booklet.content, /【复检】/)
      assert.match(booklet.content, /FINI-2609-02-R2/)
      assert.match(booklet.content, /检验编号,检验项目,标准规定,检验结果,检验人签字/)
      // 当期产品名册含蒙脱石散（有批生产记录、无终态报告）→ 说明文件，不进空包
      assert.ok(plan.productsWithoutReport.includes('蒙脱石散'))
      assert.ok(!plan.productsWithoutReport.includes('阿莫西林胶囊'))
      // 期外报告（2026-08-25）不计入当期
      assert.ok(!plan.reports.some((r) => r.baseNo === 'FINI-2608-07'))
    },
  },
  {
    name: '出包下载：本次新计 3 份报告，蒙脱石散 1 份无报告说明',
    run() {
      reset()
      signReport(4, '张三')
      const packed = packageReports(period)
      assert.equal(packed.ok, true, packed.message)
      assert.equal(packed.included, 3)
      assert.equal(packed.duplicates, 0)
      assert.equal(packed.noteCount, 1)
      assert.match(packed.zipName!, /成品检验分册外发包-2026-09-01_2026-09-30.*\.zip/)
    },
  },
  {
    name: '同一份报告重复打包只算一次：第二次新计 0、重复 3',
    run() {
      reset()
      signReport(4, '张三')
      packageReports(period)
      const again = packageReports(period)
      assert.equal(again.ok, true)
      assert.equal(again.included, 0)
      assert.equal(again.duplicates, 3)
    },
  },
  {
    name: '检验结果回写留样管理待办：按批号命中、未销毁记录置待办',
    run() {
      reset()
      const created = createReport({
        检验编号: 'FINI-T-5',
        产品名称: '蒙脱石散',
        产品批号: 'MTS-260920',
        报告日期: '2026-09-26',
        检验项目: '水分',
        标准规定: '不得过10.0%',
        检验结果: '9.1%',
      })
      runAction(QC, created.id!, '提交检验')
      assert.equal(judgeReport(created.id!, '合格').ok, true)
      const retain = listRows(RETAIN).find((r) => r['对应批号'] === 'MTS-260920')!
      assert.match(String(retain['待办事项']), /FINI-T-5/)
      assert.match(String(retain['待办事项']), /合格，可安排放行留样/)
      assert.equal(retain.pending, true)
    },
  },
  {
    name: '同基础编号初复检回写不重复堆待办，只保留最新一条',
    run() {
      reset()
      // 种子 IBU-260905 留样已有一条待办；模拟再判一次复检合格，仍只有一条 FINI-2609-02
      const reRow = listRows(QC).find((r) => r['检验编号'] === 'FINI-2609-02-R2')!
      const rows = listRows(QC)
      saveRows(QC, rows.map((r) => (r === reRow ? { ...r, status: '复检中' } : r)))
      assert.equal(judgeReport(Number(reRow.id), '合格').ok, true)
      const todo = String(listRows(RETAIN).find((r) => r['对应批号'] === 'IBU-260905')?.['待办事项'] ?? '')
      assert.equal(todo.split('\n').filter((t) => t.includes('FINI-2609-02')).length, 1)
    },
  },
]
