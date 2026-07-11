const Anthropic = require('@anthropic-ai/sdk');

const baseURL = process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL;
const apiKey = process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY;

let client = null;
if (baseURL && apiKey) {
  client = new Anthropic({ baseURL, apiKey });
}

function isAvailable() {
  return client !== null;
}

async function ask({ system, messages, maxTokens = 4096, model = 'claude-haiku-4-5', timeoutMs = 20000 }) {
  if (!client) {
    throw new Error('Anthropic client not configured (missing AI_INTEGRATIONS_ANTHROPIC_* env vars)');
  }
  const resp = await client.messages.create(
    { model, max_tokens: maxTokens, system, messages },
    { timeout: timeoutMs }
  );
  const textBlock = (resp.content || []).find((b) => b.type === 'text');
  return textBlock ? textBlock.text : '';
}

module.exports = { client, isAvailable, ask };
