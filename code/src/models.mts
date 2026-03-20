export interface ModelPullReportOutputFieldInfo {
  identifier: string;
  name: string;
  datatype: string;
  fields?: ModelPullReportOutputFieldInfo[];
}

export interface ModelPullReportInputInfo {
  name: string;
  datatype: string;
  validation_regex?: string;
  validation_message?: string;
}

export interface ModelPullReportOutputInfo {
  datatype: string;
  fields?: ModelPullReportOutputFieldInfo[];
}

export interface ModelPullResponse {
  data: any | undefined;
  error?: string;
}

export interface ModelPullReportInfo {
  name: string;
  input: ModelPullReportInputInfo[];
  output: ModelPullReportOutputInfo;
}

export interface ModelPushResponse {
  success: boolean;
  created?: number;
  altered?: number;
  deleted?: number;
  cancelled?: number;
  error?: string;
}

export interface VoucherLedgerEntry {
  ledgerName: string;
  amount: number;
  isDeemedPositive: boolean;
}
