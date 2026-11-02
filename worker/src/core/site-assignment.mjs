import { rosterNames as names } from "./roster-names.mjs";

export function resolveSiteAssignment({ row, headers, config, operator = config.operator_name }) {
  const rules = config.site_rules;
  if (!rules?.enabled) return null;
  const departments = rules.departments || [];
  const memberOf = departments.filter((group) => group.members?.includes(operator));
  if (memberOf.length !== 1) throw new Error("当前使用人的部门名单缺失或冲突，请核对人员配置");
  const department = memberOf[0];
  const matches = [];
  for (const group of departments) {
    for (const header of group.offsite_headers || []) {
      const index = headers.indexOf(header);
      if (index < 0) throw new Error(`在线排班缺少异地岗位列：${header}`);
      if (names(row[index]).includes(operator)) matches.push({ group, header });
    }
  }
  if (matches.length > 1 || (matches.length === 1 && matches[0].group.name !== department.name)) {
    throw new Error("当前使用人的异地岗位重复或与所属部门冲突，请核对排班");
  }
  const slot = matches[0]?.header || "";
  return {
    department: department.name,
    auxiliaryHeader: department.auxiliary_header,
    site: slot ? rules.offsite_site : "",
    offsite: Boolean(slot), slot,
    assignmentType: slot ? department.offsite_role : "",
    attendanceMayStartHome: Boolean(slot && department.attendance_may_start_home_slots?.includes(slot)),
    attendanceIsNotWorkLocation: true,
  };
}

export function applySiteRecordRules(spec, { context, fillCard, config }) {
  const entry = context.schedule?.find((item) => item.date === context.shiftDate);
  const assignment = entry?.role?.assignment;
  const standby = entry?.role?.role === "home_standby";
  if (!assignment?.offsite && !standby) return { spec, assignment: null, skipHomeDraft: false };
  const homeAliases = config.site_rules?.home_site_aliases || [config.site_rules?.home_site];
  const isHome = (value) => homeAliases.filter(Boolean).some((alias) => String(value || "").trim() === alias);
  // Only fields extracted from the actual ticket are accepted, never a location inferred
  // from a default weekly row or an attendance swipe.
  const hasHomeTicket = isHome(fillCard?.location)
    && /^SJSW\d{14}$/.test(String(fillCard?.transactionNo || ""))
    && /^JF\d{14}$/.test(String(fillCard?.roomTicketNo || ""));
  if (standby && (!hasHomeTicket || (spec.weeklyRows || []).length !== 1)) {
    throw new Error("待命本身不生成记录，只登记地点和单号明确的一条实际工单，请核对工单信息");
  }
  if (!hasHomeTicket) {
    return { spec: { ...spec, weeklyRows: [], handoverRows: [] }, assignment, skipHomeDraft: true };
  }
  const rows = spec.weeklyRows || [];
  if (rows.length > 1 || rows.some((row) => !isHome(row[1])
    || (/^(?:\d+[、.\s]*)?(?:日常机房巡检|机房巡检|网络通报|系统通报|\d+月\d+日(?:白班|夜班)值班)$/.test(String(row[3]).trim()) && !String(fillCard.specificWork || "").includes(String(row[3]).trim())))) {
    throw new Error("待命或异地安排时只登记明确的本地站点实际工单，不能附加巡检、通报或值班记录，请核对工单草稿");
  }
  return { spec: { ...spec, handoverRows: [] }, assignment, skipHomeDraft: rows.length === 0 };
}
