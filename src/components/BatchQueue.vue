<script setup lang="ts">
import { computed, reactive } from "vue";
import {
  ACTION_LABELS,
  BATCH_STATUS_LABELS,
  FUELS,
  ITEM_STATUS_LABELS,
  REGIONS,
  type PriceBatch,
  type PriceItem
} from "../domain/types";
import { RULE_LABELS } from "../domain/rules";
import { useDesk } from "../state/desk";
import { fmtMoney, fmtTime, fromInputValue, toInputValue } from "../utils/format";

const desk = useDesk();
const batches = desk.batches;
const opinions = reactive<Record<string, string>>({});

function itemLabel(batch: PriceBatch, itemId: string): string {
  const item = batch.items.find((i) => i.id === itemId);
  return item ? `${item.region} / ${item.fuel} / ${fmtTime(item.effectiveAt)}` : "已移除明细";
}

function onTimeChange(batch: PriceBatch, item: PriceItem, e: Event): void {
  const value = (e.target as HTMLInputElement).value;
  if (value) item.effectiveAt = fromInputValue(value);
  desk.touchItem(batch, item);
}

const chartRows = computed(() =>
  (Object.keys(BATCH_STATUS_LABELS) as Array<keyof typeof BATCH_STATUS_LABELS>).map((status) => ({
    label: BATCH_STATUS_LABELS[status],
    value: batches.value.filter((b) => b.status === status).length
  }))
);
const maxChart = computed(() => Math.max(1, ...chartRows.value.map((row) => row.value)));
</script>

<template>
  <section class="list-panel">
    <div class="toolbar">
      <h2>批次队列</h2>
      <span class="muted">{{ batches.length }} 个批次</span>
    </div>

    <div v-if="batches.length === 0" class="empty">暂无调价批次</div>

    <div class="record-grid">
      <article v-for="batch in batches" :key="batch.id" class="record">
        <div class="record-head">
          <div>
            <p class="record-title">{{ batch.code }}</p>
            <p class="muted">
              创建于 {{ fmtTime(batch.createdAt) }} · {{ batch.items.length }} 条明细
              <template v-if="batch.items[0]?.reason"> · 改价原因：{{ batch.items[0].reason }}</template>
            </p>
          </div>
          <span class="badge" :class="batch.status">{{ BATCH_STATUS_LABELS[batch.status] }}</span>
        </div>

        <div v-if="batch.status === 'draft' && batch.violations.length > 0" class="violations">
          <h3>整批留草稿：触发 {{ batch.violations.length }} 条规则</h3>
          <div class="table-wrap">
            <table class="grid">
              <thead>
                <tr><th>明细</th><th>旧价</th><th>新价</th><th>触发规则</th></tr>
              </thead>
              <tbody>
                <tr v-for="(v, i) in batch.violations" :key="`${v.itemId}-${v.rule}-${i}`">
                  <td>{{ itemLabel(batch, v.itemId) }}</td>
                  <td>{{ fmtMoney(v.oldPrice) }}</td>
                  <td>{{ fmtMoney(v.newPrice) }}</td>
                  <td><span class="badge rejected">{{ RULE_LABELS[v.rule] }}</span> {{ v.detail }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div class="table-wrap">
          <table class="grid">
            <thead>
              <tr>
                <th>区域</th><th>油品</th><th>基准价</th><th>加价幅度</th>
                <th>零售价</th><th>生效时刻</th><th>状态</th>
                <th v-if="batch.status === 'draft' || batch.status === 'approved'">操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="item in batch.items" :key="item.id">
                <template v-if="batch.status === 'draft'">
                  <td>
                    <select v-model="item.region" @change="desk.touchItem(batch, item)">
                      <option v-for="r in REGIONS" :key="r" :value="r">{{ r }}</option>
                    </select>
                  </td>
                  <td>
                    <select v-model="item.fuel" @change="desk.touchItem(batch, item)">
                      <option v-for="f in FUELS" :key="f" :value="f">{{ f }}</option>
                    </select>
                  </td>
                  <td>
                    <input
                      v-model.number="item.basePrice"
                      type="number" step="0.01" min="0"
                      @change="desk.touchItem(batch, item)"
                    />
                  </td>
                  <td>
                    <input
                      v-model.number="item.markup"
                      type="number" step="0.01" min="0"
                      @change="desk.touchItem(batch, item)"
                    />
                  </td>
                  <td>{{ fmtMoney(item.retailPrice) }}</td>
                  <td>
                    <input
                      type="datetime-local"
                      :value="toInputValue(item.effectiveAt)"
                      @change="onTimeChange(batch, item, $event)"
                    />
                  </td>
                  <td><span class="badge draft">{{ ITEM_STATUS_LABELS[item.status] }}</span></td>
                  <td>
                    <button type="button" class="danger" @click="desk.removeDraftItem(batch.id, item.id)">
                      移除
                    </button>
                  </td>
                </template>
                <template v-else>
                  <td>{{ item.region }}</td>
                  <td>{{ item.fuel }}</td>
                  <td>{{ fmtMoney(item.basePrice) }}</td>
                  <td>{{ fmtMoney(item.markup) }}</td>
                  <td>{{ fmtMoney(item.retailPrice) }}</td>
                  <td>{{ fmtTime(item.effectiveAt) }}</td>
                  <td><span class="badge" :class="item.status">{{ ITEM_STATUS_LABELS[item.status] }}</span></td>
                  <td v-if="batch.status === 'approved'">
                    <button
                      v-if="item.status === 'scheduled'"
                      type="button"
                      class="secondary"
                      @click="desk.withdrawItem(item.id)"
                    >
                      撤回
                    </button>
                    <span v-else class="muted">—</span>
                  </td>
                </template>
              </tr>
            </tbody>
          </table>
        </div>

        <ul class="timeline">
          <li v-for="rec in batch.approvals" :key="rec.id">
            <strong>{{ ACTION_LABELS[rec.action] }}</strong> · {{ rec.actor }} · {{ fmtTime(rec.at) }}
            <br /><span>{{ rec.comment }}</span>
          </li>
        </ul>

        <div class="actions">
          <template v-if="batch.status === 'draft'">
            <button type="button" @click="desk.resubmitBatch(batch.id)">重新提交审签</button>
            <button type="button" class="danger" @click="desk.discardBatch(batch.id)">删除批次</button>
          </template>
          <template v-else-if="batch.status === 'pending'">
            <input
              v-model="opinions[batch.id]"
              class="opinion"
              placeholder="审批意见（可选）"
            />
            <button type="button" @click="desk.approveBatch(batch.id, opinions[batch.id] || '')">
              审批通过
            </button>
            <button type="button" class="danger" @click="desk.rejectBatch(batch.id, opinions[batch.id] || '')">
              驳回
            </button>
          </template>
          <template v-else-if="batch.status === 'rejected'">
            <button type="button" class="danger" @click="desk.discardBatch(batch.id)">删除批次</button>
          </template>
        </div>
      </article>
    </div>

    <div class="mini-chart">
      <div v-for="row in chartRows" :key="row.label" class="bar">
        <span>{{ row.label }}</span>
        <div class="bar-track"><div class="bar-fill" :style="{ width: `${(row.value / maxChart) * 100}%` }" /></div>
        <strong>{{ row.value }}</strong>
      </div>
    </div>
  </section>
</template>
