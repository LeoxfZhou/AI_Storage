export const TEMPLATE_VERSION = "2.0";
export const SUPPORTED_TEMPLATE_VERSIONS = ["1.0", TEMPLATE_VERSION];

// 标准流水的列顺序是两个程序之间的“数据契约”。
// 程序二按表头名称读取，因此以后可以增加列，但不要随意重命名现有列。
export const STANDARD_HEADERS = [
  "记录ID",
  "交易组ID",
  "日期",
  "候选日期范围",
  "人员",
  "账户",
  "金额",
  "币种",
  "交易类型",
  "分类",
  "对方",
  "备注",
  "数据状态",
  "异常原因",
  "原始日期",
  "原始描述",
  "来源工作表",
  "来源单元格",
  "导入规则",
];

// 1.0 模板仍然可以作为程序二的输入。读取器会把旧版“方向 + 正数金额”
// 转换成新版正负金额，避免用户以前生成的标准文件突然无法使用。
export const LEGACY_STANDARD_HEADERS = [
  "记录ID", "交易组ID", "日期", "人员", "账户", "交易类型", "方向", "金额",
  "币种", "分类", "对方", "备注", "数据状态", "异常原因", "原始日期",
  "原始描述", "来源工作表", "来源单元格", "导入规则",
];

export const TRANSACTION_TYPES = [
  "收入",
  "支出",
  "内部转账",
  "换汇",
  "借款",
  "还款",
  "期初余额",
  "调整",
];

export const DIRECTIONS = ["流入", "流出"];
export const CURRENCIES = ["CNY", "USD"];
export const DATA_STATUSES = ["有效", "待确认", "忽略"];

export const DEFAULT_PEOPLE = ["周", "红", "叶", "渊", "公共"];
export const DEFAULT_ACCOUNTS = [
  "人民币账户",
  "美元账户",
  "现金",
  "银行卡",
  "未指定账户",
];
export const DEFAULT_CATEGORIES = [
  "房租",
  "材料",
  "人工",
  "物流运输",
  "餐饮",
  "水电",
  "税费",
  "医疗",
  "设备维修",
  "往来款",
  "未分类",
];

export const COLORS = {
  navy: "#17324D",
  blue: "#2F75B5",
  paleBlue: "#D9EAF7",
  green: "#1F7A5C",
  paleGreen: "#E2F0D9",
  amber: "#F4B183",
  paleAmber: "#FFF2CC",
  red: "#C00000",
  paleRed: "#FCE4D6",
  gray: "#667085",
  paleGray: "#E7E6E6",
  white: "#FFFFFF",
};
