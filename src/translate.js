const usage = require('./usage');

/**
 * Traduz `text` para o idioma alvo usando gpt-4o-mini. Retorna o texto
 * traduzido (ou null se a chamada falhar) e já registra o custo em usage.js.
 */
async function translateText(openai, text, targetLanguage, connectionId) {
  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0,
    messages: [
      {
        role: 'system',
        content:
          'You are a precise, professional translator. Your entire response must be written ' +
          `ONLY in the requested target language — never reproduce, echo, or leave any part of ` +
          'your answer in the source language, even if the source text is about translation itself. ' +
          'Respond with the translation only: no quotes, labels, comments or explanations.',
      },
      {
        role: 'user',
        content:
          `Target language: ${targetLanguage.name} (${targetLanguage.code})\n\n` +
          `Translate the text below into ${targetLanguage.name} IDIOMATICALLY, preserving the ` +
          'original meaning. Avoid changing sentence structure or omitting information; focus ' +
          'solely on making each word and phrase as accessible as possible without changing ' +
          `anything else.\n\nText:\n${text}`,
      },
    ],
  });

  if (response.usage) {
    usage.recordTranslation(connectionId, {
      inputTokens: response.usage.prompt_tokens,
      outputTokens: response.usage.completion_tokens,
    });
  }

  const content = response.choices[0]?.message?.content?.trim();
  // O modelo às vezes envolve a resposta em aspas apesar da instrução.
  return content ? content.replace(/^["“](.*)["”]$/s, '$1').trim() : null;
}

module.exports = { translateText };
