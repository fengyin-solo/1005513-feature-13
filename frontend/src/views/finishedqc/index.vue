<template>
  <section class="page" data-module="finishedqc">
    <header class="page-head">
      <div>
        <h2>成品检验管理</h2>
        <p class="page-desc">成品检验报告按产品分册外发，复检另开一栏，检验人签字确认；状态只能一步步推进，跳级挡回。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记成品检验报告</button>
        <button class="btn" type="button" @click="exportRows">导出成品检验清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ row[column] || '—' }}</td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button
              v-for="action in allowedActions(row)"
              :key="action"
              class="link"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无成品检验数据，可先登记成品检验报告</td>
        </tr>
      </tbody>
    </table>

    <section class="package-panel">
      <h3>按产品分册打包外发</h3>
      <p class="page-desc">
        按报告期间把已判定并签字的报告按产品打成 ZIP：每产品一个分册（包名带产品与出报告日），
        当期无报告的产品附说明文件、不发空包；同一份报告重复打包只算一次。
      </p>
      <div class="filter-bar">
        <label class="filter-item">
          <span>报告期间起</span>
          <input v-model="period.start" type="date" />
        </label>
        <label class="filter-item">
          <span>报告期间止</span>
          <input v-model="period.end" type="date" />
        </label>
        <button class="btn" type="button" @click="refreshPlan">预览分册</button>
        <button class="btn primary" type="button" @click="doPackage">生成外发包并下载</button>
      </div>
      <ul v-if="plan" class="plan-list">
        <li>当期可出包报告：{{ plan.ready.length }} 份，涉及 {{ plan.productsWithReport.length }} 个产品</li>
        <li>
          未签字挡回：
          <span :class="plan.unsigned.length ? 'error-text' : ''">{{ plan.unsigned.length }} 份</span>
          <template v-if="plan.unsigned.length">（{{ plan.unsigned.map((r) => r.baseNo).join('、') }}）</template>
        </li>
        <li>当期无报告产品：{{ plan.productsWithoutReport.length }} 个（{{ plan.productsWithoutReport.join('、') || '无' }}），将附说明文件</li>
      </ul>

      <h4>打包台账</h4>
      <table class="data-table">
        <thead>
          <tr>
            <th>打包批次</th>
            <th>报告期间</th>
            <th>打包时间</th>
            <th>外发包文件名</th>
            <th>计入报告行数</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in history" :key="item.batchId">
            <td>{{ item.batchId }}</td>
            <td>{{ item.periodStart || '不限' }} ~ {{ item.periodEnd || '不限' }}</td>
            <td>{{ formatTime(item.packagedAt) }}</td>
            <td>{{ item.zipName }}</td>
            <td>{{ item.entries.length }}</td>
          </tr>
          <tr v-if="!history.length">
            <td colspan="5" class="empty-state">尚无打包记录</td>
          </tr>
        </tbody>
      </table>
    </section>

    <footer class="page-foot">
      <span>共 {{ total }} 条成品检验记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
      <span v-else-if="infoMessage" class="info-text">{{ infoMessage }}</span>
    </footer>

    <!-- 登记报告弹层 -->
    <div v-if="creating" class="modal-mask" @click.self="creating = false">
      <form class="modal" @submit.prevent="submitCreate">
        <h3>登记成品检验报告</h3>
        <label class="form-item">
          <span>检验编号</span>
          <input v-model="draft.检验编号" placeholder="如 FINI-2610-01" />
        </label>
        <div class="form-row">
          <label class="form-item">
            <span>产品名称</span>
            <input v-model="draft.产品名称" placeholder="如 阿莫西林胶囊" />
          </label>
          <label class="form-item">
            <span>产品批号</span>
            <input v-model="draft.产品批号" placeholder="如 AMX-261001" />
          </label>
        </div>
        <label class="form-item">
          <span>出报告日</span>
          <input v-model="draft.报告日期" type="date" />
        </label>
        <label class="form-item">
          <span>检验项目（多个用「；」分隔，必须为法定项目）</span>
          <textarea v-model="draft.检验项目" rows="2" :placeholder="legalItemHint"></textarea>
        </label>
        <label class="form-item">
          <span>标准规定（按项目逐条，用「；」分隔）</span>
          <textarea v-model="draft.标准规定" rows="3" placeholder="应为白色或类白色颗粒；应为标示量的95.0%~105.0%"></textarea>
        </label>
        <label class="form-item">
          <span>检验结果（与标准逐条对应，用「；」分隔）</span>
          <textarea v-model="draft.检验结果" rows="3" placeholder="类白色颗粒；标示量的99.2%"></textarea>
        </label>
        <p v-if="formError" class="error-text">{{ formError }}</p>
        <div class="modal-actions">
          <button class="btn" type="button" @click="creating = false">取消</button>
          <button class="btn primary" type="submit">提交登记</button>
        </div>
      </form>
    </div>

    <!-- 签字弹层 -->
    <div v-if="signing" class="modal-mask" @click.self="signing = null">
      <form class="modal" @submit.prevent="submitSign">
        <h3>检验人签字</h3>
        <p class="page-desc">报告编号：{{ signing['检验编号'] }}（{{ signing.status }}）</p>
        <label class="form-item">
          <span>检验人手写签名（请输入本人姓名）</span>
          <input v-model="signerName" placeholder="检验人姓名" autofocus />
        </label>
        <p v-if="formError" class="error-text">{{ formError }}</p>
        <div class="modal-actions">
          <button class="btn" type="button" @click="signing = null">取消</button>
          <button class="btn primary" type="submit">确认签字</button>
        </div>
      </form>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import { useSessionStore } from '@/stores/session'
import { actionAllowed, downloadEntries, listEntries, moduleMeta, runAction as applyAction } from '@/api/local-service'
import {
  buildPackagePlan,
  createReport,
  judgeReport,
  packageHistory,
  packageReports,
  signReport,
  startReinspection,
  type PackagePlan,
  type ReportDraft,
} from '@/api/qc-service'
import { LEGAL_ITEMS } from '@/api/qc-rules'
import type { EntryRow } from '@/data/types'

const store = useSessionStore()

const meta = moduleMeta('finishedqc')
const columns = [
  '检验编号',
  '产品名称',
  '产品批号',
  '检验轮次',
  '报告日期',
  '检验项目',
  '标准规定',
  '检验结果',
  '判定结论',
  '检验人签字',
]

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const infoMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = ['检验编号', '产品名称', '产品批号']
const statusSummary = computed(() =>
  meta.statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)
const stats = computed(() => [
  { label: '待检验批次', value: rows.value.filter((row) => row.status === '待检验').length },
  { label: '检验中/复检中批次', value: rows.value.filter((row) => ['检验中', '复检中'].includes(String(row.status))).length },
  { label: '不合格批次数', value: rows.value.filter((row) => row.status === '不合格').length },
  { label: '未签字终态报告', value: rows.value.filter((row) => ['已合格', '复检合格'].includes(String(row.status)) && !row['检验人签字']).length },
])

// 页面只做渲染：某状态下能走哪一步完全以状态机登记的来源为准，跳级动作不出现也不允许。
function allowedActions(row: EntryRow): string[] {
  return meta.actions.filter((action) => {
    if (action === '检验人签字') {
      return String(row.status) !== '待检验' && !row['检验人签字']
    }
    return actionAllowed(meta, action, String(row.status))
  })
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function flashMessage(result: { ok: boolean; message: string }) {
  if (result.ok) {
    errorMessage.value = ''
    infoMessage.value = result.message
  } else {
    infoMessage.value = ''
    errorMessage.value = result.message
  }
}

// ---------- 登记 ----------

const legalItemHint = `法定项目：${LEGAL_ITEMS.join('、')}`
const creating = ref(false)
const formError = ref('')
const emptyDraft = (): ReportDraft => ({
  检验编号: '',
  产品名称: '',
  产品批号: '',
  报告日期: '',
  检验项目: '',
  标准规定: '',
  检验结果: '',
})
const draft = ref<ReportDraft>(emptyDraft())

function openCreate() {
  draft.value = emptyDraft()
  formError.value = ''
  creating.value = true
}

function submitCreate() {
  formError.value = ''
  const result = createReport(draft.value)
  if (!result.ok) {
    // 非法值打回：弹层不关、内容保留，用户直接重填。
    formError.value = result.message
    return
  }
  creating.value = false
  flashMessage(result)
  reload()
}

// ---------- 动作分发 ----------

const signing = ref<EntryRow | null>(null)
const signerName = ref('')

function openSign(row: EntryRow) {
  signing.value = row
  signerName.value = store.operator === '值班管理员' ? '' : store.operator
  formError.value = ''
}

function submitSign() {
  if (!signing.value) {
    return
  }
  const result = signReport(Number(signing.value.id), signerName.value)
  if (!result.ok) {
    formError.value = result.message
    return
  }
  signing.value = null
  flashMessage(result)
  reload()
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  infoMessage.value = ''
  if (action === '检验人签字') {
    openSign(row)
    return
  }
  let result: { ok: boolean; message: string }
  if (action === '判定合格') {
    result = judgeReport(Number(row.id), '合格')
  } else if (action === '判定不合格') {
    result = judgeReport(Number(row.id), '不合格')
  } else if (action === '发起复检') {
    result = startReinspection(Number(row.id))
  } else {
    result = applyAction(meta.key, Number(row.id), action)
  }
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  flashMessage(result)
  reload()
}

// ---------- 分册打包 ----------

const period = ref({ start: '2026-09-01', end: '2026-09-30' })
const plan = ref<PackagePlan | null>(null)
const history = ref(packageHistory())

function refreshPlan() {
  plan.value = buildPackagePlan(period.value)
}

function doPackage() {
  const result = packageReports(period.value)
  flashMessage(result)
  if (result.ok) {
    history.value = packageHistory()
    refreshPlan()
    reload()
  }
}

function formatTime(iso: string): string {
  return iso.replace('T', ' ').slice(0, 16)
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
    refreshPlan()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '成品检验列表读取失败'
  }
}

onMounted(reload)
</script>

<style scoped>
.package-panel {
  margin-top: 20px;
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 14px 16px;
}
.plan-list {
  margin: 8px 0 14px;
  padding-left: 18px;
  font-size: 13px;
  line-height: 1.9;
}
.info-text {
  color: #17694f;
}
.modal-mask {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 20;
}
.modal {
  background: #fff;
  border-radius: 10px;
  padding: 18px 20px;
  width: 560px;
  max-width: 92vw;
  max-height: 88vh;
  overflow: auto;
}
.form-item {
  display: block;
  margin-bottom: 10px;
  font-size: 12px;
  color: var(--muted);
}
.form-item input,
.form-item textarea {
  width: 100%;
  margin-top: 4px;
  font-size: 13px;
  color: #1f2937;
  padding: 6px 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
}
.form-row {
  display: flex;
  gap: 12px;
}
.form-row .form-item {
  flex: 1;
}
.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 8px;
}
</style>
