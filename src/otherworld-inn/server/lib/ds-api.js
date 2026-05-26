/**
 * DeepSeek API 调用封装
 * 支持 pro（世界生成）和 flash（对话、追踪、时间计算）两个模型
 */

import { loadConfig } from './rp-engine.js';

/**
 * 调用 DeepSeek API
 * @param {string} systemPrompt - 系统提示词
 * @param {string} userPrompt - 用户输入
 * @param {Array} history - 对话历史 [{role, content}]
 * @param {string} tier - 'pro' 或 'flash'，默认 'flash'
 * @returns {string} 模型回复
 */
async function callDS(systemPrompt, userPrompt, history = [], tier = 'flash') {
  const config = loadConfig();
  const apiConfig = config.api[tier] || config.api.flash;
  const { key, model, baseUrl, maxTokens, temperature } = apiConfig;

  if (!key) {
    throw new Error(`缺少 ${tier} 模型的 API 密钥。请设置 DEEPSEEK_${tier.toUpperCase()}_KEY，或在本地设置面板保存密钥。`);
  }

  const messages = [
    { role: 'system', content: systemPrompt }
  ];

  for (const msg of history) {
    messages.push(msg);
  }

  if (userPrompt) {
    messages.push({ role: 'user', content: userPrompt });
  }

  const response = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${key}`
    },
    body: JSON.stringify({
      model,
      messages,
      max_tokens: maxTokens,
      temperature
    })
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`DeepSeek API 错误 ${response.status}: ${errText}`);
  }

  const data = await response.json();
  const msg = data.choices[0].message;
  // DS V4 Pro是推理模型，内容可能在reasoning_content或content里
  return msg.content || msg.reasoning_content || '';
}

export { callDS };
