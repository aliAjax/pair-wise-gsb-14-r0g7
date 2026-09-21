/** 业务配置：区域、油品与价差规则参数，集中在此便于调整 */
export const REGIONS = ["华东", "华南", "华北", "西南"] as const;

export const FUELS = ["92号汽油", "95号汽油", "98号汽油", "柴油"] as const;

/** 批零价差审签规则 */
export const PRICE_RULES = {
  /** 保底毛利（元/升）：批零价差（加价幅度）不得低于该值 */
  minMargin: 0.3,
  /** 当日涨跌幅限制（%）：新价相对旧价的涨跌幅度不得超出 ±该值 */
  maxDailyChangePct: 5,
  unit: "元/升",
} as const;

export const STORAGE_KEY = "dfwlfront-9-price-desk-v1";
