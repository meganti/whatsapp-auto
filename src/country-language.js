const { parsePhoneNumberFromString } = require('libphonenumber-js');

// Idioma principal + nome em português, por país (ISO 3166-1 alpha-2).
// Cobre os países mais prováveis de aparecer numa agenda de WhatsApp; um país
// fora dessa lista é tratado como "idioma desconhecido" (sem tradução).
const COUNTRY_LANGUAGE = {
  BR: { code: 'pt', name: 'Português' },
  PT: { code: 'pt', name: 'Português' },

  US: { code: 'en', name: 'Inglês' },
  GB: { code: 'en', name: 'Inglês' },
  GG: { code: 'en', name: 'Inglês' },
  JE: { code: 'en', name: 'Inglês' },
  IM: { code: 'en', name: 'Inglês' },
  IE: { code: 'en', name: 'Inglês' },
  CA: { code: 'en', name: 'Inglês' },
  AU: { code: 'en', name: 'Inglês' },
  NZ: { code: 'en', name: 'Inglês' },
  ZA: { code: 'en', name: 'Inglês' },
  IN: { code: 'en', name: 'Inglês' },
  NG: { code: 'en', name: 'Inglês' },
  KE: { code: 'en', name: 'Inglês' },
  SG: { code: 'en', name: 'Inglês' },
  PH: { code: 'en', name: 'Inglês' },

  ES: { code: 'es', name: 'Espanhol' },
  MX: { code: 'es', name: 'Espanhol' },
  AR: { code: 'es', name: 'Espanhol' },
  CL: { code: 'es', name: 'Espanhol' },
  CO: { code: 'es', name: 'Espanhol' },
  PE: { code: 'es', name: 'Espanhol' },
  VE: { code: 'es', name: 'Espanhol' },
  UY: { code: 'es', name: 'Espanhol' },
  PY: { code: 'es', name: 'Espanhol' },
  BO: { code: 'es', name: 'Espanhol' },
  EC: { code: 'es', name: 'Espanhol' },
  CR: { code: 'es', name: 'Espanhol' },
  PA: { code: 'es', name: 'Espanhol' },
  GT: { code: 'es', name: 'Espanhol' },
  DO: { code: 'es', name: 'Espanhol' },
  CU: { code: 'es', name: 'Espanhol' },

  FR: { code: 'fr', name: 'Francês' },
  BE: { code: 'fr', name: 'Francês' },
  CH: { code: 'fr', name: 'Francês' },
  CI: { code: 'fr', name: 'Francês' },
  SN: { code: 'fr', name: 'Francês' },

  DE: { code: 'de', name: 'Alemão' },
  AT: { code: 'de', name: 'Alemão' },

  IT: { code: 'it', name: 'Italiano' },

  JP: { code: 'ja', name: 'Japonês' },
  CN: { code: 'zh', name: 'Chinês' },
  TW: { code: 'zh', name: 'Chinês' },
  HK: { code: 'zh', name: 'Chinês' },
  KR: { code: 'ko', name: 'Coreano' },

  RU: { code: 'ru', name: 'Russo' },
  NL: { code: 'nl', name: 'Holandês' },
  PL: { code: 'pl', name: 'Polonês' },
  TR: { code: 'tr', name: 'Turco' },
  GR: { code: 'el', name: 'Grego' },
  SE: { code: 'sv', name: 'Sueco' },
  NO: { code: 'no', name: 'Norueguês' },
  DK: { code: 'da', name: 'Dinamarquês' },
  FI: { code: 'fi', name: 'Finlandês' },

  SA: { code: 'ar', name: 'Árabe' },
  AE: { code: 'ar', name: 'Árabe' },
  EG: { code: 'ar', name: 'Árabe' },

  IL: { code: 'he', name: 'Hebraico' },
  TH: { code: 'th', name: 'Tailandês' },
  VN: { code: 'vi', name: 'Vietnamita' },
  ID: { code: 'id', name: 'Indonésio' },
};

/**
 * A partir de uma WAMessageKey, tenta resolver o número de telefone real do
 * contato — o remoteJid principal pode ser um @lid (identificador que não
 * expõe o número); o Baileys também manda a versão @s.whatsapp.net em
 * remoteJidAlt quando disponível.
 */
function extractPhoneNumberJid(key) {
  const candidates = [key?.remoteJidAlt, key?.remoteJid];
  for (const jid of candidates) {
    if (jid && jid.endsWith('@s.whatsapp.net')) {
      return jid;
    }
  }
  return null;
}

/**
 * Retorna { country, language: {code, name} } para o contato da mensagem, ou
 * null se não for possível determinar o número/país (ex: só temos um @lid
 * sem remoteJidAlt).
 */
function resolveContactLanguage(key) {
  const jid = extractPhoneNumberJid(key);
  if (!jid) return null;

  const digits = jid.split('@')[0].split(':')[0];
  const phoneNumber = parsePhoneNumberFromString(`+${digits}`);
  if (!phoneNumber?.country) return null;

  const language = COUNTRY_LANGUAGE[phoneNumber.country];
  if (!language) return null;

  return { country: phoneNumber.country, language };
}

module.exports = { resolveContactLanguage, extractPhoneNumberJid, COUNTRY_LANGUAGE };
