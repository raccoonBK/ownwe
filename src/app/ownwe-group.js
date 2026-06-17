// OwnWe 群聊引擎 — @提及路由 + 角色自决 + hop 限制。
//
// 思路参考 CcCompanion 的 group_chat（mention-driven + agent self-select），适配
// OwnWe 的单次 LLM 调用模型：
//   - 谁说话不是 round-robin，而是每个成员独立决定要不要接话。
//   - 被 @ 的成员强制回应；其余自决，多数时候沉默，避免"全员合唱"。
//   - 角色回复里可以 @ 别人，触发对方下一跳回应；hop 上限 + 总条数上限防刷屏。
//   - 每条之间有 600–1500ms 延迟，模拟真人在群里此起彼伏地发言。

const { getDb } = require("../db/connection");
const { generateCharacterReply } = require("../adapters/api/api-agent-adapter");

// 全局渠道规则：手机文字群聊，没有线下动作。和单聊上下文模板里那条对齐。
const CHANNEL_RULE =
  "你们都在一个手机文字群聊里。不可能走过去、坐到谁身边、递东西、碰到谁——这些线下动作在这里根本不存在。" +
  "也不要写括号旁白或动作描写（比如 *微笑*、（走近你））。你能做的只有发文字消息。";

function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function loadMembers(dbPath, charIds) {
  const db = getDb(dbPath);
  const out = [];
  for (const id of charIds) {
    try {
      const c = db.prepare(
        "SELECT id, name, avatar_emoji, persona_prompt, group_activity FROM ownwe_characters WHERE id = ?"
      ).get(id);
      if (c) out.push(c);
    } catch {
      // skip missing
    }
  }
  return out;
}

// Match @名字 against the roster. Tolerates @ + full name or @ + first 2 chars.
function parseMentions(text, members) {
  const hits = [];
  const t = String(text || "");
  for (const m of members) {
    const name = (m.name || "").trim();
    if (!name) continue;
    if (t.includes("@" + name) || (name.length > 2 && t.includes("@" + name.slice(0, 2)))) {
      hits.push(m.id);
    }
  }
  return hits;
}

function buildDecisionPrompt({ member, others, transcript, forced }) {
  const peers = others.map((o) => o.name).join("、");
  const system = [
    member.persona_prompt ? `你的人设：\n${member.persona_prompt.slice(0, 1200)}` : `你是「${member.name}」。`,
    `你正在一个群聊里。群里还有：${peers}，以及用户本人。`,
    CHANNEL_RULE,
    forced
      ? "刚才有人在群里点名 @ 了你，你应该自然地回应。"
      : "群里不是每句话都需要你接。只有当这条真的和你有关、你确实有话想说时才开口；否则就保持沉默别硬接，那样很假。",
    "如果你想把话头递给群里某个人，可以在消息里自然地 @ 那个人的名字。",
    "用你自己的语气，短，像真人在群里随手发的。绝不报账记忆（不说「我记得/你之前说过」）。",
    '严格输出 JSON，无 markdown：{"speak": true/false, "message": "要发的话（沉默就空）", "mention": "想@的群成员名字，没有就空"}',
  ].join("\n");
  const user = `群聊最近记录：\n${transcript}\n\n（你刚看到以上消息，现在决定要不要说话）`;
  return { system, user };
}

function parseDecision(raw) {
  if (!raw) return null;
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const o = JSON.parse(m[0]);
    const message = typeof o.message === "string" ? o.message.trim() : "";
    return {
      speak: Boolean(o.speak) && message.length > 0,
      message,
      mention: typeof o.mention === "string" ? o.mention.trim() : "",
    };
  } catch {
    return null;
  }
}

// Run one full group reaction to the latest state.
//   transcript    : pre-formatted "名字：内容" lines (built by the server)
//   userText      : the user's latest message (for @mention routing at hop 0)
//   pushMessage   : ({charId,charName,charEmoji,text}) => void  — append a bubble
//   isStale       : () => bool — bail if the user navigated away / a newer turn started
async function runGroupReplies({
  dbPath,
  charIds,
  transcript,
  userText = "",
  ownweMode = "B",
  pushMessage,
  isStale = () => false,
  sleep = defaultSleep,
  maxHops = 2,
  maxMessages = 6,
}) {
  const members = loadMembers(dbPath, charIds);
  if (members.length < 2 || typeof pushMessage !== "function") return 0;

  let posted = 0;
  let runningTranscript = transcript || "";
  const spokenCount = {}; // charId -> times spoken this round (cap 2 each)

  // Hop 0: everyone considers the user's message; @-ed members are forced.
  const userMentions = parseMentions(userText, members);
  const queue = members.map((m) => ({ member: m, forced: userMentions.includes(m.id), hop: 0 }));

  while (queue.length && posted < maxMessages) {
    if (isStale()) return posted;
    const { member, forced, hop } = queue.shift();
    if ((spokenCount[member.id] || 0) >= 2) continue;

    // Probabilistic activity gate: non-forced members may be skipped based on their
    // group_activity level (0 = never speak, 1 = always considered). Default 0.6.
    const activity = typeof member.group_activity === "number" ? member.group_activity : 0.6;
    if (!forced && Math.random() > activity) continue;

    const others = members.filter((x) => x.id !== member.id);
    const { system, user } = buildDecisionPrompt({ member, others, transcript: runningTranscript, forced });

    let decision = null;
    try {
      const raw = await generateCharacterReply({
        dbPath,
        charId: member.id,
        ownweMode,
        systemPrompt: system,
        messages: [{ role: "user", content: user }],
      });
      decision = parseDecision(raw);
    } catch (err) {
      console.warn(`[ownwe-group] ${member.name} decision failed:`, err.message);
      continue;
    }
    if (!decision || !decision.message) continue;
    if (!decision.speak && !forced) continue;

    // human-ish pacing between bubbles
    await sleep(600 + Math.floor(Math.random() * 900));
    if (isStale()) return posted;

    pushMessage({
      charId: member.id,
      charName: member.name,
      charEmoji: member.avatar_emoji || "🙂",
      text: decision.message,
    });
    posted += 1;
    spokenCount[member.id] = (spokenCount[member.id] || 0) + 1;
    runningTranscript += `\n${member.name}：${decision.message}`;

    // fan-out: did this reply @ someone? (bounded by hop)
    if (hop < maxHops) {
      const targets = new Set([
        ...parseMentions(decision.message, members),
        ...(decision.mention ? parseMentions("@" + decision.mention, members) : []),
      ]);
      for (const tid of targets) {
        if (tid === member.id) continue;
        const tm = members.find((x) => x.id === tid);
        if (tm && (spokenCount[tid] || 0) < 2) {
          queue.push({ member: tm, forced: true, hop: hop + 1 });
        }
      }
    }
  }
  return posted;
}

module.exports = { runGroupReplies, parseMentions, CHANNEL_RULE };
