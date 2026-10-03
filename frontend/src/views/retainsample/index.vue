<template>
  <section class="page" data-module="retainsample">
    <header class="page-head">
      <div>
        <h2>留样管理</h2>
        <p class="page-desc">成品检验结论自动回写为本页待办；从待办登记留样，登记后待办关闭。围绕留样编号、对应批号、留样数量、留样期限做筛选与状态流转。</p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="exportRows">导出留样清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <section class="todo-box">
      <div class="todo-head">
        <strong>成品检验结果回写待办（{{ todos.length }}）</strong>
        <button class="link" type="button" @click="showDone = !showDone">{{ showDone ? '只看待办' : '查看含已办理' }}</button>
      </div>
      <table class="data-table">
        <thead>
          <tr><th>产品</th><th>批号</th><th>检验编号</th><th>检验结论</th><th>结果摘要</th><th>回写时间</th><th>状态</th><th>操作</th></tr>
        </thead>
        <tbody>
          <tr v-for="todo in todos" :key="todo.id" :class="{ 'done-row': todo.done, 'fail-row': todo.conclusion === '不合格' && !todo.done }">
            <td>{{ todo.product }}</td>
            <td>{{ todo.batchNo }}</td>
            <td>{{ todo.reportNo }}</td>
            <td :class="todo.conclusion === '合格' ? 'pass-text' : 'fail-text'">{{ todo.conclusion }}</td>
            <td>{{ todo.summary }}</td>
            <td>{{ todo.createdAt }}</td>
            <td>{{ todo.done ? `已登记留样 ${todo.doneAt}` : '待登记留样' }}</td>
            <td>
              <button v-if="!todo.done" class="link" type="button" @click="openTodoForm(todo)">登记留样并关闭待办</button>
              <RouterLink v-else class="link" :to="'/finishedqc'">查看检验报告</RouterLink>
            </td>
          </tr>
          <tr v-if="!todos.length"><td colspan="8" class="empty-state">没有待办理的检验结果回写</td></tr>
        </tbody>
      </table>
    </section>

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
        <tr v-for="row in rows" :key="String(row.id)" :class="{ 'abnormal-row': row.abnormal }">
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button
              v-for="action in actions"
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
          <td :colspan="columns.length + 2" class="empty-state">暂无留样数据，可从上方检验结果待办登记留样</td>
        </tr>
      </tbody>
    </table>

    <div v-if="todoForm" class="modal-mask" @click.self="todoForm = null">
      <div class="modal small">
        <h3>登记留样 · {{ todoForm.batchNo }}</h3>
        <p class="page-desc">
          产品 {{ todoForm.product }}，检验结论
          <strong :class="todoForm.conclusion === '合格' ? 'pass-text' : 'fail-text'">{{ todoForm.conclusion }}</strong>
        </p>
        <div class="form-grid">
          <label><span>留样编号 *</span><input v-model="todoPayload.retainNo" :placeholder="`RETA-${todoForm.batchNo}`" /></label>
          <label><span>留样数量 *</span><input v-model.number="todoPayload.quantity" type="number" min="1" /></label>
          <label><span>留样期限至 *</span><input v-model="todoPayload.period" type="date" />
          </label>
          <label><span>存放条件 *</span><input v-model="todoPayload.storage" placeholder="如 常温遮光密封保存" /></label>
        </div>
        <footer class="modal-foot">
          <span v-if="todoError" class="error-text">{{ todoError }}</span>
          <span>
            <button class="btn ghost" type="button" @click="todoForm = null">取消</button>
            <button class="btn primary" type="button" @click="submitTodo">确认登记</button>
          </span>
        </footer>
      </div>
    </div>

    <footer class="page-foot">
      <span>共 {{ total }} 条留样记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'

import {
  downloadEntries,
  listEntries,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import { listRetainTodos, registerRetainFromTodo } from '@/api/qc-service'
import type { EntryRow, RetainTodo } from '@/data/types'

const meta = moduleMeta('retainsample')
const columns = ["留样编号", "对应批号", "留样数量", "留样期限", "存放条件", "取样日期", "销毁日期", "留样状态"]
const actions = ["标记到期", "办理销毁"]
const statuses = ["待留样", "已留样", "已到期", "已销毁"]

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)

const todos = ref<RetainTodo[]>([])
const showDone = ref(false)
const todoForm = ref<RetainTodo | null>(null)
const todoError = ref('')
const todoPayload = reactive({ retainNo: '', quantity: 12, period: '2027-10-03', storage: '常温遮光密封保存' })

const stats = computed(() => [
  { label: '留样记录', value: rows.value.length },
  { label: '待登记留样（检验回写）', value: todos.value.filter((t) => !t.done).length },
  { label: '不合格批留样', value: rows.value.filter((r) => r.abnormal).length },
  { label: '已到期', value: rows.value.filter((r) => String(r.status) === '已到期').length },
])

const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
}

function openTodoForm(todo: RetainTodo) {
  todoForm.value = todo
  todoError.value = ''
  todoPayload.retainNo = `RETA-${todo.batchNo}`
  todoPayload.quantity = 12
  todoPayload.period = '2027-10-03'
  todoPayload.storage = '常温遮光密封保存'
}

function submitTodo() {
  if (!todoForm.value) return
  const result = registerRetainFromTodo(todoForm.value.id, { ...todoPayload })
  todoError.value = result.ok ? '' : result.message
  if (result.ok) {
    todoForm.value = null
    reload()
  }
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
    todos.value = listRetainTodos(showDone.value)
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '留样管理列表读取失败'
  }
}

onMounted(reload)
</script>

<style scoped>
.todo-box { background: #fff; border: 1px solid var(--border); border-radius: 8px; padding: 10px 12px; margin-bottom: 14px; }
.todo-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; font-size: 13px; }
.done-row { color: var(--muted); }
.fail-row td { background: #fff7f7; }
.abnormal-row td { background: #fff7f7; }
.pass-text { color: #1e7a3c; font-weight: 600; }
.fail-text { color: #b42318; font-weight: 600; }
.modal-mask { position: fixed; inset: 0; background: rgba(15, 23, 42, 0.45); display: flex; align-items: center; justify-content: center; z-index: 20; }
.modal { background: #fff; border-radius: 10px; padding: 18px 20px; width: min(560px, 92vw); }
.modal.small { width: min(560px, 92vw); }
.form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin: 10px 0; }
.form-grid label span { display: block; font-size: 12px; color: var(--muted); margin-bottom: 2px; }
.modal-foot { display: flex; justify-content: space-between; align-items: center; margin-top: 14px; gap: 8px; }
input { border: 1px solid var(--border); border-radius: 6px; padding: 5px 8px; font-size: 13px; width: 100%; }
</style>
