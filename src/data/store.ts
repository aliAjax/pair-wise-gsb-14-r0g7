import type { ApprovalRecord, ApprovalAction, ItemStatus, PriceBatch, PriceItem } from "../domain/types";
import { validateBatch } from "../domain/rules";

const STORAGE_KEY = "dfwlfront-9-price-desk-v1";

export function loadBatches(): PriceBatch[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as PriceBatch[];
      if (Array.isArray(parsed)) return parsed;
    }
  } catch {
    // 数据损坏时回退到种子数据
  }
  return seedBatches();
}

export function saveBatches(batches: PriceBatch[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(batches));
}

let seq = 0;
function id(prefix: string): string {
  seq += 1;
  return `${prefix}-seed-${seq}`;
}

function seedBatches(): PriceBatch[] {
  const now = Date.now();
  const H = 3600_000;
  const at = (offsetH: number) => new Date(now + offsetH * H).toISOString();
  const t1 = at(-30); // 现行牌价生效时刻
  const t2 = at(30);  // 待生效调价
  const t3 = at(54);  // 待审批批次
  const t4 = at(60);  // 草稿批次

  const item = (
    region: string,
    fuel: string,
    basePrice: number,
    markup: number,
    effectiveAt: string,
    status: ItemStatus
  ): PriceItem => ({
    id: id("item"),
    region,
    fuel,
    basePrice,
    markup,
    retailPrice: Math.round((basePrice + markup) * 100) / 100,
    effectiveAt,
    status,
    reason: "",
    supersedesId: null
  });

  const rec = (action: ApprovalAction, actor: string, comment: string, atIso: string): ApprovalRecord => ({
    id: id("rec"),
    action,
    actor,
    comment,
    at: atIso
  });

  const approvedCurrent: PriceBatch = {
    id: id("batch"),
    code: "PC-SEED-01",
    status: "approved",
    items: [
      item("华东区", "92号汽油", 7.12, 0.5, t1, "effective"),
      item("华东区", "95号汽油", 7.55, 0.52, t1, "effective"),
      item("华南区", "92号汽油", 7.21, 0.5, t1, "effective"),
      item("华南区", "0号柴油", 6.78, 0.44, t1, "effective")
    ],
    violations: [],
    approvals: [
      rec("submit", "值班经理", "提交审签：月初基准价联动调整", at(-32)),
      rec("approve", "价格主管", "审批通过，按期生效", at(-31))
    ],
    createdAt: at(-32),
    updatedAt: at(-31)
  };

  const approvedScheduled: PriceBatch = {
    id: id("batch"),
    code: "PC-SEED-02",
    status: "approved",
    items: [item("华东区", "92号汽油", 7.15, 0.53, t2, "scheduled")],
    violations: [],
    approvals: [
      rec("submit", "值班经理", "提交审签：跟随原油基准价上调", at(-6)),
      rec("approve", "价格主管", "审批通过，按期生效", at(-5))
    ],
    createdAt: at(-6),
    updatedAt: at(-5)
  };

  const pending: PriceBatch = {
    id: id("batch"),
    code: "PC-SEED-03",
    status: "pending",
    items: [item("西南区", "98号汽油", 8.35, 0.55, t3, "pending")],
    violations: [],
    approvals: [rec("submit", "值班经理", "提交审签：西南区98号汽油挂牌", at(-2))],
    createdAt: at(-2),
    updatedAt: at(-2)
  };

  const draft: PriceBatch = {
    id: id("batch"),
    code: "PC-SEED-04",
    status: "draft",
    items: [
      item("华南区", "92号汽油", 7.3, 0.2, t4, "draft"),   // 触发保底毛利
      item("华东区", "92号汽油", 7.15, 0.53, t2, "draft"), // 与待生效调价区间重叠
      item("华东区", "95号汽油", 8.6, 0.6, t4, "draft")    // 触发当日涨跌幅
    ],
    violations: [],
    approvals: [rec("submit", "值班经理", "提交审签", at(-1))],
    createdAt: at(-1),
    updatedAt: at(-1)
  };
  draft.violations = validateBatch(draft, [approvedCurrent, approvedScheduled, pending]);

  return [draft, pending, approvedScheduled, approvedCurrent];
}
