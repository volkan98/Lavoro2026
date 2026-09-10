/**
 * Email Generation and Verification Rules
 *
 * Rules:
 * 1. PERMESSO G:
 *    Se dai dati reali del candidato risulta che possiede un Permesso G valido,
 *    questa informazione deve essere SEMPRE citata nell'email.
 *    Esempio: "Sono già in possesso del permesso G."
 *    NON inventare il permesso se non è presente nei dati.
 *
 * 2. DISPONIBILITÀ IMMEDIATA:
 *    Se dai dati reali del candidato risulta che è disponibile a iniziare subito,
 *    questa informazione deve essere SEMPRE citata nell'email.
 *    Esempio: "Sono disponibile a iniziare da subito."
 *    NON dedurre o inventare la disponibilità immediata se non è presente nei dati.
 *
 * 3. GRASSETTO:
 *    Quando Permesso G e disponibilità immediata sono presenti e verificati,
 *    evidenziare in grassetto SOLO questi due elementi.
 *    Esempio corretto: "Sono già in possesso del **permesso G** e sono **disponibile a iniziare da subito**."
 *    In HTML: "Sono già in possesso del <strong>permesso G</strong> e sono <strong>disponibile a iniziare da subito</strong>."
 *    NON lasciare visibili gli asterischi Markdown nell'email finale.
 *
 * 4. FIRMA:
 *    Ogni email deve terminare SEMPRE con:
 *    Cordiali saluti,
 *
 *    [NOME] [COGNOME]
 *    Tel. [NUMERO DI TELEFONO]
 *    (se telefono assente, solo Cordiali saluti,\n\n[NOME] [COGNOME])
 */

import { isPlaceholder } from './cvNormalizer';

/**
 * Checks if the candidate truly has a valid Swiss Permesso G in real data.
 */
export function hasValidPermessoG(cvData: any): boolean {
  if (!cvData) return false;

  // Direct boolean check
  if (cvData.permessoG === true) return true;

  // String check in permessoG
  if (typeof cvData.permessoG === 'string') {
    const val = cvData.permessoG.trim().toLowerCase();
    if (
      !val ||
      val === 'false' ||
      val === 'no' ||
      val === 'non in possesso' ||
      val === 'non specificato' ||
      val === 'non disponibile' ||
      val === 'non presente nel cv' ||
      val === 'n/a' ||
      val === 'nessun permesso' ||
      val === 'nessuno' ||
      isPlaceholder(val)
    ) {
      return false;
    }
    // Confirmed positive statuses
    if (/possesso|valido|permesso\s*g|frontaliere|^si$|^sì$|^b$|^g$/i.test(val)) {
      return true;
    }
  }

  // Check in statoPermesso
  if (typeof cvData.statoPermesso === 'string') {
    const sp = cvData.statoPermesso.trim().toLowerCase();
    if (
      /permesso\s*g/i.test(sp) &&
      !/non|senza|richiesto|da richiedere/i.test(sp) &&
      !isPlaceholder(sp)
    ) {
      return true;
    }
  }

  return false;
}

/**
 * Checks if the candidate has confirmed immediate availability in real data.
 */
export function hasImmediateAvailability(cvData: any, availabilityParam?: string): boolean {
  // Check direct parameter
  if (availabilityParam && typeof availabilityParam === 'string') {
    const av = availabilityParam.trim().toLowerCase();
    if (
      av &&
      av !== 'non specificata' &&
      !isPlaceholder(av) &&
      /immediat|da subito|subito/i.test(av)
    ) {
      return true;
    }
  }

  if (!cvData) return false;

  // Check cvData.disponibileImmediato
  if (cvData.disponibileImmediato === true) return true;

  // Check cvData.disponibilita or cvData.availability
  const cvAv = cvData.disponibilita || cvData.availability;
  if (typeof cvAv === 'string') {
    const val = cvAv.trim().toLowerCase();
    if (
      val &&
      val !== 'non specificata' &&
      !isPlaceholder(val) &&
      /immediat|da subito|subito/i.test(val)
    ) {
      return true;
    }
  }

  // Check in altreInformazioni array
  if (Array.isArray(cvData.altreInformazioni)) {
    const hasImmediateInInfo = cvData.altreInformazioni.some((info: any) => {
      if (typeof info !== 'string') return false;
      const lower = info.trim().toLowerCase();
      return (
        /disponib.*(?:immediat|da subito|subito)/i.test(lower) ||
        /inizio.*(?:immediat|da subito|subito)/i.test(lower)
      );
    });
    if (hasImmediateInInfo) return true;
  }

  // Check in profile text
  if (typeof cvData.profilo === 'string') {
    const prof = cvData.profilo.toLowerCase();
    if (
      /disponib.*(?:immediat|da subito)/i.test(prof) ||
      /disponibile\s+a\s+iniziare\s+(?:da\s+subito|immediatamente)/i.test(prof)
    ) {
      return true;
    }
  }

  return false;
}

/**
 * Generates the standardized Permesso G and availability statement.
 */
export function buildPermitAndAvailabilityClause(
  hasPermit: boolean,
  hasImmediate: boolean,
  format: 'html' | 'markdown' | 'plain' = 'html'
): string {
  if (hasPermit && hasImmediate) {
    if (format === 'html') {
      return 'Sono già in possesso del <strong>permesso G</strong> e sono <strong>disponibile a iniziare da subito</strong>.';
    }
    if (format === 'markdown') {
      return 'Sono già in possesso del **permesso G** e sono **disponibile a iniziare da subito**.';
    }
    return 'Sono già in possesso del permesso G e sono disponibile a iniziare da subito.';
  }

  if (hasPermit) {
    if (format === 'html') {
      return 'Sono già in possesso del <strong>permesso G</strong>.';
    }
    if (format === 'markdown') {
      return 'Sono già in possesso del **permesso G**.';
    }
    return 'Sono già in possesso del permesso G.';
  }

  if (hasImmediate) {
    if (format === 'html') {
      return 'Sono <strong>disponibile a iniziare da subito</strong>.';
    }
    if (format === 'markdown') {
      return 'Sono **disponibile a iniziare da subito**.';
    }
    return 'Sono disponibile a iniziare da subito.';
  }

  return '';
}

/**
 * Formats the standardized candidate signature.
 *
 * Rules:
 * Cordiali saluti,
 *
 * [NOME] [COGNOME]
 * Tel. [NUMERO DI TELEFONO]
 *
 * (Se il telefono non è disponibile, omettere riga Tel.)
 */
export function formatCandidateSignature(
  cvData: any,
  format: 'text' | 'html' = 'text'
): string {
  const nome = (cvData?.nome || '').trim();
  const cognome = (cvData?.cognome || '').trim();
  const fullName = [nome, cognome].filter(Boolean).join(' ').trim() || 'Candidato';

  const rawPhone = (cvData?.telefono || '').trim();
  const hasPhone = rawPhone && !isPlaceholder(rawPhone);
  // Clean phone prefix so we don't end up with "Tel. Tel. ..."
  const cleanPhone = rawPhone.replace(/^tel\.?\s*:?\s*/i, '').trim();

  if (format === 'html') {
    if (hasPhone) {
      return `Cordiali saluti,<br><br>${fullName}<br>Tel. ${cleanPhone}`;
    }
    return `Cordiali saluti,<br><br>${fullName}`;
  }

  if (hasPhone) {
    return `Cordiali saluti,\n\n${fullName}\nTel. ${cleanPhone}`;
  }
  return `Cordiali saluti,\n\n${fullName}`;
}

/**
 * Removes all markdown asterisks while converting **permesso G** and
 * **disponibile a iniziare da subito** to <strong> tags.
 * Ensures NO markdown asterisks remain visible in the final email.
 */
export function sanitizeEmailHtml(html: string): string {
  if (!html) return '';

  let sanitized = html;

  // Convert markdown bold to <strong>
  sanitized = sanitized.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  // Convert markdown italic to <em>
  sanitized = sanitized.replace(/\*([^*\n]+)\*/g, '<em>$1</em>');
  // Remove any remaining stray asterisks
  sanitized = sanitized.replace(/\*+/g, '');

  // Normalize <b> to <strong>
  sanitized = sanitized.replace(/<b>/gi, '<strong>').replace(/<\/b>/gi, '</strong>');

  // Enforce the rule: ONLY "permesso G" and "disponibile a iniziare da subito" in bold!
  // Remove <strong> from company names, greetings, or other random words
  sanitized = sanitized.replace(/<strong>(.*?)<\/strong>/gi, (match, inner) => {
    const trimmed = inner.trim();
    if (
      /permesso\s*g/i.test(trimmed) ||
      /disponibile\s*a\s*iniziare\s*da\s*subito/i.test(trimmed) ||
      /inizio\s*da\s*subito/i.test(trimmed)
    ) {
      // Keep permitted bold
      return `<strong>${trimmed}</strong>`;
    }
    // Unwrap any other bold
    return trimmed;
  });

  return sanitized.trim();
}

/**
 * Plain text sanitizer that strips HTML tags and markdown asterisks completely.
 */
export function sanitizeEmailPlainText(text: string): string {
  if (!text) return '';

  return text
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/?[^>]+>/g, '')
    .replace(/\*+/g, '') // Zero markdown asterisks visible
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .trim();
}

/**
 * Enforces all candidate email rules on an email body:
 * 1. Permesso G cited (and in bold) if really present.
 * 2. Disponibilità immediata cited (and in bold) if really present.
 * 3. Bold applied ONLY to these two elements.
 * 4. Zero markdown asterisks.
 */
export function enforceEmailBodyRules(
  bodyHtml: string,
  cvData: any,
  availabilityParam?: string
): string {
  const hasPermit = hasValidPermessoG(cvData);
  const hasImmediate = hasImmediateAvailability(cvData, availabilityParam);

  let processed = sanitizeEmailHtml(bodyHtml);

  // Check if body already has the permit mention
  const hasPermitMention = /permesso\s*g/i.test(processed);
  // Check if body already has the immediate availability mention
  const hasImmediateMention = /(?:disponibile\s+a\s+iniziare\s+da\s+subito|disponibilità\s+immediata|disponibile\s+da\s+subito)/i.test(processed);

  // If permit is confirmed but not cited, or immediate is confirmed but not cited:
  const clause = buildPermitAndAvailabilityClause(
    hasPermit && !hasPermitMention,
    hasImmediate && !hasImmediateMention,
    'html'
  );

  if (clause) {
    // Insert before the CV attachment / closing sentence or at the end of content
    if (/trasmetto\s+in\s+allegato|in\s+allegato|resto\s+a\s+(?:vostra|disposizione)/i.test(processed)) {
      processed = processed.replace(
        /(trasmetto\s+in\s+allegato|in\s+allegato|resto\s+a\s+(?:vostra|disposizione))/i,
        `${clause}<br><br>$1`
      );
    } else {
      processed = `${processed}<br><br>${clause}`;
    }
  }

  // Guarantee that if "permesso G" is mentioned, it is wrapped in <strong>
  if (hasPermit) {
    processed = processed.replace(/(sono\s+già\s+in\s+possesso\s+del\s+)(?:<strong>)?permesso\s*g(?:<\/strong>)?/gi, '$1<strong>permesso G</strong>');
    processed = processed.replace(/(possesso\s+del\s+)(?:<strong>)?permesso\s*g(?:<\/strong>)?/gi, '$1<strong>permesso G</strong>');
    if (!/<strong>permesso\s*g<\/strong>/i.test(processed)) {
      processed = processed.replace(/\bpermesso\s*g\b/i, '<strong>permesso G</strong>');
    }
  } else {
    // Remove invented permit mentions if not in data
    processed = processed.replace(/(?:<br>|\n|^).*?permesso\s*g.*?(?:<br>|\n|$)/gi, '<br>');
  }

  // Guarantee that if "disponibile a iniziare da subito" is mentioned, it is wrapped in <strong>
  if (hasImmediate) {
    processed = processed.replace(/(sono\s+)(?:<strong>)?disponibile\s+a\s+iniziare\s+da\s+subito(?:<\/strong>)?/gi, '$1<strong>disponibile a iniziare da subito</strong>');
    if (!/<strong>disponibile\s+a\s+iniziare\s+da\s+subito<\/strong>/i.test(processed)) {
      processed = processed.replace(/\bdisponibile\s+a\s+iniziare\s+da\s+subito\b/i, '<strong>disponibile a iniziare da subito</strong>');
    }
  } else {
    // Remove invented immediate availability mentions if not in data
    processed = processed.replace(/(?:<br>|\n|^).*?disponibile\s+a\s+iniziare\s+da\s+subito.*?(?:<br>|\n|$)/gi, '<br>');
    processed = processed.replace(/(?:<br>|\n|^).*?disponibilit[àa]\s+immediat[ae].*?(?:<br>|\n|$)/gi, '<br>');
  }

  // Clean double <br> artifacts and re-sanitize
  processed = sanitizeEmailHtml(processed);
  processed = processed.replace(/(?:<br\s*\/?>\s*){3,}/gi, '<br><br>');

  return processed.trim();
}

/**
 * Pre-send audit result item
 */
export interface PreSendCheckItem {
  id: string;
  label: string;
  passed: boolean;
  details: string;
}

export interface PreSendAuditParams {
  to?: string;
  subject?: string;
  corpo: string;
  firma: string;
  cvData: any;
  hasAttachment?: boolean;
  isBlacklisted?: boolean;
  availabilityParam?: string;
}

export interface PreSendAuditResult {
  isValid: boolean;
  checks: PreSendCheckItem[];
  errors: string[];
  permessoGCitedCorrectly: boolean;
  permessoGBoldCorrectly: boolean;
  disponibilitaCitedCorrectly: boolean;
  disponibilitaBoldCorrectly: boolean;
  hasMarkdownAsterisks: boolean;
  signatureCorrect: boolean;
  nameCorrect: boolean;
  phoneCorrect: boolean;
  isDestinatarioOk: boolean;
  isOggettoOk: boolean;
  isCorpoOk: boolean;
  isCvAttachmentOk: boolean;
}

/**
 * Validates the email against all user-specified pre-send requirements:
 * [ ] Permesso G citato se realmente presente
 * [ ] Permesso G in grassetto
 * [ ] Disponibilità immediata citata se realmente presente
 * [ ] Disponibilità immediata in grassetto
 * [ ] Nessun asterisco Markdown visibile nell'email finale
 * [ ] Firma presente
 * [ ] Nome e cognome corretti
 * [ ] Numero di telefono corretto
 */
export function auditEmailPreSend(params: PreSendAuditParams): PreSendAuditResult {
  const {
    to,
    subject,
    corpo,
    firma,
    cvData,
    hasAttachment = true,
    isBlacklisted = false,
    availabilityParam,
  } = params;

  const hasPermit = hasValidPermessoG(cvData);
  const hasImmediate = hasImmediateAvailability(cvData, availabilityParam);

  const plainCorpo = sanitizeEmailPlainText(corpo);
  const plainFirma = sanitizeEmailPlainText(firma);
  const fullText = `${corpo}\n\n${firma}`;

  // 1. Permesso G citato se realmente presente
  const permitCited = /permesso\s*g/i.test(fullText);
  const permitCheckPassed = hasPermit ? permitCited : !permitCited;

  // 2. Permesso G in grassetto (se presente nei dati)
  let permitBoldPassed = true;
  if (hasPermit) {
    permitBoldPassed = /<strong>\s*permesso\s*g\s*<\/strong>/i.test(corpo) || /<b>\s*permesso\s*g\s*<\/b>/i.test(corpo);
  }

  // 3. Disponibilità immediata citata se realmente presente
  const immediateCited = /(?:disponibile\s+a\s+iniziare\s+da\s+subito|inizio\s+da\s+subito|disponibilit[àa]\s+immediata)/i.test(fullText);
  const immediateCheckPassed = hasImmediate ? immediateCited : !immediateCited;

  // 4. Disponibilità immediata in grassetto (se presente nei dati)
  let immediateBoldPassed = true;
  if (hasImmediate) {
    immediateBoldPassed =
      /<strong>\s*disponibile\s+a\s+iniziare\s+da\s+subito\s*<\/strong>/i.test(corpo) ||
      /<b>\s*disponibile\s+a\s+iniziare\s+da\s+subito\s*<\/b>/i.test(corpo);
  }

  // 5. Nessun asterisco Markdown visibile nell'email finale
  const hasMarkdownAsterisks = /\*/.test(fullText);
  const markdownAsterisksPassed = !hasMarkdownAsterisks;

  // 6. Firma presente
  const firmaLines = plainFirma.split('\n').map((l) => l.trim()).filter(Boolean);
  const firmaHasSaluti = /cordiali\s+saluti/i.test(plainFirma);
  const firmaPassed = firmaLines.length >= 2 && firmaHasSaluti;

  // 7. Nome e cognome corretti
  const candName = [cvData?.nome, cvData?.cognome].filter(Boolean).join(' ').trim();
  const namePassed = candName ? plainFirma.toLowerCase().includes(candName.toLowerCase()) : firmaPassed;

  // 8. Numero di telefono corretto
  const rawPhone = (cvData?.telefono || '').trim();
  const hasRealPhone = rawPhone && !isPlaceholder(rawPhone);
  let phonePassed = true;
  let phoneDetails = 'Non fornito nel CV (omesso correttamente)';
  if (hasRealPhone) {
    const cleanNum = rawPhone.replace(/[^\d+]/g, '');
    const firmaClean = plainFirma.replace(/[^\d+]/g, '');
    phonePassed = /tel\.?\s+/i.test(plainFirma) && firmaClean.includes(cleanNum);
    phoneDetails = phonePassed ? `Verificato (${rawPhone})` : `Mancante o non corrispondente (${rawPhone})`;
  } else {
    // If no real phone, firma should NOT invent any telephone number
    if (/tel\.?/i.test(plainFirma) || /\b\d{6,}\b/.test(plainFirma)) {
      phonePassed = false;
      phoneDetails = 'Telefono inventato o placeholder non autorizzato';
    }
  }

  // Check destinatario
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const isDestinatarioOk = to ? emailRegex.test(to.trim()) : true;

  // Check oggetto
  const isOggettoOk = subject !== undefined ? Boolean(subject && subject.trim().length > 0) : true;

  // Check corpo
  const wordCount = plainCorpo ? plainCorpo.split(/\s+/).filter(Boolean).length : 0;
  const isCorpoOk = plainCorpo.length >= 25 && wordCount >= 30;

  // Check CV attachment
  const isCvAttachmentOk = Boolean(hasAttachment);

  const checks: PreSendCheckItem[] = [
    {
      id: 'permesso_g_citato',
      label: 'Permesso G citato se realmente presente',
      passed: permitCheckPassed,
      details: hasPermit
        ? permitCited
          ? 'Presente nei dati e citato'
          : 'Mancante nel testo'
        : !permitCited
        ? 'Non presente nei dati (non inventato)'
        : 'Attenzione: citato pur non presente nei dati reali',
    },
    {
      id: 'permesso_g_grassetto',
      label: 'Permesso G in grassetto',
      passed: permitBoldPassed,
      details: hasPermit
        ? permitBoldPassed
          ? 'Evidenziato come <strong>permesso G</strong>'
          : 'Non evidenziato in grassetto'
        : 'Non applicabile (permesso assente)',
    },
    {
      id: 'disponibilita_citata',
      label: 'Disponibilità immediata citata se realmente presente',
      passed: immediateCheckPassed,
      details: hasImmediate
        ? immediateCited
          ? 'Presente nei dati e citata'
          : 'Mancante nel testo'
        : !immediateCited
        ? 'Non presente nei dati (non inventata)'
        : 'Attenzione: citata pur non presente nei dati reali',
    },
    {
      id: 'disponibilita_grassetto',
      label: 'Disponibilità immediata in grassetto',
      passed: immediateBoldPassed,
      details: hasImmediate
        ? immediateBoldPassed
          ? 'Evidenziata come <strong>disponibile a iniziare da subito</strong>'
          : 'Non evidenziata in grassetto'
        : 'Non applicabile (disponibilità assente)',
    },
    {
      id: 'no_markdown_asterisks',
      label: 'Nessun asterisco Markdown visibile nell\'email finale',
      passed: markdownAsterisksPassed,
      details: markdownAsterisksPassed ? 'Nessun asterisco rilevato' : 'Rilevati asterischi Markdown (* o **)',
    },
    {
      id: 'firma_presente',
      label: 'Firma presente',
      passed: firmaPassed,
      details: firmaPassed ? 'Formula di chiusura e firma conformi' : 'Firma incompleta o formula saluti assente',
    },
    {
      id: 'nome_cognome_corretti',
      label: 'Nome e cognome corretti',
      passed: namePassed,
      details: namePassed ? (candName ? `Corrispondente a: ${candName}` : 'Nome presente') : `Nome non trovato nella firma (${candName})`,
    },
    {
      id: 'telefono_corretto',
      label: 'Numero di telefono corretto',
      passed: phonePassed,
      details: phoneDetails,
    },
  ];

  if (to !== undefined) {
    checks.push({
      id: 'destinatario_valido',
      label: 'Destinatario valido',
      passed: isDestinatarioOk,
      details: isDestinatarioOk ? `Valido (${to})` : `Email non valida (${to})`,
    });
  }

  if (subject !== undefined) {
    checks.push({
      id: 'oggetto_valido',
      label: 'Oggetto valido',
      passed: isOggettoOk,
      details: isOggettoOk ? 'Oggetto specificato' : 'Oggetto mancante',
    });
  }

  if (!isCvAttachmentOk) {
    checks.push({
      id: 'allegato_cv',
      label: 'CV allegato',
      passed: false,
      details: 'Allegato CV obbligatorio mancante',
    });
  }

  if (isBlacklisted) {
    checks.push({
      id: 'blacklist',
      label: 'Controllo Blacklist',
      passed: false,
      details: 'Destinatario presente nella blacklist',
    });
  }

  const errors: string[] = [];
  checks.forEach((c) => {
    if (!c.passed) {
      errors.push(`${c.label}: ${c.details}`);
    }
  });

  const isValid = checks.every((c) => c.passed) && isCorpoOk;

  return {
    isValid,
    checks,
    errors,
    permessoGCitedCorrectly: permitCheckPassed,
    permessoGBoldCorrectly: permitBoldPassed,
    disponibilitaCitedCorrectly: immediateCheckPassed,
    disponibilitaBoldCorrectly: immediateBoldPassed,
    hasMarkdownAsterisks,
    signatureCorrect: firmaPassed,
    nameCorrect: namePassed,
    phoneCorrect: phonePassed,
    isDestinatarioOk,
    isOggettoOk,
    isCorpoOk,
    isCvAttachmentOk,
  };
}
