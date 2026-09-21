import type { PriceBatch, PriceItem, RuleCode, RuleViolation } from "./types";
import { fmtTime } from "../utils/format";

/**
 * 审签规则配置（纯数据，调整阈值只改这里）。
 * minMargin：保底毛利，即加价幅度（批零价差）下限，元/升。
 * dailyLimitPct：当日涨跌幅上限，相对生效时刻在册旧价的百分比。
 */
export const RULES = {
  minMargin: 0.35,
  dailyLimitPct: 4
} as const;

export const RULE_LABELS: Record<RuleCode, string> = {
  overlap: "生效区间重叠",
  "min-margin": "低于保底毛利",
  "daily-limit": "超当日涨跌幅"
};

/** 已占用生效区间的明细：待生效 + 生效中。 */
export function occupiedItems(batches: PriceBatch[]): PriceItem[] {
  return batches
    .flatMap((batch) => batch.items)
    .filter((item) => item.status === "scheduled" || item.status === "effective");
}

/** 某区域+油品在 at 时刻的在册价格（生效时刻不晚于 at 的最新占用版本）。 */
export function projectedPriceAt(
  occupied: PriceItem[],
  region: string,
  fuel: string,
  at: string
): PriceItem | null {
  const atMs = Date.parse(at);
  let best: PriceItem | null = null;
  for (const item of occupied) {
    if (item.region !== region || item.fuel !== fuel) continue;
    const t = Date.parse(item.effectiveAt);
    if (t <= atMs && (!best || t > Date.parse(best.effectiveAt))) best = item;
  }
  return best;
}

/** 占用明细的生效区间终点：同区同油品下一个占用版本的生效时刻，没有则为 null（至今）。 */
export function intervalEnd(occupied: PriceItem[], item: PriceItem): string | null {
  const startMs = Date.parse(item.effectiveAt);
  let end: string | null = null;
  for (const other of occupied) {
    if (other.id === item.id || other.region !== item.region || other.fuel !== item.fuel) continue;
    const t = Date.parse(other.effectiveAt);
    if (t > startMs && (end === null || t < Date.parse(end))) end = other.effectiveAt;
  }
  return end;
}

/**
 * 批次整批校验。任一明细触发规则，整批留草稿。
 * 1. overlap：同区同油品的生效时刻不得与已占用区间或本批次其他明细重叠；
 * 2. min-margin：加价幅度不得低于保底毛利；
 * 3. daily-limit：相对生效时刻在册旧价的涨跌幅不得超过当日上限。
 */
export function validateBatch(batch: PriceBatch, allBatches: PriceBatch[]): RuleViolation[] {
  const occupied = occupiedItems(allBatches);
  const violations: RuleViolation[] = [];
  const seen = new Map<string, PriceItem>();

  for (const item of batch.items) {
    const key = `${item.region}|${item.fuel}|${item.effectiveAt}`;
    const dup = seen.get(key);
    seen.set(key, item);

    const clash = occupied.find(
      (o) => o.region === item.region && o.fuel === item.fuel && o.effectiveAt === item.effectiveAt
    );
    const prev = projectedPriceAt(occupied, item.region, item.fuel, item.effectiveAt);
    const oldPrice = prev ? prev.retailPrice : null;

    if (dup || clash) {
      const other = clash ?? dup;
      violations.push({
        itemId: item.id,
        rule: "overlap",
        detail: `与${clash ? "已占用调价" : "本批次另一明细"}同为 ${item.region}/${item.fuel}，生效时刻 ${fmtTime(item.effectiveAt)} 重叠`,
        oldPrice: other ? other.retailPrice : null,
        newPrice: item.retailPrice
      });
    }

    if (item.markup < RULES.minMargin) {
      violations.push({
        itemId: item.id,
        rule: "min-margin",
        detail: `加价幅度 ${item.markup.toFixed(2)} 元/升，低于保底毛利 ${RULES.minMargin.toFixed(2)} 元/升`,
        oldPrice,
        newPrice: item.retailPrice
      });
    }

    if (oldPrice !== null && oldPrice > 0) {
      const pct = (Math.abs(item.retailPrice - oldPrice) / oldPrice) * 100;
      if (pct > RULES.dailyLimitPct) {
        violations.push({
          itemId: item.id,
          rule: "daily-limit",
          detail: `较旧价 ${oldPrice.toFixed(2)} 元/升涨跌幅 ${pct.toFixed(1)}%，超过当日上限 ${RULES.dailyLimitPct}%`,
          oldPrice,
          newPrice: item.retailPrice
        });
      }
    }
  }

  return violations;
}
