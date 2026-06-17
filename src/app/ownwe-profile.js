// OwnWe 画像系统 — adapted from 问渠.
//
//   - Objective layer (ownwe_user_base): shared facts, user-editable.
//   - Subjective layer (char_user_profile): per-character impression, LLM-extracted
//     in cheap batches and user-editable. Each character holds its own picture.
//
// Data shapes mirror the 问渠 spec 1:1 (tags/keywords/thinkingStyles/emotions/
// importantTasks/baseline_views/recent_views/core_views). Stored as JSON columns.

const { getDb } = require("../db/connection");

const MAYBE_PREFIX = "可能·";
const EMOTION_ENUM = ["平静", "焦虑", "兴奋", "低落", "平稳"];
const QUANT_RE = /%|百分之|比例|概率|统计|平均|数据|量化/;
const TAGS_CAP = 12;          // mergeTags threshold
const TS_CAP = 10;            // mergeTS target
const TS_TRIGGER = 3;         // mergeTS threshold
const RV_FOLD_TRIGGER = 8;    // recent_views fold-into-core threshold
const EXTRACT_EVERY = 8;      // batch extraction cadence (messages)

// ── JSON helpers ────────────────────────────────────────────────────────────────

function parseJson(text, fallback) {
  try {
    const v = JSON.parse(text);
    return v == null ? fallback : v;
  } catch {
    return fallback;
  }
}

// ── Objective layer ──────────────────────────────────────────────────────────────

function getUserBase(dbPath) {
  try {
    const db = getDb(dbPath);
    const row = db.prepare("SELECT * FROM ownwe_user_base WHERE id = 'self'").get();
    if (!row) {
      db.prepare("INSERT OR IGNORE INTO ownwe_user_base (id) VALUES ('self')").run();
      return getUserBase(dbPath);
    }
    return { ...row, industries: parseJson(row.industries, []) };
  } catch {
    return { id: "self", industries: [], age: "", gender: "", mbti: "", major: "", grade: "", city: "", tone: 0.5, link: 0.5 };
  }
}

function upsertUserBase(dbPath, fields = {}) {
  const db = getDb(dbPath);
  const cur = getUserBase(dbPath);
  const next = {
    industries: Array.isArray(fields.industries) ? fields.industries : cur.industries,
    age: fields.age ?? cur.age,
    gender: fields.gender ?? cur.gender,
    mbti: fields.mbti ?? cur.mbti,
    major: fields.major ?? cur.major,
    grade: fields.grade ?? cur.grade,
    city: fields.city ?? cur.city,
    tone: typeof fields.tone === "number" ? fields.tone : cur.tone,
    link: typeof fields.link === "number" ? fields.link : cur.link,
  };
  db.prepare(`
    UPDATE ownwe_user_base
    SET industries = ?, age = ?, gender = ?, mbti = ?, major = ?, grade = ?, city = ?, tone = ?, link = ?, updated_at = datetime('now')
    WHERE id = 'self'
  `).run(JSON.stringify(next.industries), next.age, next.gender, next.mbti, next.major, next.grade, next.city, next.tone, next.link);
  return getUserBase(dbPath);
}

// ── Subjective layer ─────────────────────────────────────────────────────────────

const PROFILE_DEFAULT = {
  tags: [], keywords: [], thinkingStyles: [], emotions: [],
  importantTasks: [], baseline_views: [], recent_views: [], core_views: [], _rv_freq: [],
  msgsSinceExtract: 0,
};

function getCharProfile(dbPath, charId) {
  try {
    const db = getDb(dbPath);
    const row = db.prepare("SELECT * FROM char_user_profile WHERE char_id = ?").get(charId);
    if (!row) return { charId, ...PROFILE_DEFAULT };
    return {
      charId,
      tags: parseJson(row.tags, []),
      keywords: parseJson(row.keywords, []),
      thinkingStyles: parseJson(row.thinking_styles, []),
      emotions: parseJson(row.emotions, []),
      importantTasks: parseJson(row.important_tasks, []),
      baseline_views: parseJson(row.baseline_views, []),
      recent_views: parseJson(row.recent_views, []),
      core_views: parseJson(row.core_views, []),
      _rv_freq: parseJson(row.rv_freq, []),
      msgsSinceExtract: row.msgs_since_extract || 0,
    };
  } catch {
    return { charId, ...PROFILE_DEFAULT };
  }
}

function saveCharProfile(dbPath, charId, p) {
  const db = getDb(dbPath);
  db.prepare(`
    INSERT INTO char_user_profile
      (char_id, tags, keywords, thinking_styles, emotions, important_tasks, baseline_views, recent_views, core_views, rv_freq, msgs_since_extract, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(char_id) DO UPDATE SET
      tags = excluded.tags, keywords = excluded.keywords, thinking_styles = excluded.thinking_styles,
      emotions = excluded.emotions, important_tasks = excluded.important_tasks,
      baseline_views = excluded.baseline_views, recent_views = excluded.recent_views,
      core_views = excluded.core_views, rv_freq = excluded.rv_freq,
      msgs_since_extract = excluded.msgs_since_extract, updated_at = excluded.updated_at
  `).run(
    charId,
    JSON.stringify(p.tags || []),
    JSON.stringify(p.keywords || []),
    JSON.stringify(p.thinkingStyles || []),
    JSON.stringify(p.emotions || []),
    JSON.stringify(p.importantTasks || []),
    JSON.stringify(p.baseline_views || []),
    JSON.stringify(p.recent_views || []),
    JSON.stringify(p.core_views || []),
    JSON.stringify(p._rv_freq || []),
    p.msgsSinceExtract || 0,
  );
  return getCharProfile(dbPath, charId);
}

// ── Extraction contract (问渠 §二) ───────────────────────────────────────────────

function buildProfileSummary(profile) {
  const tagTexts = (profile.tags || []).map((t) => t.text).slice(0, 12).join("、");
  const views = (profile.core_views || []).concat(profile.recent_views || []).map((v) => v.text).slice(0, 6).join("；");
  return [
    tagTexts ? `已知标签：${tagTexts}` : "",
    views ? `已知观点：${views}` : "",
  ].filter(Boolean).join("\n") || "（暂无画像）";
}

function buildExtractionMessages({ transcript, profileSummary, existingKeywords }) {
  const system = [
    "你是一个画像提炼器。阅读用户最近的对话，只从【用户】说的内容里提炼对TA的理解。",
    "严格输出 JSON，不要任何 markdown、不要解释。格式：",
    `{"new_tags":[""],"keywords":[""],"thinking_style_note":"","key_view":"","emotional_signal":"平静","is_negative":false}`,
    "规则：",
    "- new_tags：身份/状态标签。无法确认的信息加「可能·」前缀。核心信息一旦确认不可丢弃。",
    "- keywords：只取原文里真实的专有名词（产品/技术/人名/书名/机构名），排除城市、比喻词、泛化名词，且不与已有关键词重复。",
    "- thinking_style_note：一句话思维特点（≤20字），可空。",
    "- key_view：值得记录的观点立场（可含问号），无则空字符串。",
    "- emotional_signal：从 平静/焦虑/兴奋/低落/平稳 里选一个。",
    "- is_negative：用户是否明显抗拒/回避当前话题。",
    "没有可提炼内容的字段就给空数组或空字符串。",
  ].join("\n");
  const user = [
    `已有画像：\n${profileSummary}`,
    `已有关键词：${(existingKeywords || []).join("、") || "（无）"}`,
    `最近对话：\n${transcript}`,
  ].join("\n\n");
  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}

function parseExtraction(text) {
  if (!text) return null;
  // tolerate code fences / surrounding prose
  const match = text.match(/\{[\s\S]*\}/);
  const raw = match ? match[0] : text;
  const obj = parseJson(raw, null);
  if (!obj || typeof obj !== "object") return null;
  return {
    new_tags: Array.isArray(obj.new_tags) ? obj.new_tags.filter(Boolean) : [],
    keywords: Array.isArray(obj.keywords) ? obj.keywords.filter(Boolean) : [],
    thinking_style_note: typeof obj.thinking_style_note === "string" ? obj.thinking_style_note.trim() : "",
    key_view: typeof obj.key_view === "string" ? obj.key_view.trim() : "",
    emotional_signal: EMOTION_ENUM.includes(obj.emotional_signal) ? obj.emotional_signal : "平静",
    is_negative: Boolean(obj.is_negative),
  };
}

// ── applyProf (问渠 §二) ─────────────────────────────────────────────────────────

function normTagText(text) {
  return String(text || "").replace(MAYBE_PREFIX, "").trim();
}

function applyExtraction(dbPath, charId, extraction, { sourceText = "" } = {}) {
  if (!extraction) return getCharProfile(dbPath, charId);
  const p = getCharProfile(dbPath, charId);

  // new_tags → tags (dedup, preserve certain/core, upgrade 可能· when confirmed)
  for (const rawTag of extraction.new_tags) {
    const isUncertain = rawTag.startsWith(MAYBE_PREFIX);
    const base = normTagText(rawTag);
    if (!base) continue;
    const existing = p.tags.find((t) => normTagText(t.text) === base);
    if (existing) {
      if (!isUncertain && !existing.certain) {
        existing.certain = true;            // confirmation upgrades 可能·X → X
        existing.text = base;
      }
    } else {
      p.tags.push({ text: isUncertain ? `${MAYBE_PREFIX}${base}` : base, certain: !isUncertain, core: false });
    }
  }

  // quantitative thinking detection (§二 额外)
  if (QUANT_RE.test(sourceText) || QUANT_RE.test(extraction.key_view)) {
    const q = p.tags.find((t) => normTagText(t.text) === "偏好量化思维");
    if (q) q.certain = true;
    else p.tags.push({ text: "偏好量化思维", certain: true, core: false });
  }

  // keywords dedup append
  for (const kw of extraction.keywords) {
    const k = String(kw).trim();
    if (k && !p.keywords.includes(k)) p.keywords.push(k);
  }

  // thinking_style_note → thinkingStyles
  if (extraction.thinking_style_note) {
    const note = extraction.thinking_style_note.slice(0, 20);
    if (!p.thinkingStyles.includes(note)) p.thinkingStyles.push(note);
  }

  // key_view → recent_views (+ _rv_freq)
  if (extraction.key_view) {
    const v = extraction.key_view;
    const existing = p.recent_views.find((rv) => rv.text === v);
    if (!existing) p.recent_views.push({ text: v });
    const freq = p._rv_freq.find((f) => f.text === v);
    if (freq) freq.n = (freq.n || 1) + 1;
    else p._rv_freq.push({ text: v, n: 1 });
  }

  // emotional_signal → emotions (keep last 20)
  p.emotions.push(extraction.emotional_signal);
  if (p.emotions.length > 20) p.emotions = p.emotions.slice(-20);

  // is_negative → importantTasks
  if (extraction.is_negative && sourceText) {
    p.importantTasks.push({ q: sourceText.slice(0, 60), src: "daily", negative: true });
  }

  // threshold maintenance (local deterministic — no extra LLM spend)
  maintainProfile(p);

  return saveCharProfile(dbPath, charId, p);
}

// mergeTags / mergeTS / mergeViews thresholds (§三). Local deterministic variants:
// preserve shapes + cores, just bound the sizes and fold recent→core.
function maintainProfile(p) {
  // mergeTags: keep all core, trim non-core (oldest first) down to cap
  if (p.tags.length > TAGS_CAP) {
    const core = p.tags.filter((t) => t.core);
    const nonCore = p.tags.filter((t) => !t.core);
    const room = Math.max(0, TAGS_CAP - core.length);
    p.tags = core.concat(nonCore.slice(-room));
  }
  // mergeTS: bound thinking styles to TS_CAP (keep most recent)
  if (p.thinkingStyles.length >= TS_TRIGGER && p.thinkingStyles.length > TS_CAP) {
    p.thinkingStyles = p.thinkingStyles.slice(-TS_CAP);
  }
  // mergeViews: fold recent_views into core_views (dedup) when they pile up, then clear
  if (p.recent_views.length >= RV_FOLD_TRIGGER) {
    for (const rv of p.recent_views) {
      if (!p.core_views.find((cv) => cv.text === rv.text)) p.core_views.push({ text: rv.text });
    }
    p.recent_views = [];
    p._rv_freq = [];
  }
}

// ── Quarterly rebuild (§三) ──────────────────────────────────────────────────────

function quarterlyRebuild(dbPath, charId) {
  const p = getCharProfile(dbPath, charId);
  const now = new Date().toISOString();
  for (const v of p.recent_views.concat(p.core_views)) {
    p.baseline_views.push({ text: v.text, snappedAt: now });
  }
  p.recent_views = [];
  p.core_views = [];
  p._rv_freq = [];
  return saveCharProfile(dbPath, charId, p);
}

// ── Profile → prompt compression (问渠 §四) ──────────────────────────────────────

function profileToPrompt(userBase, profile, recentHistory = []) {
  const lines = [];

  // 基本信息
  const basics = [];
  if (userBase.age) basics.push(`${userBase.age}岁`);
  if (Array.isArray(userBase.industries) && userBase.industries.length) basics.push(userBase.industries.join("/"));
  if (userBase.gender) basics.push(userBase.gender);
  if (userBase.mbti) basics.push(userBase.mbti);
  if (basics.length) lines.push(`这个人：${basics.join("·")}`);

  // 核心特质 (tags certain||core, first 8)
  const traits = (profile.tags || []).filter((t) => t.certain || t.core).slice(0, 8).map((t) => t.text);
  if (traits.length) lines.push(`你对TA的印象：${traits.join("、")}`);

  // 关键词 (first 6)
  const kws = (profile.keywords || []).slice(0, 6);
  if (kws.length) lines.push(`TA提过的具体事物：${kws.join("、")}`);

  // 思维风格 (first 3)
  const ts = (profile.thinkingStyles || []).slice(0, 3);
  if (ts.length) lines.push(`TA的思路：${ts.join("；")}`);

  // 观点 (core + recent, first 4)
  const views = (profile.core_views || []).concat(profile.recent_views || []).map((v) => v.text).slice(0, 4);
  if (views.length) lines.push(`TA说过的话：${views.join("；")}`);

  // 最近对话 (last 4, filter skipped, Q≤40 / A≤60)
  const recent = (recentHistory || [])
    .filter((h) => !h.skipped)
    .slice(-4)
    .map((h) => `Q:${String(h.question || "").slice(0, 40)} A:${String(h.answer || "").slice(0, 60)}`);
  if (recent.length) lines.push(`最近聊到：\n${recent.join("\n")}`);

  if (!lines.length) return "";
  // OwnWe wrapper: this is intuition, never to be cited (知道但不报账)
  return `（你对这个人的了解，凭直觉自然带出，绝不要说"根据我的记忆/画像"之类）\n${lines.join("\n")}`;
}

module.exports = {
  EXTRACT_EVERY,
  getUserBase,
  upsertUserBase,
  getCharProfile,
  saveCharProfile,
  buildProfileSummary,
  buildExtractionMessages,
  parseExtraction,
  applyExtraction,
  quarterlyRebuild,
  profileToPrompt,
};
