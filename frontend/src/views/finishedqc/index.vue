<template>
  <section class="page" data-module="finishedqc">
    <header class="page-head">
      <div>
        <h2>成品检验管理</h2>
        <p class="page-desc">检验报告按产品分册：逐级推进状态、复检另开一栏、检验人签字后签发；按产品 × 出报告日拆包外发，结果回写留样待办。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记检验报告</button>
        <button class="btn" type="button" @click="packPanelOpen = !packPanelOpen">按产品拆包导出</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <section class="rule-box">
      <div class="rule-head">
        <strong>判定口径（业务先行）</strong>
        <button class="link" type="button" @click="rulePanelOpen = !rulePanelOpen">
          {{ rulePanelOpen ? '收起' : '设置' }}
        </button>
      </div>
      <p class="rule-current">当前：{{ JUDGE_MODE_LABEL[judgeMode] }}</p>
      <div v-if="rulePanelOpen" class="rule-options">
        <label v-for="option in judgeModeOptions" :key="option.value" class="rule-option">
          <input type="radio" name="judgeMode" :value="option.value" :checked="judgeMode === option.value" @change="changeJudgeMode(option.value)" />
          <span>
            <strong>{{ option.title }}</strong>
            <em>{{ option.desc }}</em>
          </span>
        </label>
      </div>
    </section>

    <form class="filter-bar" @submit.prevent="reload">
      <label class="filter-item">
        <span>产品</span>
        <select v-model="filters.product">
          <option value="">全部产品</option>
          <option v-for="product in PRODUCTS" :key="product" :value="product">{{ product }}</option>
        </select>
      </label>
      <label class="filter-item">
        <span>状态</span>
        <select v-model="filters.status">
          <option value="">全部状态</option>
          <option v-for="status in statuses" :key="status" :value="status">{{ status }}</option>
        </select>
      </label>
      <label class="filter-item">
        <span>关键字</span>
        <input v-model="filters.keyword" placeholder="检验编号/批号/检验项目" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <div v-for="group in groupedRows" :key="group.product" class="fascicle">
      <div class="fascicle-head">
        <strong>产品分册 · {{ group.product }}</strong>
        <span>{{ group.reports.length }} 份报告</span>
      </div>
      <table class="data-table">
        <thead>
          <tr>
            <th>检验编号</th>
            <th>产品批号</th>
            <th>出报告日</th>
            <th>检验项目（含复检栏）</th>
            <th>判定结论</th>
            <th>流程状态</th>
            <th>签字</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <template v-for="report in group.reports" :key="report.id">
            <tr :class="{ 'reinspect-row': report.status === '复检中' }">
              <td>{{ report.reportNo }}</td>
              <td>{{ report.batchNo }}</td>
              <td>{{ report.reportDate }}</td>
              <td>
                <button class="link" type="button" @click="toggleItems(report.id)">
                  {{ report.items.length }} 项（{{ expanded[report.id] ? '收起' : '展开' }}）
                </button>
              </td>
              <td>
                <span v-if="report.conclusion" :class="report.conclusion === '合格' ? 'pass-text' : 'fail-text'">
                  {{ report.conclusion }}
                </span>
                <span v-else class="muted-text">未判定</span>
              </td>
              <td>
                <div class="step-track">
                  <span
                    v-for="step in statuses"
                    :key="step"
                    class="step"
                    :class="{ active: step === report.status, done: isStepDone(step, report.status), reject: report.status === '复检中' && step === '待签字' }"
                  >{{ step }}</span>
                </div>
              </td>
              <td>{{ report.inspectorSign || '—' }}</td>
              <td class="row-actions">
                <template v-for="action in availableActions(report)" :key="action">
                  <button class="link" type="button" @click="handleAction(action, report)">{{ action }}</button>
                </template>
                <button class="link" type="button" @click="openLog(report)">判定留痕</button>
              </td>
            </tr>
            <tr v-if="expanded[report.id]" class="sub-row">
              <td colspan="8">
                <table class="item-table">
                  <thead>
                    <tr>
                      <th>检验项目</th>
                      <th>标准规定</th>
                      <th>检验结果（初检）</th>
                      <th class="reinspect-col">复检结果（另栏）</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="item in report.items" :key="item.item">
                      <td>{{ item.item }}</td>
                      <td>{{ item.standard }}</td>
                      <td>{{ item.result || '—' }}</td>
                      <td class="reinspect-col">{{ item.reinspectResult || '—' }}</td>
                    </tr>
                  </tbody>
                </table>
              </td>
            </tr>
          </template>
        </tbody>
      </table>
    </div>

    <p v-if="!rows.length" class="empty-block">当前筛选条件下没有检验报告</p>

    <section v-if="packPanelOpen" class="pack-panel">
      <h3>按产品拆包外发（注册 / 车间）</h3>
      <p class="page-desc">
        每包只含检验编号、检验项目、标准规定、检验结果（复检另栏、带签字），包名带产品与出报告日；
        当期没有报告的产品附情况说明，不给空包；同一份报告重复打包只计一次。
      </p>
      <div class="filter-bar">
        <label class="filter-item">
          <span>打包周期</span>
          <input v-model="packPeriod" placeholder="YYYY-MM，如 2026-10" />
        </label>
        <button class="btn" type="button" @click="refreshPackPreview">刷新预览</button>
      </div>
      <table class="data-table" v-if="packPreview">
        <thead>
          <tr><th>产品</th><th>出报告日</th><th>包内报告</th><th>本次新计</th><th>已打包（不重复计）</th><th>包名</th></tr>
        </thead>
        <tbody>
          <tr v-for="pack in packPreview.packs" :key="`${pack.product}-${pack.reportDate}`">
            <td>{{ pack.product }}</td>
            <td>{{ pack.reportDate }}</td>
            <td>{{ pack.reports.map((r) => r.reportNo).join('、') }}</td>
            <td>{{ pack.reports.length - pack.alreadyPacked }}</td>
            <td>{{ pack.alreadyPacked }}</td>
            <td class="muted-text">检验报告分册_{{ pack.product }}_出报告{{ pack.reportDate }}.csv</td>
          </tr>
          <tr v-for="product in packPreview.noReportProducts" :key="`note-${product}`" class="note-row">
            <td>{{ product }}</td>
            <td>—</td>
            <td colspan="3">当期无已签发报告，附《情况说明》文件，不给空包</td>
            <td class="muted-text">无报告说明_{{ product }}_{{ packPeriod }}.txt</td>
          </tr>
        </tbody>
      </table>
      <footer class="pack-foot">
        <button class="btn primary" type="button" @click="doExport">生成 ZIP 并下载外发</button>
        <span class="muted-text">
          报告包 {{ packPreview?.packs.length ?? 0 }} 个 · 新计报告 {{ packPreview?.newCount ?? 0 }} 份 ·
          重复不计 {{ packPreview?.alreadyCount ?? 0 }} 份 · 无报告说明 {{ packPreview?.noReportProducts.length ?? 0 }} 份
        </span>
      </footer>

      <h4>打包台账（按检验编号去重）</h4>
      <table class="data-table">
        <thead><tr><th>检验编号</th><th>产品</th><th>批号</th><th>出报告日</th><th>打包周期</th><th>打包时间</th></tr></thead>
        <tbody>
          <tr v-for="entry in ledger" :key="entry.reportNo">
            <td>{{ entry.reportNo }}</td><td>{{ entry.product }}</td><td>{{ entry.batchNo }}</td>
            <td>{{ entry.reportDate }}</td><td>{{ entry.period }}</td><td>{{ entry.packedAt }}</td>
          </tr>
          <tr v-if="!ledger.length"><td colspan="6" class="empty-state">还没有打包记录</td></tr>
        </tbody>
      </table>
    </section>

    <!-- 登记报告 -->
    <div v-if="createOpen" class="modal-mask" @click.self="createOpen = false">
      <div class="modal">
        <h3>登记成品检验报告</h3>
        <div class="form-grid">
          <label><span>检验编号 *</span><input v-model="draft.reportNo" placeholder="如 QC-20261006" /></label>
          <label><span>产品 *</span>
            <input v-model="draft.product" list="product-list" placeholder="从产品目录选择" />
            <datalist id="product-list"><option v-for="p in PRODUCTS" :key="p" :value="p" /></datalist>
          </label>
          <label><span>产品批号 *</span><input v-model="draft.batchNo" /></label>
          <label><span>出报告日期 *</span><input v-model="draft.reportDate" type="date" /></label>
        </div>
        <h4>检验项目 *（多处取到的同一项自动归一；目录外名称打回重填）</h4>
        <p class="page-desc hint">标准项目：{{ INSPECTION_ITEMS.map((i) => i.name).join('、') }}；填别名（如 pH、水份、热原）会自动归一。</p>
        <table class="data-table">
          <thead><tr><th>检验项目</th><th>标准规定</th><th>检验结果</th><th></th></tr></thead>
          <tbody>
            <tr v-for="(line, index) in draft.items" :key="index">
              <td>
                <input v-model="line.item" list="item-list" placeholder="标准项目或别名" />
                <datalist id="item-list"><option v-for="i in INSPECTION_ITEMS" :key="i.name" :value="i.name" /></datalist>
              </td>
              <td><input v-model="line.standard" placeholder="留空时用目录默认标准" /></td>
              <td><input v-model="line.result" placeholder="待检验可先不填" /></td>
              <td><button class="link" type="button" @click="draft.items.splice(index, 1)">删除</button></td>
            </tr>
          </tbody>
        </table>
        <button class="btn" type="button" @click="addDraftItem">+ 添加检验项目</button>
        <footer class="modal-foot">
          <span v-if="formMessage" :class="formOk ? 'pass-text' : 'error-text'">{{ formMessage }}</span>
          <span>
            <button class="btn ghost" type="button" @click="createOpen = false">取消</button>
            <button class="btn primary" type="button" @click="submitCreate">提交登记</button>
          </span>
        </footer>
      </div>
    </div>

    <!-- 录入/复检结果 -->
    <div v-if="entryTarget" class="modal-mask" @click.self="entryTarget = null">
      <div class="modal">
        <h3>{{ entryTarget.status === '复检中' ? '录入复检结果' : '录入检验结果' }} · {{ entryTarget.reportNo }}</h3>
        <p class="page-desc" v-if="entryTarget.status === '复检中'">仅不合格项目需要录复检结果；复检结果在报告分册中另开一栏。</p>
        <table class="data-table">
          <thead>
            <tr><th>检验项目</th><th>标准规定</th><th>检验结果</th><th v-if="entryTarget.status === '复检中'">复检结果</th></tr>
          </thead>
          <tbody>
            <tr v-for="line in entryDraft" :key="line.item" :class="{ 'need-re': entryTarget.status === '复检中' && needsReinspect(line.item) }">
              <td>{{ line.item }}<span v-if="entryTarget.status === '复检中' && needsReinspect(line.item)" class="re-tag">初检不合格</span></td>
              <td><input v-model="line.standard" /></td>
              <td><input v-model="line.result" /></td>
              <td v-if="entryTarget.status === '复检中'">
                <input v-model="line.reinspectResult" :placeholder="needsReinspect(line.item) ? '该项目初检不合格，必填' : '无需复检可留空'" />
              </td>
            </tr>
          </tbody>
        </table>
        <footer class="modal-foot">
          <span v-if="formMessage" :class="formOk ? 'pass-text' : 'error-text'">{{ formMessage }}</span>
          <span>
            <button class="btn ghost" type="button" @click="entryTarget = null">取消</button>
            <button class="btn primary" type="button" @click="saveEntries">保存结果</button>
          </span>
        </footer>
      </div>
    </div>

    <!-- 检验人签字 -->
    <div v-if="signTarget" class="modal-mask" @click.self="signTarget = null">
      <div class="modal small">
        <h3>检验人签字 · {{ signTarget.reportNo }}</h3>
        <p class="page-desc">
          报告结论：<strong :class="signTarget.conclusion === '合格' ? 'pass-text' : 'fail-text'">{{ signTarget.conclusion }}</strong>。
          检验人签字后报告即签发，可进入按产品拆包外发。
        </p>
        <label class="sign-input"><span>检验人姓名 *</span><input v-model="signer" :placeholder="store.operator" /></label>
        <footer class="modal-foot">
          <span v-if="formMessage" class="error-text">{{ formMessage }}</span>
          <span>
            <button class="btn ghost" type="button" @click="signTarget = null">取消</button>
            <button class="btn primary" type="button" @click="confirmSign">确认签字并签发</button>
          </span>
        </footer>
      </div>
    </div>

    <!-- 判定留痕 -->
    <div v-if="logTarget" class="modal-mask" @click.self="logTarget = null">
      <div class="modal">
        <h3>判定留痕 · {{ logTarget.reportNo }}</h3>
        <table class="data-table">
          <thead><tr><th>检验项目</th><th>判定</th><th>依据</th><th>时间</th></tr></thead>
          <tbody>
            <tr v-for="(log, i) in logTarget.verdictLog" :key="i">
              <td>{{ log.item }}</td>
              <td :class="log.verdict === '合格' ? 'pass-text' : 'fail-text'">{{ log.verdict }}</td>
              <td>{{ log.reason }}</td>
              <td>{{ log.at }}</td>
            </tr>
            <tr v-if="!logTarget.verdictLog.length"><td colspan="4" class="empty-state">尚未判定</td></tr>
          </tbody>
        </table>
        <footer class="modal-foot"><button class="btn primary" type="button" @click="logTarget = null">关闭</button></footer>
      </div>
    </div>

    <footer class="page-foot">
      <span v-if="message" :class="messageOk ? 'pass-text' : 'error-text'">{{ message }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'

import { INSPECTION_ITEMS, PRODUCTS, findItem } from '@/data/catalog'
import { JUDGE_MODE_LABEL, type JudgeMode } from '@/data/judge'
import {
  createReport,
  downloadBlob,
  executeAction,
  exportPeriodPacks,
  getJudgeMode,
  listLedger,
  listReports,
  nextActions,
  previewPacks,
  qcStats,
  setJudgeMode,
  updateReportItems,
  type PackPreviewResult as PackPreviewType,
} from '@/api/qc-service'
import type { PackLedgerEntry, QcAction, QcReport } from '@/data/types'
import { useSessionStore } from '@/stores/session'

const store = useSessionStore()
const statuses = ['待检验', '检验中', '待判定', '待签字', '复检中', '已签发'] as const
const judgeModeOptions: { value: JudgeMode; title: string; desc: string }[] = [
  { value: 'standard', title: '标准规定说了算', desc: '检验结果逐项与标准规定（限度/区间/定性）比对，得出合格与否' },
  { value: 'result', title: '检验结果说了算', desc: '以检验结果写明的判定性结论为准，没写“符合/不符合”则挡回' },
]

const rows = ref<QcReport[]>([])
const stats = ref(qcStats())
const judgeMode = ref<JudgeMode>(getJudgeMode())
const filters = reactive<{ product: string; status: string; keyword: string }>({ product: '', status: '', keyword: '' })
const expanded = reactive<Record<number, boolean>>({})
const message = ref('')
const messageOk = ref(false)

const rulePanelOpen = ref(false)
const packPanelOpen = ref(false)
const packPeriod = ref('2026-10')
const packPreview = ref<PackPreviewType | null>(null)
const ledger = ref<PackLedgerEntry[]>([])

const createOpen = ref(false)
const formMessage = ref('')
const formOk = ref(false)
const draft = reactive({
  reportNo: '',
  product: '',
  batchNo: '',
  reportDate: '2026-10-03',
  items: [{ item: '', standard: '', result: '' }],
})

const entryTarget = ref<QcReport | null>(null)
const entryDraft = ref<{ item: string; standard: string; result: string; reinspectResult: string }[]>([])
const signTarget = ref<QcReport | null>(null)
const signer = ref('')
const logTarget = ref<QcReport | null>(null)

const groupedRows = computed(() => {
  const groups = new Map<string, QcReport[]>()
  for (const report of rows.value) {
    groups.set(report.product, [...(groups.get(report.product) ?? []), report])
  }
  return [...groups.entries()].map(([product, reports]) => ({ product, reports }))
})

function isStepDone(step: string, current: string): boolean {
  const order = ['待检验', '检验中', '待判定', '待签字', '已签发']
  // 复检中是待签字的回路：待签字之前的步骤已完成，但签字本身未完成
  if (current === '复检中') return ['待检验', '检验中', '待判定'].includes(step)
  return order.indexOf(step) < order.indexOf(current)
}

function needsReinspect(itemName: string): boolean {
  return entryTarget.value?.verdictLog.some(
    (log) => log.item === itemName && log.verdict === '不合格',
  ) ?? false
}

// 页面动作过滤：待签字但结论合格的报告不走复检；服务端仍有同样的裁决兜底
function availableActions(report: QcReport): QcAction[] {
  return nextActions(report.status).filter(
    (action) => action !== '判定不合格转复检' || report.conclusion === '不合格',
  )
}

function flash(text: string, ok = true) {
  message.value = text
  messageOk.value = ok
}

function reload() {
  rows.value = listReports({
    product: filters.product || undefined,
    status: filters.status || undefined,
    keyword: filters.keyword || undefined,
  })
  stats.value = qcStats()
  judgeMode.value = getJudgeMode()
  ledger.value = listLedger()
}

function reloadAll() {
  reload()
  if (packPanelOpen.value) refreshPackPreview()
}

function resetFilters() {
  filters.product = ''
  filters.status = ''
  filters.keyword = ''
  reload()
}

function toggleItems(id: number) {
  expanded[id] = !expanded[id]
}

function changeJudgeMode(mode: JudgeMode) {
  const result = setJudgeMode(mode)
  formMessage.value = result.message
  formOk.value = result.ok
  judgeMode.value = getJudgeMode()
}

// ---- 登记 ----
function openCreate() {
  draft.reportNo = ''
  draft.product = ''
  draft.batchNo = ''
  draft.reportDate = '2026-10-03'
  draft.items = [{ item: '', standard: '', result: '' }]
  formMessage.value = ''
  createOpen.value = true
}

function addDraftItem() {
  draft.items.push({ item: '', standard: '', result: '' })
}

function submitCreate() {
  formMessage.value = ''
  // 标准留空时带出目录默认标准
  const items = draft.items.map((line) => {
    const standard = line.standard.trim() || findItem(line.item.trim())?.defaultStandard || ''
    return { item: line.item, standard, result: line.result }
  })
  const result = createReport({
    reportNo: draft.reportNo,
    product: draft.product,
    batchNo: draft.batchNo,
    reportDate: draft.reportDate,
    items,
  })
  formMessage.value = result.message
  formOk.value = result.ok
  if (result.ok) {
    createOpen.value = false
    reload()
    flash(result.message)
  }
}

// ---- 流程动作 ----
function handleAction(action: QcAction, report: QcReport) {
  formMessage.value = ''
  if (action === '录入结果') {
    openEntry(report)
    return
  }
  if (action === '判定不合格转复检') {
    const result = executeAction(report.id, action)
    flash(result.message, result.ok)
    if (result.ok) {
      reload()
      const fresh = rows.value.find((r) => r.id === report.id)
      if (fresh) openEntry(fresh)
    }
    return
  }
  if (action === '检验人签字') {
    signTarget.value = report
    signer.value = store.operator && store.operator !== '值班管理员' ? store.operator : ''
    formMessage.value = ''
    return
  }
  // 开始检验 / 录入完成送判定 / 执行判定 / 复检完成再判定
  const result = executeAction(report.id, action)
  flash(result.message, result.ok)
  if (result.ok) reload()
}

function openEntry(report: QcReport) {
  entryTarget.value = report
  entryDraft.value = report.items.map((item) => ({
    item: item.item,
    standard: item.standard,
    result: item.result,
    reinspectResult: item.reinspectResult,
  }))
  formMessage.value = ''
}

function saveEntries() {
  if (!entryTarget.value) return
  const target = entryTarget.value
  const result = updateReportItems(target.id, entryDraft.value)
  formMessage.value = result.message
  formOk.value = result.ok
  if (!result.ok) return

  // 复检中：保存完直接尝试复检再判定；检验中：保存完停留，由「录入完成送判定」推进
  if (target.status === '复检中') {
    const judged = executeAction(target.id, '复检完成再判定')
    entryTarget.value = null
    reload()
    flash(judged.ok ? `${result.message}；${judged.message}` : judged.message, judged.ok)
    return
  }
  entryTarget.value = null
  reload()
  flash(result.message + '，确认无误后请点「录入完成送判定」')
}

function confirmSign() {
  if (!signTarget.value) return
  const result = executeAction(signTarget.value.id, '检验人签字', signer.value)
  formMessage.value = result.message
  formOk.value = result.ok
  if (result.ok) {
    signTarget.value = null
    reload()
    flash(result.message)
  }
}

function openLog(report: QcReport) {
  logTarget.value = report
}

// ---- 按产品拆包 ----
function refreshPackPreview() {
  packPreview.value = previewPacks(packPeriod.value.trim())
}

function doExport() {
  const result = exportPeriodPacks(packPeriod.value.trim())
  flash(result.message, result.ok)
  if (result.ok && result.blob && result.filename) {
    downloadBlob(result.blob, result.filename)
  }
  reloadAll()
}

onMounted(() => {
  reload()
  refreshPackPreview()
})
</script>

<style scoped>
.rule-box { background: #fff; border: 1px solid var(--border); border-radius: 8px; padding: 10px 12px; margin-bottom: 12px; }
.rule-head { display: flex; justify-content: space-between; align-items: center; font-size: 13px; }
.rule-current { margin: 4px 0 0; color: var(--brand); font-size: 13px; }
.rule-options { display: flex; gap: 12px; margin-top: 8px; }
.hint { margin: 4px 0 8px; font-size: 12px; }
.rule-option { display: flex; gap: 8px; align-items: flex-start; flex: 1; border: 1px dashed var(--border); border-radius: 6px; padding: 8px; cursor: pointer; }
.rule-option em { display: block; color: var(--muted); font-style: normal; font-size: 12px; margin-top: 2px; }
.fascicle { background: #fff; border: 1px solid var(--border); border-radius: 8px; margin-bottom: 14px; overflow: hidden; }
.fascicle-head { display: flex; justify-content: space-between; padding: 8px 12px; background: #eef4ff; font-size: 13px; }
.step-track { display: flex; flex-wrap: wrap; gap: 4px; }
.step { font-size: 11px; border: 1px solid var(--border); border-radius: 999px; padding: 1px 8px; color: var(--muted); white-space: nowrap; }
.step.active { background: var(--brand); color: #fff; border-color: var(--brand); }
.step.done { background: #e6f4ea; color: #1e7a3c; border-color: #b7dfc3; }
.step.reject { background: #fde8e8; color: #b42318; border-color: #f3b4b4; }
.reinspect-row { background: #fff8f8; }
.sub-row td { background: #fafcff; padding: 8px 14px; }
.item-table th, .item-table td { font-size: 12px; }
.reinspect-col { background: #fff6ec; }
.need-re td { background: #fff7f7; }
.re-tag { display: inline-block; margin-left: 6px; font-size: 11px; color: #b42318; border: 1px solid #f3b4b4; border-radius: 999px; padding: 0 6px; }
.pass-text { color: #1e7a3c; font-weight: 600; }
.fail-text { color: #b42318; font-weight: 600; }
.muted-text { color: var(--muted); }
.empty-block { text-align: center; color: var(--muted); padding: 24px 0; }
.pack-panel { background: #fff; border: 1px solid var(--border); border-radius: 8px; padding: 12px; margin-top: 16px; }
.pack-foot { display: flex; gap: 12px; align-items: center; margin: 10px 0 16px; }
.note-row td { color: var(--muted); }
.modal-mask { position: fixed; inset: 0; background: rgba(15, 23, 42, 0.45); display: flex; align-items: center; justify-content: center; z-index: 20; }
.modal { background: #fff; border-radius: 10px; padding: 18px 20px; width: min(880px, 92vw); max-height: 88vh; overflow: auto; }
.modal.small { width: min(480px, 92vw); }
.form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin: 10px 0; }
.form-grid label span, .sign-input span { display: block; font-size: 12px; color: var(--muted); margin-bottom: 2px; }
.modal-foot { display: flex; justify-content: space-between; align-items: center; margin-top: 14px; gap: 8px; }
.sign-input { display: block; margin: 12px 0; }
input, select { border: 1px solid var(--border); border-radius: 6px; padding: 5px 8px; font-size: 13px; min-width: 120px; }
.item-table input, .data-table input { min-width: 0; width: 100%; }
</style>
