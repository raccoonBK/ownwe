// OwnWe A/B mode classifier — rule-based, zero latency, zero cost
// Returns: { mode: 'A'|'B', speaker: 'tool'|'companion', confidence: 0-1, signals: string[] }

const TOOL_PATTERNS = [
  // code / files
  /```[\s\S]*?```/,
  /`[^`]+`/,
  /\b(https?:\/\/\S+)/,
  /[/\\][\w./\\-]{3,}/,         // file paths
  /\.\w{2,4}\b/,                 // extensions like .js .py .sql
  // task verbs
  /帮(我|忙)?(写|改|修|查|调|生成|实现|优化|重构|分析|部署|运行|测试|检查)/,
  /\b(write|fix|debug|implement|refactor|deploy|run|test|check|generate|analyze)\b/i,
  // tech terms
  /\b(bug|error|exception|crash|API|SDK|HTTP|SQL|JSON|git|npm|node|python|docker)\b/i,
  /\b(函数|接口|代码|数据库|服务|组件|模块|配置|环境|依赖|日志|报错)\b/,
];

const COMPANION_PATTERNS = [
  // emotional / relational
  /[嗯哦啊诶呀哈哈哈哈]{2,}/,
  /[😊😢😭😄🥺💕❤️🫂🌙]/u,
  /(好累|好烦|好难|难过|开心|高兴|委屈|想你|在吗|还好吗|怎么样)/,
  /(最近|今天|昨天|早上|晚上|深夜|睡觉|吃饭|散步)/,
  /(感觉|觉得|心情|情绪|压力|焦虑|放松|陪我)/,
  // casual signals
  /[！？~～…]{2,}/,
  /哈哈|嘻嘻|嗯嗯|好的好的|好啦|行啦/,
  // questions about life not work
  /(你在吗|你好|想聊|聊聊|说说|讲讲)/,
];

function classify(text = "", { pinnedMode = "", explicitTarget = "" } = {}) {
  // Pinned mode always wins
  if (pinnedMode === "A") return { mode: "A", speaker: "tool", confidence: 1, signals: ["pinned:A"] };
  if (pinnedMode === "B") return { mode: "B", speaker: "companion", confidence: 1, signals: ["pinned:B"] };

  // Explicit @ target from user wins
  if (explicitTarget === "codex") return { mode: "A", speaker: "tool", confidence: 1, signals: ["explicit:@codex"] };
  if (explicitTarget === "claude") return { mode: "B", speaker: "companion", confidence: 1, signals: ["explicit:@claude"] };

  const signals = [];
  let toolScore = 0;
  let companionScore = 0;

  for (const pattern of TOOL_PATTERNS) {
    if (pattern.test(text)) {
      toolScore += 1;
      signals.push(`tool:${pattern.source.slice(0, 30)}`);
    }
  }

  for (const pattern of COMPANION_PATTERNS) {
    if (pattern.test(text)) {
      companionScore += 1;
      signals.push(`companion:${pattern.source.slice(0, 30)}`);
    }
  }

  // Short messages with no tech signals → companion
  if (text.trim().length < 20 && toolScore === 0) {
    companionScore += 1;
    signals.push("companion:short_message");
  }

  const total = toolScore + companionScore;
  if (total === 0) {
    // Default to companion (safer for personal toy)
    return { mode: "B", speaker: "companion", confidence: 0.5, signals: ["default:companion"] };
  }

  if (toolScore > companionScore) {
    return { mode: "A", speaker: "tool", confidence: toolScore / total, signals };
  }

  // Companion wins or tie → B
  return { mode: "B", speaker: "companion", confidence: companionScore / Math.max(total, 1), signals };
}

module.exports = { classify };
