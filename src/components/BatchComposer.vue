<script setup lang="ts">
import { ref, watch } from "vue";
import { FUELS, REGIONS, type ReviseTarget } from "../domain/types";
import { RULES, projectedPriceAt } from "../domain/rules";
import { useDesk } from "../state/desk";
import { fmtMoney, fromInputValue, toInputValue } from "../utils/format";

const props = defineProps<{ reviseTarget: ReviseTarget | null }>();
const emit = defineEmits<{
  (e: "submitted"): void;
  (e: "cancel-revise"): void;
}>();

const desk = useDesk();

interface Row {
  region: string;
  fuel: string;
  basePrice: number | null;
  markup: number | null;
  effectiveAt: string; // datetime-local 值
}

function defaultTime(): string {
  return toInputValue(new Date(Date.now() + 3600_000).toISOString());
}

function blankRow(): Row {
  return { region: "", fuel: "", basePrice: null, markup: null, effectiveAt: defaultTime() };
}

const rows = ref<Row[]>([blankRow()]);
const reason = ref("");
const message = ref("");

watch(
  () => props.reviseTarget,
  (target) => {
    if (target) {
      rows.value = [
        { region: target.region, fuel: target.fuel, basePrice: null, markup: null, effectiveAt: defaultTime() }
      ];
      reason.value = "";
      message.value = "";
    } else {
      rows.value = [blankRow()];
      reason.value = "";
    }
  }
);

const occupied = desk.occupied;

function retailOf(row: Row): number | null {
  if (row.basePrice == null && row.markup == null) return null;
  return (Number(row.basePrice) || 0) + (Number(row.markup) || 0);
}

function oldPriceOf(row: Row): number | null {
  if (!row.region || !row.fuel || !row.effectiveAt) return null;
  const prev = projectedPriceAt(occupied.value, row.region, row.fuel, fromInputValue(row.effectiveAt));
  return prev ? prev.retailPrice : null;
}

/** 录入时的实时规则提示，正式校验以提交时规则引擎为准。 */
function rowHints(row: Row): string[] {
  const hints: string[] = [];
  if (row.basePrice == null || row.markup == null || !row.region || !row.fuel || !row.effectiveAt) {
    return hints;
  }
  if (row.markup < RULES.minMargin) {
    hints.push(`加价幅度低于保底毛利 ${RULES.minMargin.toFixed(2)} 元/升`);
  }
  const iso = fromInputValue(row.effectiveAt);
  const prev = projectedPriceAt(occupied.value, row.region, row.fuel, iso);
  if (prev) {
    const pct = (Math.abs((retailOf(row) ?? 0) - prev.retailPrice) / prev.retailPrice) * 100;
    if (pct > RULES.dailyLimitPct) {
      hints.push(`较旧价 ${prev.retailPrice.toFixed(2)} 涨跌幅 ${pct.toFixed(1)}%，超过当日上限 ${RULES.dailyLimitPct}%`);
    }
  }
  const clash = occupied.value.some(
    (o) => o.region === row.region && o.fuel === row.fuel && o.effectiveAt === iso
  );
  if (clash) hints.push("生效时刻与同区同油品已占用区间重叠");
  return hints;
}

function addRow(): void {
  rows.value.push(blankRow());
}

function removeRow(index: number): void {
  rows.value.splice(index, 1);
}

function submit(): void {
  const payload = rows.value.map((row) => ({
    region: row.region,
    fuel: row.fuel,
    basePrice: Number(row.basePrice),
    markup: Number(row.markup),
    effectiveAt: fromInputValue(row.effectiveAt)
  }));
  const batch = desk.submitBatch(payload, {
    reason: reason.value.trim(),
    supersedesId: props.reviseTarget?.itemId ?? null
  });
  message.value =
    batch.status === "draft"
      ? `批次 ${batch.code} 触发 ${batch.violations.length} 条规则，已整批留草稿，请在右侧队列修正后重新提交。`
      : `批次 ${batch.code} 校验通过，已提交待审批。`;
  rows.value = [blankRow()];
  reason.value = "";
  emit("submitted");
}
</script>

<template>
  <form class="panel" @submit.prevent="submit">
    <h2>{{ reviseTarget ? "改价 · 新建带原因版本" : "新建调价批次" }}</h2>

    <p v-if="reviseTarget" class="message">
      改价对象：{{ reviseTarget.region }} / {{ reviseTarget.fuel }}，现行价
      {{ reviseTarget.oldRetail.toFixed(2) }} 元/升（来源批次 {{ reviseTarget.batchCode }}）。
      旧值与审批链保留，新版本需重新审签后按期生效。
    </p>
    <p v-if="message" class="message">{{ message }}</p>

    <div v-for="(row, index) in rows" :key="index" class="item-row-wrap">
      <div class="item-row">
        <label>
          区域
          <select v-model="row.region" :disabled="!!reviseTarget" required>
            <option value="">请选择</option>
            <option v-for="r in REGIONS" :key="r" :value="r">{{ r }}</option>
          </select>
        </label>
        <label>
          油品
          <select v-model="row.fuel" :disabled="!!reviseTarget" required>
            <option value="">请选择</option>
            <option v-for="f in FUELS" :key="f" :value="f">{{ f }}</option>
          </select>
        </label>
        <label>
          基准价（元/升）
          <input v-model.number="row.basePrice" type="number" step="0.01" min="0" placeholder="7.12" required />
        </label>
        <label>
          加价幅度（元/升）
          <input v-model.number="row.markup" type="number" step="0.01" min="0" placeholder="0.50" required />
        </label>
        <label>
          生效时刻
          <input v-model="row.effectiveAt" type="datetime-local" required />
        </label>
        <div class="retail">
          <span>零售牌价</span>
          <strong>{{ fmtMoney(retailOf(row)) }}</strong>
          <small>旧价 {{ fmtMoney(oldPriceOf(row)) }}</small>
        </div>
        <button
          v-if="!reviseTarget && rows.length > 1"
          type="button"
          class="danger"
          @click="removeRow(index)"
        >
          删除
        </button>
      </div>
      <p v-for="hint in rowHints(row)" :key="hint" class="hint">⚠ {{ hint }}</p>
    </div>

    <div v-if="!reviseTarget" class="actions">
      <button type="button" class="secondary" @click="addRow">添加明细</button>
    </div>

    <label v-if="reviseTarget">
      改价原因（必填）
      <textarea v-model="reason" required placeholder="说明本次改价原因，将随版本与审批链留痕" />
    </label>
    <label v-else>
      批次备注（可选）
      <textarea v-model="reason" placeholder="填写调价背景或说明" />
    </label>

    <button type="submit">{{ reviseTarget ? "提交改价版本" : "提交审签" }}</button>
    <button v-if="reviseTarget" type="button" class="secondary" @click="emit('cancel-revise')">
      取消改价
    </button>
  </form>
</template>
