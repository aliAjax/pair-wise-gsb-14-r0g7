<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import { canApprove, canReject, canWithdraw, formatTime, money } from "../domain/rules";
import { STATUS_LABELS, type PriceBatch } from "../domain/types";
import { approveBatch, discardBatch, loadDraftToForm, rejectBatch, state, withdrawBatch } from "../storage/store";

const approver = ref("区域经理");
const comments = reactive<Record<string, string>>({});

const queue = computed(() =>
  state.batches.filter((b) => b.status === "pending" || b.status === "approved"),
);
const drafts = computed(() => state.batches.filter((b) => b.status === "draft"));

function countdown(batch: PriceBatch): string {
  const due = Math.max(...batch.items.map((i) => new Date(i.effectiveAt).getTime()));
  const diff = due - state.now.getTime();
  if (diff <= 0) return "即将生效";
  const minutes = Math.floor(diff / 60000);
  if (minutes >= 60) return `约 ${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分后生效`;
  if (minutes >= 1) return `约 ${minutes} 分钟后生效`;
  return `${Math.max(1, Math.floor(diff / 1000))} 秒后生效`;
}

function approve(id: string) {
  approveBatch(id, approver.value.trim() || "审批人", comments[id] ?? "");
  comments[id] = "";
}

function reject(id: string) {
  rejectBatch(id, approver.value.trim() || "审批人", comments[id] ?? "");
  comments[id] = "";
}

function withdraw(id: string) {
  if (!window.confirm("确认撤回？同区同油品的生效区间占用将立即释放。")) return;
  withdrawBatch(id, approver.value.trim() || "审批人", comments[id] ?? "");
  comments[id] = "";
}
</script>

<template>
  <section class="list-panel">
    <div class="toolbar">
      <h2>批零价差审签台</h2>
      <label class="inline-field">
        审批人
        <input v-model="approver" />
      </label>
    </div>

    <h3 class="section-title">审批队列（{{ queue.length }}）</h3>
    <div class="record-grid">
      <div v-if="queue.length === 0" class="empty">暂无待处理批次</div>
      <article v-for="batch in queue" :key="batch.id" class="record">
        <div class="record-head">
          <p class="record-title">
            <span class="code">{{ batch.code }}</span> {{ batch.reason }}
          </p>
          <span class="status" :class="`st-${batch.status}`">{{ STATUS_LABELS[batch.status] }}</span>
        </div>

        <table class="items-table">
          <thead>
            <tr><th>区域</th><th>油品</th><th>基准价</th><th>加价幅度</th><th>旧价</th><th>新价</th><th>生效时刻</th></tr>
          </thead>
          <tbody>
            <tr v-for="it in batch.items" :key="it.id">
              <td>{{ it.region }}</td>
              <td>{{ it.fuel }}</td>
              <td>{{ money(it.benchmark) }}</td>
              <td>{{ it.markup >= 0 ? "+" : "" }}{{ money(it.markup) }}</td>
              <td>{{ money(it.oldPrice) }}</td>
              <td><strong>{{ money(it.newPrice) }}</strong></td>
              <td>{{ formatTime(it.effectiveAt) }}</td>
            </tr>
          </tbody>
        </table>

        <p v-if="batch.status === 'approved'" class="occupancy">占用中：生效区间已锁定，{{ countdown(batch) }}；生效前撤回可释放占用。</p>
        <p v-else class="occupancy">占用中：待审批期间同区同油品不可再排新价。</p>

        <ol class="chain">
          <li v-for="a in batch.approvals" :key="a.id">
            <strong>{{ a.actionLabel }}</strong> · {{ a.operator }} · {{ formatTime(a.at) }}<span v-if="a.comment"> — {{ a.comment }}</span>
          </li>
        </ol>

        <div class="actions">
          <input v-model="comments[batch.id]" class="comment-input" placeholder="审批意见（可选）" />
          <button v-if="canApprove(batch)" type="button" @click="approve(batch.id)">审批通过</button>
          <button v-if="canReject(batch)" type="button" class="secondary" @click="reject(batch.id)">驳回</button>
          <button v-if="canWithdraw(batch)" type="button" class="danger" @click="withdraw(batch.id)">撤回释放占用</button>
        </div>
      </article>
    </div>

    <h3 class="section-title">草稿箱 · 校验未通过（{{ drafts.length }}）</h3>
    <div class="record-grid">
      <div v-if="drafts.length === 0" class="empty">暂无草稿</div>
      <article v-for="batch in drafts" :key="batch.id" class="record draft">
        <div class="record-head">
          <p class="record-title">
            <span class="code">{{ batch.code }}</span> {{ batch.reason }}
          </p>
          <span class="status st-draft">{{ STATUS_LABELS[batch.status] }}</span>
        </div>
        <p class="draft-tip">整批留草稿：以下明细触发规则，修正后重新提交才会进入审批。</p>

        <table class="items-table violations-table">
          <thead>
            <tr><th>区域</th><th>油品</th><th>旧价</th><th>新价</th><th>触发规则</th></tr>
          </thead>
          <tbody>
            <tr v-for="v in batch.violations" :key="`${v.itemId}-${v.rule}`">
              <td>{{ v.region }}</td>
              <td>{{ v.fuel }}</td>
              <td>{{ money(v.oldPrice) }}</td>
              <td><strong>{{ money(v.newPrice) }}</strong></td>
              <td class="violation-rule">{{ v.ruleLabel }}</td>
            </tr>
          </tbody>
        </table>

        <div class="actions">
          <button type="button" @click="loadDraftToForm(batch.id)">载入表单修改</button>
          <button type="button" class="danger" @click="discardBatch(batch.id)">删除草稿</button>
        </div>
      </article>
    </div>
  </section>
</template>
