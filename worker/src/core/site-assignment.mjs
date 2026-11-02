const names = (value) => String(value || "").split(/[、,，;；/\s]+/u).filter(Boolean);

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
  if (!assignment?.offsite) return { spec, assignment: null, skipHomeDraft: false };
  const homeAliases = config.site_rules?.home_site_aliases || [config.site_rules?.home_site];
  const isHome = (value) => homeAliases.filter(Boolean).some((alias) => String(value || "").trim() === alias);
  // Only fields extracted from the actual ticket are accepted, never a location inferred
  // from a default weekly row or an attendance swipe.
  const hasHomeTicket = isHome(fillCard?.location)
    && /^SJSW\d{14}$/.test(String(fillCard?.transactionNo || ""))
    && /^JF\d{14}$/.test(String(fillCard?.roomTicketNo || ""));
  if (!hasHomeTicket) {
    return { spec: { ...spec, weeklyRows: [], handoverRows: [] }, assignment, skipHomeDraft: true };
  }
  const rows = spec.weeklyRows || [];
  if (rows.length > 1 || rows.some((row) => !isHome(row[1])
    || (/^(?:\d+[、.\s]*)?(?:日常机房巡检|机房巡检|网络通报|系统通报|\d+月\d+日(?:白班|夜班)值班)$/.test(String(row[3]).trim()) && !String(fillCard.specificWork || "").includes(String(row[3]).trim())))) {
    throw new Error("异地安排当天只登记明确的本地站点实际工单，不能附加本地站点巡检、通报或值班记录，请核对工单草稿");
  }
  return { spec: { ...spec, handoverRows: [] }, assignment, skipHomeDraft: rows.length === 0 };
}
