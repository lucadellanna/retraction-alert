export type ArticleStatus =
  | "ok"
  | "retracted"
  | "expression_of_concern"
  | "withdrawn"
  | "unknown";

export interface StatusResult {
  status: ArticleStatus;
  label?: string;
  noticeUrl?: string;
  title?: string;
}

export interface AlertEntry {
  id: string;
  status: ArticleStatus;
  noticeUrl?: string;
  label?: string;
  title?: string;
}

export interface ReferenceCheckResult {
  alerts: AlertEntry[];
  checked: number;
  totalFound: number;
  failedChecks: number;
  counts: Record<ArticleStatus, number>;
}
