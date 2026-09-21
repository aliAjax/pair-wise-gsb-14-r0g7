<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import { FUELS, PRICE_RULES, REGIONS } from "../domain/config";
import { currentPriceOf, formatTime, money, newPriceOf } from "../domain/rules";
import { state, submitBatch, consumeFormSeed, occupiedKeys, type StagedItem } from "../storage/store";

function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const blank = () => ({
  region: "",
  fuel: "",
  benchmark: 0,
  markup: 0,
  effectiveAt: toLocalInput(new Date(state.now.getTime() + 3600_000)),
});

const item = reactive(blank());
const staged = ref<StagedItem[]>([]);
const reason = ref("");
const operator = ref("站长");
const message = ref("");

// 草稿载入表单：审签台“载入修改”时接管明细与原因
watch(
  () => state.formSeed,
  (seed) => {
    if (!seed) return;
    staged.value = seed.items.map((s) => ({ ...s, effectiveAt: toLocalInput(new Date(s.effectiveAt)) }));
    reason.value = seed.reason;
    message.value = "草稿已载入表单，请修正后重新提交。";
    consumeFormSeed();
  },
  { immediate: true },
);

const oldPrice = computed(() =>
  item.region && item.fuel ? currentPriceOf(state.batches, item.region, item.fuel, state.now) : null,
);
const newPrice = computed(() => newPriceOf(Number(item.benchmark) || 0, Number(item.markup) || 0));
const changePct = computed(() => {
  if (oldPrice.value === null || oldPrice.value <= 0) return null;
  return ((newPrice.value - oldPrice.value) / oldPrice.value) * 100;
});
const occupied = computed(() => item.region && item.fuel && occupiedKeys().has(`${item.region}|${item.fuel}`));

const hints = computed(() => {
  const list: Array<{ ok: boolean; text: string }> = [];
  if (!item.region || !item.fuel) return list;
  if (occupied.value) list.push({ ok: false, text: "同区同油品已有未生效批次占用，提交将判区间重叠" });
  if ((Number(item.markup) || 0) < PRICE_RULES.minMargin)
    list.push({ ok: false, text: `批零价差低于保底毛利 ${PRICE_RULES.minMargin.toFixed(2)} 元/升` });
  if (changePct.value !== null && Math.abs(changePct.value) > PRICE_RULES.maxDailyChangePct)
    list.push({ ok: false, text: `涨跌幅超出当日限制 ±${PRICE_RULES.maxDailyChangePct}%` });
  if (list.length === 0) list.push({ ok: true, text: "当前明细通过价差与占用预检" });
  return list;
});

function addItem() {
  if (!item.region || !item.fuel || !item.effectiveAt) return;
  staged.value = [...staged.value, { ...item, benchmark: Number(item.benchmark), markup: Number(item.markup) }];
  Object.assign(item, blank());
}

function removeStaged(index: number) {
  staged.value = staged.value.filter((_, i) => i !== index);
}

function submit() {
  if (staged.value.length === 0 || !reason.value.trim() || !operator.value.trim()) return;
  const result = submitBatch(staged.value, reason.value.trim(), operator.value.trim());
  message.value = result.message;
  staged.value = [];
  reason.value = "";
}
</script>

<template>
  <form class="panel" @submit.prevent="submit">
    <h2>新建调价批次</h2>
    <p class="panel-tip">每笔调价选择区域、油品、基准价、加价幅度与生效时刻；新价 = 基准价 + 加价幅度。</p>

    <div class="form-grid">
      <label>
        区域
        <select v-model="item.region" required>
          <option value="">请选择</option>
          <option v-for="r in REGIONS" :key="r">{{ r }}</option>
        </select>
      </label>
      <label>
        油品
        <select v-model="item.fuel" required>
          <option value="">请选择</option>
          <option v-for="f in FUELS" :key="f">{{ f }}</option>
        </select>
      </label>
      <label>
        基准价（元/升）
        <input v-model.number="item.benchmark" type="number" step="0.01" min="0" required />
      </label>
      <label>
        加价幅度（元/升）
        <input v-model.number="item.markup" type="number" step="0.01" required />
      </label>
      <label>
        生效时刻
        <input v-model="item.effectiveAt" type="datetime-local" required />
      </label>

      <div class="preview">
        <div><span>当前旧价</span><strong>{{ money(oldPrice) }}</strong></div>
        <div><span>新价</span><strong>{{ money(newPrice) }}</strong></div>
        <div><span>批零价差</span><strong>{{ money(Number(item.markup) || 0) }}</strong></div>
        <div>
          <span>涨跌幅</span>
          <strong>{{ changePct === null ? "—" : `${changePct > 0 ? "+" : ""}${changePct.toFixed(2)}%` }}</strong>
        </div>
      </div>

      <ul class="hints">
        <li v-for="h in hints" :key="h.text" :class="{ bad: !h.ok }">{{ h.ok ? "✓" : "✕" }} {{ h.text }}</li>
        <li class="rule-ref">规则：保底毛利 ≥ {{ PRICE_RULES.minMargin.toFixed(2) }} 元/升；当日涨跌幅 ≤ ±{{ PRICE_RULES.maxDailyChangePct }}%；同区同油品生效区间不得重叠。</li>
      </ul>

      <button type="button" class="secondary" :disabled="!item.region || !item.fuel" @click="addItem">加入批次</button>

      <div v-if="staged.length > 0" class="staged">
        <p class="staged-title">本批明细（{{ staged.length }} 笔，整批校验、整批审批）</p>
        <div v-for="(s, i) in staged" :key="i" class="staged-row">
          <span>{{ s.region }} · {{ s.fuel }} · 新价 {{ money(newPriceOf(s.benchmark, s.markup)) }} · {{ formatTime(new Date(s.effectiveAt).toISOString()) }} 生效</span>
          <button type="button" class="danger mini" @click="removeStaged(i)">移除</button>
        </div>
      </div>

      <label>
        调价原因（必填，随版本与审批链保留）
        <textarea v-model="reason" placeholder="例如：基准价联动上调 / 价差修复" required />
      </label>
      <label>
        操作员
        <input v-model="operator" required />
      </label>
      <button type="submit" :disabled="staged.length === 0 || !reason.trim()">提交审核（{{ staged.length }} 笔）</button>
      <p v-if="message" class="form-message">{{ message }}</p>
    </div>
  </form>
</template>
