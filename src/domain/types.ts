export const REGIONS = ["华东区", "华南区", "华北区", "西南区"] as const;
export const FUELS = ["92号汽油", "95号汽油", "98号汽油", "0号柴油"] as const;

export type ItemStatus =
  | "draft"      // 草稿（批次未通过校验或未提交）
  | "pending"    // 待审批
  | "scheduled"  // 待生效（已占用生效区间）
  | "effective"  // 生效中
  | "withdrawn"  // 已撤回（生效前撤回，释放占用）
  | "superseded" // 已被新版本取代
  | "rejected";  // 已驳回

export type BatchStatus = "draft" | "pending" | "approved" | "rejected";

export type RuleCode = "overlap" | "min-margin" | "daily-limit";

export type ApprovalAction =
  | "submit"   // 提交审签
  | "resubmit" // 修正后重新提交
  | "approve"  // 审批通过
  | "reject"   // 审批驳回
  | "return"   // 审批前复核未过，退回草稿
  | "withdraw";// 撤回占用

export interface PriceItem {
  id: string;
  region: string;
  fuel: string;
  basePrice: number;      // 基准价（元/升）
  markup: number;         // 加价幅度（元/升），即批零价差
  retailPrice: number;    // 零售牌价 = 基准价 + 加价幅度
  effectiveAt: string;    // 生效时刻 ISO
  status: ItemStatus;
  reason: string;         // 改价原因（生效后改价必填）
  supersedesId: string | null; // 改价版本指向的旧版本
}

export interface ApprovalRecord {
  id: string;
  action: ApprovalAction;
  actor: string;
  at: string;
  comment: string;
}

export interface RuleViolation {
  itemId: string;
  rule: RuleCode;
  detail: string;
  oldPrice: number | null; // 旧价（无历史价时为 null）
  newPrice: number;        // 新价
}

export interface PriceBatch {
  id: string;
  code: string;
  status: BatchStatus;
  items: PriceItem[];
  violations: RuleViolation[];
  approvals: ApprovalRecord[]; // 审批链，全程留痕
  createdAt: string;
  updatedAt: string;
}

export interface FlatItem {
  item: PriceItem;
  batch: PriceBatch;
}

export interface ReviseTarget {
  itemId: string;
  region: string;
  fuel: string;
  oldRetail: number;
  batchCode: string;
}

export const ITEM_STATUS_LABELS: Record<ItemStatus, string> = {
  draft: "草稿",
  pending: "待审批",
  scheduled: "待生效",
  effective: "生效中",
  withdrawn: "已撤回",
  superseded: "已取代",
  rejected: "已驳回"
};

export const BATCH_STATUS_LABELS: Record<BatchStatus, string> = {
  draft: "草稿",
  pending: "待审批",
  approved: "已审批",
  rejected: "已驳回"
};

export const ACTION_LABELS: Record<ApprovalAction, string> = {
  submit: "提交审签",
  resubmit: "重新提交",
  approve: "审批通过",
  reject: "审批驳回",
  return: "退回草稿",
  withdraw: "撤回占用"
};
