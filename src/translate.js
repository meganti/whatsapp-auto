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
          `Traduza o texto do usuário para ${targetLanguage.name} (código ${targetLanguage.code}). ` +
          'Responda apenas com a tradução, sem aspas, comentários ou explicações.',
      },
      { role: 'user', content: text },
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
