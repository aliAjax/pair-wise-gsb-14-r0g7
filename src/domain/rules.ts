import { PRICE_RULES } from "./config";
import type { PriceBatch, PriceItem, Violation } from "./types";

/**
 * 规则引擎：纯函数，不依赖框架与存储。
 * 占用模型：待审批 / 待生效批次按（区域+油品）占用 [生效时刻, ∞) 的未来区间，
 * 同区同油品在任一时刻只允许一条占用，撤回或生效后占用释放。
 */

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function itemKey(region: string, fuel: string): string {
  return `${region}|${fuel}`;
}

export function newPriceOf(benchmark: number, markup: number): number {
  return round2(benchmark + markup);
}

/** 批次是否占用着未来生效区间 */
export function isOccupying(batch: PriceBatch): boolean {
  return batch.status === "pending" || batch.status === "approved";
}

export function canApprove(batch: PriceBatch): boolean {
  return batch.status === "pending";
}

export function canReject(batch: PriceBatch): boolean {
  return batch.status === "pending";
}

/** 生效前（待审批 / 待生效）可撤回，撤回即释放占用 */
export function canWithdraw(batch: PriceBatch): boolean {
  return batch.status === "pending" || batch.status === "approved";
}

/** 批次内全部明细的生效时刻都已到达 */
export function isDue(batch: PriceBatch, now: Date): boolean {
  return batch.items.every((item) => new Date(item.effectiveAt).getTime() <= now.getTime());
}

export interface CurrentPrice {
  region: string;
  fuel: string;
  item: PriceItem;
  batchCode: string;
}

/** 当前生效价台账：每个 区域+油品 取生效时刻最新且已到期的一条 */
export function currentPrices(batches: PriceBatch[], now: Date): CurrentPrice[] {
  const latest = new Map<string, CurrentPrice>();
  for (const batch of batches) {
    if (batch.status !== "effective") continue;
    for (const item of batch.items) {
      if (new Date(item.effectiveAt).getTime() > now.getTime()) continue;
      const key = itemKey(item.region, item.fuel);
      const prev = latest.get(key);
      if (!prev || new Date(prev.item.effectiveAt).getTime() < new Date(item.effectiveAt).getTime()) {
        latest.set(key, { region: item.region, fuel: item.fuel, item, batchCode: batch.code });
      }
    }
  }
  return [...latest.values()].sort((a, b) => itemKey(a.region, a.fuel).localeCompare(itemKey(b.region, b.fuel), "zh"));
}

export function currentPriceOf(batches: PriceBatch[], region: string, fuel: string, now: Date): number | null {
  const hit = currentPrices(batches, now).find((p) => p.region === region && p.fuel === fuel);
  return hit ? hit.item.newPrice : null;
}

/** 某 区域+油品 的已生效版本，按生效时刻升序（用于推算生效区间） */
export function effectiveVersions(batches: PriceBatch[], region: string, fuel: string): PriceItem[] {
  return batches
    .filter((b) => b.status === "effective")
    .flatMap((b) => b.items)
    .filter((i) => i.region === region && i.fuel === fuel)
    .sort((a, b) => new Date(a.effectiveAt).getTime() - new Date(b.effectiveAt).getTime());
}

/**
 * 校验一批明细，返回违规清单；非空则整批留草稿。
 * 规则一：同区同油品生效区间不得重叠（已有未生效占用或本批内重复）。
 * 规则二：批零价差（加价幅度）不得低于保底毛利。
 * 规则三：相对旧价的涨跌幅不得超过当日限制（无旧价时不校验）。
 */
export function validateItems(items: PriceItem[], batches: PriceBatch[], now: Date): Violation[] {
  const violations: Violation[] = [];
  const seenInBatch = new Set<string>();

  for (const item of items) {
    const key = itemKey(item.region, item.fuel);
    const oldPrice = item.oldPrice;

    // 规则一：区间重叠 —— 本批次内部重复
    if (seenInBatch.has(key)) {
      violations.push({
        itemId: item.id,
        region: item.region,
        fuel: item.fuel,
        rule: "OVERLAP",
        ruleLabel: `本批次内「${item.region}·${item.fuel}」重复，生效区间互相重叠`,
        oldPrice,
        newPrice: item.newPrice,
      });
    }
    seenInBatch.add(key);

    // 规则一：区间重叠 —— 已被其他未生效批次占用
    for (const other of batches) {
      if (!isOccupying(other)) continue;
      const occupied = other.items.find((i) => i.region === item.region && i.fuel === item.fuel);
      if (occupied) {
        violations.push({
          itemId: item.id,
          region: item.region,
          fuel: item.fuel,
          rule: "OVERLAP",
          ruleLabel: `「${item.region}·${item.fuel}」自 ${formatTime(occupied.effectiveAt)} 起的生效区间已被批次 ${other.code} 占用`,
          oldPrice,
          newPrice: item.newPrice,
        });
        break;
      }
    }

    // 规则二：保底毛利
    if (item.markup < PRICE_RULES.minMargin) {
      violations.push({
        itemId: item.id,
        region: item.region,
        fuel: item.fuel,
        rule: "MIN_MARGIN",
        ruleLabel: `批零价差 ${item.markup.toFixed(2)} 元/升 低于保底毛利 ${PRICE_RULES.minMargin.toFixed(2)} 元/升`,
        oldPrice,
        newPrice: item.newPrice,
      });
    }

    // 规则三：当日涨跌幅
    if (oldPrice !== null && oldPrice > 0) {
      const changePct = ((item.newPrice - oldPrice) / oldPrice) * 100;
      if (Math.abs(changePct) > PRICE_RULES.maxDailyChangePct) {
        violations.push({
          itemId: item.id,
          region: item.region,
          fuel: item.fuel,
          rule: "DAILY_LIMIT",
          ruleLabel: `涨跌幅 ${changePct > 0 ? "+" : ""}${changePct.toFixed(2)}% 超过当日限制 ±${PRICE_RULES.maxDailyChangePct}%`,
          oldPrice,
          newPrice: item.newPrice,
        });
      }
    }
  }
  return violations;
}

/** 审批通过后按期生效：把已到期批次从 待生效 推进为 已生效，并补上审批链记录 */
export function promoteDue(batches: PriceBatch[], now: Date): { batches: PriceBatch[]; promoted: PriceBatch[] } {
  const promoted: PriceBatch[] = [];
  const next = batches.map((batch) => {
    if (batch.status !== "approved" || !isDue(batch, now)) return batch;
    const updated: PriceBatch = {
      ...batch,
      status: "effective",
      approvals: [
        ...batch.approvals,
        {
          id: crypto.randomUUID(),
          action: "takeEffect",
          actionLabel: "按期生效",
          operator: "系统",
          comment: "到达生效时刻，自动生效",
          at: now.toISOString(),
        },
      ],
    };
    promoted.push(updated);
    return updated;
  });
  return { batches: next, promoted };
}

export function formatTime(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function money(n: number | null | undefined): string {
  return n === null || n === undefined ? "—" : n.toFixed(2);
}
