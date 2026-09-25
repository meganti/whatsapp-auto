const usage = require('./usage');

// Áudios com mais que isso (em segundos) ganham um resumo em tópicos antes
// da transcrição completa.
const SUMMARY_MIN_DURATION_SECONDS = 120;

/**
 * Resume `text` em tópicos curtos (em português) usando gpt-4o-mini. Retorna
 * o resumo já formatado como lista (ou null se vier vazio) e registra o custo
 * em usage.js.
 */
async function summarizeText(openai, text) {
  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0,
    messages: [
      {
        role: 'system',
        content:
          'Você recebe a transcrição de um áudio de WhatsApp. Resuma os pontos principais em português, ' +
          'em 3 a 7 tópicos curtos e objetivos. Responda apenas com os tópicos, um por linha, cada um ' +
          'começando com "• ", sem título, introdução ou conclusão.',
      },
      { role: 'user', content: text },
    ],
  });

  if (response.usage) {
    usage.recordTranslation({
      inputTokens: response.usage.prompt_tokens,
      outputTokens: response.usage.completion_tokens,
    });
  }

  const content = response.choices[0]?.message?.content?.trim();
  if (!content) return null;

  // Normaliza marcadores caso o modelo use "-", "*" ou numeração.
  return content
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => `• ${line.replace(/^([•\-*]|\d+[.)])\s*/, '')}`)
    .join('\n');
}

module.exports = { summarizeText, SUMMARY_MIN_DURATION_SECONDS };
