export const OBSERVATION_OUTCOMES=new Set(["clarification","source_conflict","recognition_invalid","identifiers_invalid","write_review","browser_incomplete","registration_verified","submission_unverified","draft_returned","failed"]);
export function failureCategory(error){
  const text=String(error?.code||"")+" "+String(error?.message||error||"");
  if(/ERR_MODULE_NOT_FOUND|MODULE_NOT_FOUND|Cannot find module/i.test(text))return "module_missing";
  if(/timeout|timed out|超时/i.test(text))return "timeout";
  if(/ECONN|ENOTFOUND|EPIPE|socket|WebSocket|fetch failed/i.test(text))return "connection";
  return "runtime";
}
export function browserOutcome(result,config){
  // Only record mode reaches submission-readback before diagnostics.stage=complete.
  if(result?.submitted&&result.ok&&result.verification?.ok&&!result.requiresReadback&&result.diagnostics?.stage==="complete"&&config?.entryMode==="record")return "registration_verified";
  if(result?.submitted||result?.submissionAttempted)return "submission_unverified";
  if(result?.awaitingWriteApproval||result?.requiresLocalReview)return "write_review";
  return "browser_incomplete";
}
