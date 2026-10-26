const DATE_PART_PATTERN = /^(\d{4})(\d{2})(\d{2})$/;

function validDatePart(value) {
  const match = String(value || "").match(DATE_PART_PATTERN);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

function validateIdentifier(value, { label, prefix, example }) {
  const text = String(value ?? "").trim();
  if (!text) {
    return `${label}为空，正确格式应为 ${prefix} + 8位日期 + 6位序号，例如 ${example}`;
  }
  const pattern = new RegExp(`^${prefix}(\\d{8})(\\d{6})$`);
  const match = text.match(pattern);
  if (!match || !validDatePart(match[1])) {
    return `${label}格式不正确：${text}。正确格式应为 ${prefix} + 8位日期 + 6位序号，例如 ${example}`;
  }
  return "";
}

export function validateTransactionNo(value) {
  return validateIdentifier(value, {
    label: "事务单号",
    prefix: "SJSW",
    example: "SJSW20261026000144",
  });
}

export function validateRoomTicketNo(value) {
  return validateIdentifier(value, {
    label: "机房单号",
    prefix: "JF",
    example: "JF20261026000072",
  });
}

export function validateDutyIdentifiers(fillCard = {}) {
  return [
    validateTransactionNo(fillCard.transactionNo),
    validateRoomTicketNo(fillCard.roomTicketNo),
  ].filter(Boolean);
}
