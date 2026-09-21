import { computed, reactive } from "vue";
import type { ApprovalAction, FlatItem, PriceBatch, PriceItem } from "../domain/types";
import { validateBatch } from "../domain/rules";
import { loadBatches, saveBatches } from "../data/store";

export interface SubmitRow {
  region: string;
  fuel: string;
  basePrice: number;
  markup: number;
  effectiveAt: string; // ISO
}

const state = reactive({
  operator: "值班经理",
  batches: loadBatches()
});

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function nowIso(): string {
  return new Date().toISOString();
}

function persist(): void {
  saveBatches(state.batches);
}

function batchCode(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `PC-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${suffix}`;
}

function record(batch: PriceBatch, action: ApprovalAction, comment: string): void {
  batch.approvals.push({
    id: crypto.randomUUID(),
    action,
    actor: state.operator || "值班经理",
    at: nowIso(),
    comment
  });
  batch.updatedAt = nowIso();
}

function flat(): FlatItem[] {
  return state.batches.flatMap((batch) => batch.items.map((item) => ({ item, batch })));
}

const batches = computed(() =>
  state.batches.slice().sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
);

const occupied = computed(() =>
  flat()
    .filter((x) => x.item.status === "scheduled" || x.item.status === "effective")
    .map((x) => x.item)
);

/** 当前生效牌价：每个区域+油品取生效时刻最新的生效版本。 */
const currentPrices = computed<FlatItem[]>(() => {
  const map = new Map<string, FlatItem>();
  for (const x of flat()) {
    if (x.item.status !== "effective") continue;
    const key = `${x.item.region}|${x.item.fuel}`;
    const cur = map.get(key);
    if (!cur || Date.parse(x.item.effectiveAt) > Date.parse(cur.item.effectiveAt)) map.set(key, x);
  }
  return [...map.values()].sort(
    (a, b) =>
      a.item.region.localeCompare(b.item.region, "zh") || a.item.fuel.localeCompare(b.item.fuel, "zh")
  );
});

/** 待生效队列：已审批、占用区间、等到点生效。 */
const upcoming = computed<FlatItem[]>(() =>
  flat()
    .filter((x) => x.item.status === "scheduled")
    .sort((a, b) => Date.parse(a.item.effectiveAt) - Date.parse(b.item.effectiveAt))
);

/** 版本历史：某区域+油品全部已审签版本（含待生效、已撤回、已取代），按生效时刻倒序。 */
function historyOf(region: string, fuel: string): FlatItem[] {
  return flat()
    .filter(
      (x) =>
        x.item.region === region &&
        x.item.fuel === fuel &&
        ["scheduled", "effective", "superseded", "withdrawn"].includes(x.item.status)
    )
    .sort((a, b) => Date.parse(b.item.effectiveAt) - Date.parse(a.item.effectiveAt));
}

/** 校验并落状态：有违规整批留草稿，否则进入待审批。返回是否通过。 */
function applyValidation(batch: PriceBatch): boolean {
  const violations = validateBatch(batch, state.batches);
  batch.violations = violations;
  const ok = violations.length === 0;
  batch.status = ok ? "pending" : "draft";
  batch.items.forEach((item) => {
    item.status = ok ? "pending" : "draft";
  });
  return ok;
}

function submitBatch(rows: SubmitRow[], meta: { reason: string; supersedesId: string | null }): PriceBatch {
  const batch: PriceBatch = {
    id: crypto.randomUUID(),
    code: batchCode(),
    status: "draft",
    items: rows.map((row) => ({
      id: crypto.randomUUID(),
      region: row.region,
      fuel: row.fuel,
      basePrice: row.basePrice,
      markup: row.markup,
      retailPrice: round2(row.basePrice + row.markup),
      effectiveAt: row.effectiveAt,
      status: "draft",
      reason: meta.reason,
      supersedesId: meta.supersedesId
    })),
    violations: [],
    approvals: [],
    createdAt: nowIso(),
    updatedAt: nowIso()
  };
  const ok = applyValidation(batch);
  record(
    batch,
    "submit",
    ok
      ? `提交审签，校验通过${meta.reason ? `：${meta.reason}` : ""}`
      : `提交审签，触发 ${batch.violations.length} 条规则，整批留草稿`
  );
  state.batches.unshift(batch);
  persist();
  return batch;
}

function resubmitBatch(id: string): void {
  const batch = state.batches.find((b) => b.id === id);
  if (!batch || batch.status !== "draft") return;
  const ok = applyValidation(batch);
  record(batch, "resubmit", ok ? "修正后重新提交，待审批" : `重新提交仍触发 ${batch.violations.length} 条规则`);
  persist();
}

function approveBatch(id: string, comment: string): void {
  const batch = state.batches.find((b) => b.id === id);
  if (!batch || batch.status !== "pending") return;
  // 审批前复核：提交到审批之间占用与在册价可能已变化
  const violations = validateBatch(batch, state.batches);
  if (violations.length > 0) {
    batch.violations = violations;
    batch.status = "draft";
    batch.items.forEach((item) => {
      item.status = "draft";
    });
    record(batch, "return", `审批前复核触发 ${violations.length} 条规则，退回草稿`);
  } else {
    batch.violations = [];
    batch.status = "approved";
    batch.items.forEach((item) => {
      item.status = "scheduled";
    });
    record(batch, "approve", comment || "审批通过，按期生效");
    promoteDue();
  }
  persist();
}

function rejectBatch(id: string, comment: string): void {
  const batch = state.batches.find((b) => b.id === id);
  if (!batch || batch.status !== "pending") return;
  batch.status = "rejected";
  batch.items.forEach((item) => {
    item.status = "rejected";
  });
  record(batch, "reject", comment || "审批驳回");
  persist();
}

function discardBatch(id: string): void {
  const batch = state.batches.find((b) => b.id === id);
  if (!batch || (batch.status !== "draft" && batch.status !== "rejected")) return;
  state.batches = state.batches.filter((b) => b.id !== id);
  persist();
}

/** 草稿明细在线修正：重算零售价、清空过期违规、落库。 */
function touchItem(batch: PriceBatch, item: PriceItem): void {
  item.retailPrice = round2(Number(item.basePrice) + Number(item.markup));
  batch.violations = [];
  batch.updatedAt = nowIso();
  persist();
}

function removeDraftItem(batchId: string, itemId: string): void {
  const batch = state.batches.find((b) => b.id === batchId);
  if (!batch || batch.status !== "draft") return;
  batch.items = batch.items.filter((item) => item.id !== itemId);
  batch.violations = [];
  if (batch.items.length === 0) {
    state.batches = state.batches.filter((b) => b.id !== batchId);
  }
  persist();
}

/** 生效前撤回：仅待生效明细可撤回，释放其占用的生效区间。 */
function withdrawItem(itemId: string): void {
  const hit = flat().find((x) => x.item.id === itemId);
  if (!hit || hit.item.status !== "scheduled") return;
  hit.item.status = "withdrawn";
  record(
    hit.batch,
    "withdraw",
    `撤回 ${hit.item.region}/${hit.item.fuel} ${hit.item.retailPrice.toFixed(2)} 元/升的待生效调价，释放占用区间`
  );
  persist();
}

/** 到点生效：待生效且生效时刻已过的明细转为生效中，同区同油品上一版转为已取代。 */
function promoteDue(): void {
  const now = Date.now();
  const due = flat()
    .filter((x) => x.item.status === "scheduled" && Date.parse(x.item.effectiveAt) <= now)
    .sort((a, b) => Date.parse(a.item.effectiveAt) - Date.parse(b.item.effectiveAt));
  if (due.length === 0) return;
  for (const { item } of due) {
    const prev = flat()
      .filter(
        (x) =>
          x.item.status === "effective" &&
          x.item.region === item.region &&
          x.item.fuel === item.fuel &&
          Date.parse(x.item.effectiveAt) < Date.parse(item.effectiveAt)
      )
      .sort((a, b) => Date.parse(b.item.effectiveAt) - Date.parse(a.item.effectiveAt))[0];
    if (prev) prev.item.status = "superseded";
    item.status = "effective";
  }
  persist();
}

export function useDesk() {
  return {
    state,
    batches,
    occupied,
    currentPrices,
    upcoming,
    historyOf,
    submitBatch,
    resubmitBatch,
    approveBatch,
    rejectBatch,
    discardBatch,
    touchItem,
    removeDraftItem,
    withdrawItem,
    promoteDue,
    persist
  };
}
