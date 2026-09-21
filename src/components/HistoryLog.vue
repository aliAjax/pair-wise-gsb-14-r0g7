<script setup lang="ts">
import { computed, ref } from "vue";
import { FUELS } from "../domain/config";
import { currentPrices, formatTime, money } from "../domain/rules";
import { STATUS_LABELS } from "../domain/types";
import { state } from "../storage/store";

const ledger = computed(() => currentPrices(state.batches, state.now));

const history = computed(() =>
  state.batches
    .filter((b) => b.status === "effective" || b.status === "withdrawn" || b.status === "rejected")
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
);

const fuelFilter = ref("全部油品");
const filters = computed(() => ["全部油品", ...FUELS]);
const filteredHistory = computed(() =>
  fuelFilter.value === "全部油品"
    ? history.value
    : history.value.filter((b) => b.items.some((i) => i.fuel === fuelFilter.value)),
);
</script>

<template>
  <section class="list-panel history-panel">
    <div class="toolbar">
      <h2>价格台账与历史版本</h2>
      <select v-model="fuelFilter">
        <option v-for="f in filters" :key="f">{{ f }}</option>
      </select>
    </div>

    <h3 class="section-title">当前生效价（{{ ledger.length }} 个区域·油品）</h3>
    <table class="items-table ledger-table">
      <thead>
        <tr><th>区域</th><th>油品</th><th>基准价</th><th>加价幅度</th><th>当前价</th><th>生效区间起点</th><th>来源批次</th></tr>
      </thead>
      <tbody>
        <tr v-for="p in ledger" :key="`${p.region}-${p.fuel}`">
          <td>{{ p.region }}</td>
          <td>{{ p.fuel }}</td>
          <td>{{ money(p.item.benchmark) }}</td>
          <td>{{ p.item.markup >= 0 ? "+" : "" }}{{ money(p.item.markup) }}</td>
          <td><strong>{{ money(p.item.newPrice) }}</strong></td>
          <td>{{ formatTime(p.item.effectiveAt) }} 起</td>
          <td><span class="code">{{ p.batchCode }}</span></td>
        </tr>
        <tr v-if="ledger.length === 0"><td colspan="7" class="empty">暂无生效价格</td></tr>
      </tbody>
    </table>

    <h3 class="section-title">历史版本与审批链（旧值保留，已生效批次不可改）</h3>
    <p class="panel-tip">生效后如需改价，请在左侧新建带调价原因的版本；旧值与审批链全程留痕。</p>
    <div class="record-grid">
      <div v-if="filteredHistory.length === 0" class="empty">暂无历史记录</div>
      <article v-for="batch in filteredHistory" :key="batch.id" class="record">
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

        <ol class="chain">
          <li v-for="a in batch.approvals" :key="a.id">
            <strong>{{ a.actionLabel }}</strong> · {{ a.operator }} · {{ formatTime(a.at) }}<span v-if="a.comment"> — {{ a.comment }}</span>
          </li>
        </ol>
      </article>
    </div>
  </section>
</template>
