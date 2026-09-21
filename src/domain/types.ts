/** 批次状态：草稿 → 待审批 → 待生效 → 已生效；生效前可撤回，审批可驳回 */
export type BatchStatus =
  | "draft"
  | "pending"
  | "approved"
  | "effective"
  | "withdrawn"
  | "rejected";

export const STATUS_LABELS: Record<BatchStatus, string> = {
  draft: "草稿（待修正）",
  pending: "待审批",
  approved: "待生效",
  effective: "已生效",
  withdrawn: "已撤回",
  rejected: "已驳回",
};

/** 单笔调价明细：区域 + 油品 + 基准价 + 加价幅度 + 生效时刻 */
export interface PriceItem {
  id: string;
  region: string;
  fuel: string;
  /** 基准价（元/升） */
  benchmark: number;
  /** 加价幅度（元/升），即批零价差 */
  markup: number;
  /** 提交时锁定的旧价（当前生效价），无历史价为 null，旧值随版本永久保留 */
  oldPrice: number | null;
  /** 新价 = 基准价 + 加价幅度，提交时计算并固化 */
  newPrice: number;
  /** 生效时刻 ISO 字符串 */
  effectiveAt: string;
}

/** 触发规则编码 */
export type ViolationRule = "OVERLAP" | "MIN_MARGIN" | "DAILY_LIMIT";

/** 校验违规：列出旧价、新价和触发规则 */
export interface Violation {
  itemId: string;
  region: string;
  fuel: string;
  rule: ViolationRule;
  /** 触发规则描述 */
  ruleLabel: string;
  oldPrice: number | null;
  newPrice: number;
}

/** 审批链上的一环 */
export interface ApprovalEntry {
  id: string;
  action: "submit" | "approve" | "reject" | "withdraw" | "takeEffect";
  actionLabel: string;
  operator: string;
  comment: string;
  at: string;
}

/** 调价批次：整批校验、整批留草稿、整批审批 */
export interface PriceBatch {
  id: string;
  /** 批次号，如 PC-20260921-01 */
  code: string;
  /** 调价原因（必填，生效后改价只能新建带原因版本） */
  reason: string;
  items: PriceItem[];
  /** 校验未通过时的违规清单（整批留草稿的原因） */
  violations: Violation[];
  status: BatchStatus;
  createdBy: string;
  createdAt: string;
  /** 审批链，从提交到生效/撤回全程保留 */
  approvals: ApprovalEntry[];
}
