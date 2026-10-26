const HELP_HINTS = Object.freeze([
  "怎么",
  "如何",
  "怎样",
  "用法",
  "使用",
  "触发",
  "关键词",
  "指令",
  "命令",
  "帮助",
  "说明",
  "介绍",
  "help",
  "usage",
  "howto",
  "command",
  "keyword",
]);

const LIST_HINTS = Object.freeze([
  "有哪些",
  "列表",
  "全部",
  "所有",
  "能做什么",
  "功能列表",
  "所有指令",
  "全部命令",
]);

function normalizeHelpText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[\uFF01-\uFF5E]/g, (character) => (
      String.fromCharCode(character.charCodeAt(0) - 0xFEE0)
    ))
    .replace(/[^\p{L}\p{N}]/gu, "");
}

function createHelpRouter({
  features,
  fullHelp,
  replyText,
} = {}) {
  if (!Array.isArray(features) || !fullHelp || typeof replyText !== "function") {
    throw new Error("help router 参数不完整");
  }

  return async function handleHelpQuery(frame, prompt) {
    const raw = String(prompt || "").trim();
    if (!raw) return false;
    const normalized = normalizeHelpText(raw);
    if (!normalized) return false;

    if (/^\/help\b/i.test(raw)) {
      const rest = normalized.replace(/^\/?help/, "");
      const target = features.find((feature) => (
        feature.aliases.some((alias) => rest.includes(normalizeHelpText(alias)))
      ));
      await replyText(frame, target ? target.usage : fullHelp).catch(() => {});
      return true;
    }

    const isHelp = HELP_HINTS.some((hint) => (
      normalized.includes(normalizeHelpText(hint))
    ));
    const isList = LIST_HINTS.some((hint) => (
      normalized.includes(normalizeHelpText(hint))
    ));
    const exactFeature = features.find((feature) => (
      feature.aliases.some((alias) => normalized === normalizeHelpText(alias))
    ));
    const matched = features.find((feature) => (
      feature.aliases.some((alias) => normalized.includes(normalizeHelpText(alias)))
    ));

    if (isList || (!matched && isHelp)) {
      await replyText(frame, fullHelp).catch(() => {});
      return true;
    }
    if (exactFeature) {
      await replyText(frame, exactFeature.usage).catch(() => {});
      return true;
    }
    if (isHelp && matched) {
      await replyText(frame, matched.usage).catch(() => {});
      return true;
    }
    return false;
  };
}

module.exports = {
  createHelpRouter,
  HELP_HINTS,
  LIST_HINTS,
  normalizeHelpText,
};
