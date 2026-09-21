import { reactive } from "vue";
import { STORAGE_KEY } from "../domain/config";
import {
  currentPriceOf,
  isOccupying,
  newPriceOf,
  promoteDue,
  round2,
  validateItems,
} from "../domain/rules";
import type { ApprovalEntry, PriceBatch, PriceItem } from "../domain/types";

/**
 * 存储层：localStorage 持久化 + 响应式状态。
 * 批次是唯一事实来源，台账 / 占用 / 队列全部由它推导，刷新后队列与历史自然一致。
 */

interface PersistShape {
  version: 1;
  batches: PriceBatch[];
}

export interface StagedItem {
  region: string;
  fuel: string;
  benchmark: number;
  markup: number;
  effectiveAt: string;
}

interface StoreState {
  batches: PriceBatch[];
  /**  ticking clock，由页面定时器驱动，用于按期生效与倒计时 */
  now: Date;
  /** 草稿“载入表单”时的交接数据，表单组件消费后清空 */
  formSeed: { items: StagedItem[]; reason: string } | null;
}

function entry(action: ApprovalEntry["action"], actionLabel: string, operator: string, comment: string, at?: Date): ApprovalEntry {
  return {
    id: crypto.randomUUID(),
    action,
    actionLabel,
    operator,
    comment,
    at: (at ?? new Date()).toISOString(),
  };
}

function batchCode(createdAt: Date, existing: PriceBatch[]): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const day = `${createdAt.getFullYear()}${pad(createdAt.getMonth() + 1)}${pad(createdAt.getDate())}`;
  const seq = existing.filter((b) => b.code.startsWith(`PC-${day}-`)).length + 1;
  return `PC-${day}-${pad(seq)}`;
}

function seedBatches(): PriceBatch[] {
  const now = Date.now();
  const H = 3600_000;
  const D = 24 * H;
  const mk = (
    code: string,
    status: PriceBatch["status"],
    reason: string,
    createdBy: string,
    createdAt: number,
    items: Array<[string, string, number, number, number]>, // region, fuel, benchmark, markup, effectiveAt(epoch)
    approvals: ApprovalEntry[],
    oldPrice: number | null = null,
  ): PriceBatch => ({
    id: crypto.randomUUID(),
    code,
    reason,
    status,
    createdBy,
    createdAt: new Date(createdAt).toISOString(),
    violations: [],
    items: items.map(([region, fuel, benchmark, markup, effectiveAt]) => ({
      id: crypto.randomUUID(),
      region,
      fuel,
      benchmark,
      markup,
      oldPrice,
      newPrice: newPriceOf(benchmark, markup),
      effectiveAt: new Date(effectiveAt).toISOString(),
    })),
    approvals,
  });

  return [
    mk(
      "PC-SEED-01",
      "effective",
      "基准价联动调整",
      "站长",
      now - 2 * D,
      [["华东", "92号汽油", 7.1, 0.52, now - 2 * D + H]],
      [
        entry("submit", "提交审核", "站长", "基准价联动调整", new Date(now - 2 * D)),
        entry("approve", "审批通过", "区域经理", "价差合规，同意", new Date(now - 2 * D + H / 2)),
        entry("takeEffect", "按期生效", "系统", "到达生效时刻，自动生效", new Date(now - 2 * D + H)),
      ],
    ),
    mk(
      "PC-SEED-02",
      "effective",
      "柴油批零价差修复",
      "值班经理",
      now - D,
      [["华南", "柴油", 6.85, 0.33, now - D + H]],
      [
        entry("submit", "提交审核", "值班经理", "柴油批零价差修复", new Date(now - D)),
        entry("approve", "审批通过", "区域经理", "同意", new Date(now - D + H / 2)),
        entry("takeEffect", "按期生效", "系统", "到达生效时刻，自动生效", new Date(now - D + H)),
      ],
    ),
    mk(
      "PC-SEED-03",
      "pending",
      "跟涨基准价",
      "站长",
      now - 2 * H,
      [["华南", "95号汽油", 7.85, 0.45, now + D]],
      [entry("submit", "提交审核", "站长", "跟涨基准价", new Date(now - 2 * H))],
      8.18,
    ),
    mk(
      "PC-SEED-04",
      "approved",
      "华北首发挂牌",
      "运营专员",
      now - H,
      [["华北", "92号汽油", 7.2, 0.4, now + 3 * 60_000]],
      [
        entry("submit", "提交审核", "运营专员", "华北首发挂牌", new Date(now - H)),
        entry("approve", "审批通过", "区域经理", "首发价，同意", new Date(now - H / 2)),
      ],
    ),
    mk(
      "PC-SEED-05",
      "draft",
      "98号汽油试算",
      "站长",
      now - H / 2,
      [["西南", "98号汽油", 8.6, 0.1, now + D]],
      [entry("submit", "提交审核", "站长", "校验未通过，整批留草稿", new Date(now - H / 2))],
    ),
  ];
}

function load(): PriceBatch[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return seedBatches();
    const parsed = JSON.parse(raw) as PersistShape;
    if (!parsed || !Array.isArray(parsed.batches)) return seedBatches();
    return parsed.batches;
  } catch {
    return seedBatches();
  }
}

function persist() {
  const shape: PersistShape = { version: 1, batches: state.batches };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(shape));
}

export const state = reactive<StoreState>({
  batches: [],
  now: new Date(),
  formSeed: null,
});

/** 时钟推进：刷新“按期生效”，有变化即落库，保证刷新后队列与历史一致 */
export function tick() {
  state.now = new Date();
  const { batches, promoted } = promoteDue(state.batches, state.now);
  if (promoted.length > 0) {
    state.batches = batches;
    persist();
  }
}

export function initStore() {
  state.batches = load();
  tick();
  persist();
}

export interface SubmitResult {
  batch: PriceBatch;
  message: string;
}

/** 提交调价批次：整批校验，违规则整批留草稿，通过则进入审批队列 */
export function submitBatch(staged: StagedItem[], reason: string, operator: string): SubmitResult {
  tick();
  const createdAt = new Date();
  const items: PriceItem[] = staged.map((s) => ({
    id: crypto.randomUUID(),
    region: s.region,
    fuel: s.fuel,
    benchmark: round2(s.benchmark),
    markup: round2(s.markup),
    oldPrice: currentPriceOf(state.batches, s.region, s.fuel, state.now),
    newPrice: newPriceOf(s.benchmark, s.markup),
    effectiveAt: new Date(s.effectiveAt).toISOString(),
  }));

  const violations = validateItems(items, state.batches, state.now);
  const batch: PriceBatch = {
    id: crypto.randomUUID(),
    code: batchCode(createdAt, state.batches),
    reason,
    items,
    violations,
    status: violations.length > 0 ? "draft" : "pending",
    createdBy: operator,
    createdAt: createdAt.toISOString(),
    approvals: [
      entry(
        "submit",
        "提交审核",
        operator,
        violations.length > 0 ? `校验未通过（${violations.length} 条），整批留草稿` : "校验通过，进入审批队列",
        createdAt,
      ),
    ],
  };
  state.batches = [batch, ...state.batches];
  persist();
  return {
    batch,
    message:
      violations.length > 0
        ? `批次 ${batch.code} 触发 ${violations.length} 条规则，整批已留草稿，请在审签台查看旧价、新价与触发规则。`
        : `批次 ${batch.code} 校验通过，已进入审批队列。`,
  };
}

export function approveBatch(id: string, operator: string, comment: string) {
  state.batches = state.batches.map((b) =>
    b.id === id && b.status === "pending"
      ? { ...b, status: "approved", approvals: [...b.approvals, entry("approve", "审批通过", operator, comment || "同意")] }
      : b,
  );
  persist();
  tick();
}

export function rejectBatch(id: string, operator: string, comment: string) {
  state.batches = state.batches.map((b) =>
    b.id === id && b.status === "pending"
      ? { ...b, status: "rejected", approvals: [...b.approvals, entry("reject", "审批驳回", operator, comment || "驳回")] }
      : b,
  );
  persist();
}

/** 生效前撤回：释放同区同油品的区间占用 */
export function withdrawBatch(id: string, operator: string, comment: string) {
  state.batches = state.batches.map((b) =>
    b.id === id && (b.status === "pending" || b.status === "approved")
      ? { ...b, status: "withdrawn", approvals: [...b.approvals, entry("withdraw", "撤回", operator, comment || "生效前撤回，释放占用")] }
      : b,
  );
  persist();
}

export function discardBatch(id: string) {
  state.batches = state.batches.filter((b) => !(b.id === id && b.status === "draft"));
  persist();
}

/** 草稿载入表单：明细与原因交接给表单，草稿本体移除 */
export function loadDraftToForm(id: string) {
  const draft = state.batches.find((b) => b.id === id && b.status === "draft");
  if (!draft) return;
  state.formSeed = {
    reason: draft.reason,
    items: draft.items.map((i) => ({
      region: i.region,
      fuel: i.fuel,
      benchmark: i.benchmark,
      markup: i.markup,
      effectiveAt: i.effectiveAt,
    })),
  };
  discardBatch(id);
}

export function consumeFormSeed() {
  state.formSeed = null;
}

export function occupiedKeys(): Set<string> {
  const keys = new Set<string>();
  for (const b of state.batches) {
    if (!isOccupying(b)) continue;
    for (const i of b.items) keys.add(`${i.region}|${i.fuel}`);
  }
  return keys;
}
