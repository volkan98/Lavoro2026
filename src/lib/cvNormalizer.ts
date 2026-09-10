import type { CVData, Esperienza } from '../types/cv';

type Raw = Record<string, any>;
const object = (v: unknown): Raw => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});

export const PLACEHOLDER_REGEX =
  /^(candidato(?: svizzera\/ticino)?|svizzera\/ticino|null|undefined|n\/?a|non specificato|non disponibile|non presente nel cv|non presente|non indicato|nessun dato|dato non presente|nessuna informazione)$/i;

export const isPlaceholder = (v: unknown): boolean => {
  if (typeof v !== 'string' && typeof v !== 'number') return false;
  return PLACEHOLDER_REGEX.test(String(v).trim());
};

const str = (v: unknown): string => {
  if (typeof v !== 'string' && typeof v !== 'number') return '';
  const s = String(v).trim();
  return isPlaceholder(s) ? '' : s;
};

const pick = (...values: unknown[]) => values.find(v => v !== null && v !== undefined && v !== '');
const text = (...values: unknown[]) => str(pick(...values));
const list = (v: unknown): any[] => (Array.isArray(v) ? v : []);
const lines = (v: unknown): string =>
  Array.isArray(v)
    ? v
        .map(str)
        .filter(Boolean)
        .filter(s => !isPlaceholder(s))
        .join('\n')
    : str(v);

const strings = (v: unknown): string[] =>
  (typeof v === 'string' ? v.split(/[;\n•]+/) : list(v))
    .map(x => (typeof x === 'object' ? text(x?.nome, x?.name, x?.titolo, x?.title) : str(x)))
    .filter(Boolean)
    .filter(s => !isPlaceholder(s));

const IT_SKILL_PATTERNS = [
  /\bwindows\b/i,
  /\bmac\s?os\b/i,
  /\blinux\b/i,
  /\boffice\b/i,
  /\bword\b/i,
  /\bexcel\b/i,
  /\bpowerpoint\b/i,
  /\boutlook\b/i,
  /posta elettron/i,
  /\be-?mail\b/i,
  /gestione pdf/i,
  /adobe acrobat/i,
  /\binternet\b/i,
  /navigazione (web|internet)/i,
  /\bbrowser\b/i,
  /\becdl\b/i,
  /google workspace/i,
  /fogli google/i,
  /documenti google/i,
];

export function isItSkill(skill: string): boolean {
  if (!skill) return false;
  return IT_SKILL_PATTERNS.some(p => p.test(skill.trim()));
}

/**
 * Deduplicates skills case-insensitively and separates them into
 * professional/technical skills vs general IT skills.
 * Technical skills are given absolute priority in the merged list.
 */
export function mergeAndDeduplicateSkills(
  existingSkills: string[] = [],
  technicalSkills: string[] = [],
  itSkills: string[] = [],
  experiences: { descrizione?: string; ruolo?: string }[] = []
): {
  competenze: string[];
  competenzeTecniche: string[];
  competenzeInformatiche: string[];
} {
  const seen = new Set<string>();
  const techList: string[] = [];
  const itList: string[] = [];

  const addSkill = (raw: string, forcedType?: 'tech' | 'it') => {
    const s = str(raw).replace(/^[-*•\s]+/, '').trim();
    if (!s || s.length < 2 || isPlaceholder(s)) return;
    const key = s.toLowerCase().replace(/[^a-z0-9àèéìòù]/gi, '');
    if (seen.has(key)) return;
    seen.add(key);

    const isIt = forcedType === 'it' || (forcedType !== 'tech' && isItSkill(s));
    if (isIt) {
      itList.push(s);
    } else {
      techList.push(s);
    }
  };

  // 1. Add explicitly labeled technical skills first
  for (const s of technicalSkills) addSkill(s, 'tech');

  // 2. Add existing skills (categorizing them)
  for (const s of existingSkills) addSkill(s);

  // 3. Add explicit IT skills
  for (const s of itSkills) addSkill(s, 'it');

  // 4. If technical skills are scarce, extract domain tasks and techniques from experiences
  if (techList.length < 4 && experiences.length > 0) {
    for (const exp of experiences) {
      if (!exp.descrizione) continue;
      const chunks = exp.descrizione
        .split(/[\n;•\.\r]+/)
        .map(c => c.trim().replace(/^[-*•\d.)\s]+/, '').replace(/[.,;]+$/, '').trim())
        .filter(c => c.length >= 4 && c.length <= 90 && !isPlaceholder(c));

      for (const chunk of chunks) {
        // Only consider meaningful task or process phrases, avoid full narrative paragraphs
        if (/vernici|saldat|controllo|montagg|lavoraz|qualit|superfic|attrezz|meccanic|macchin|cnc|manutenz|assembl|impiant|disegno|schemi|piegatur|fresat|tornit|preparaz|trattament/i.test(chunk)) {
          addSkill(chunk, 'tech');
          if (techList.length >= 8) break;
        }
      }
    }
  }

  return {
    competenze: [...techList, ...itList],
    competenzeTecniche: techList,
    competenzeInformatiche: itList,
  };
}

/**
 * FASE 2: Generates a controlled, factual professional profile (50-90 words)
 * using exclusively extracted data. If an explicit profile is already present
 * in the CV and valid, it is preserved.
 */
export function generateDerivedProfile(cv: CVData): string {
  // If an explicit profile already exists in the CV, preserve it
  if (cv.profilo && cv.profilo.trim().length > 0 && !isPlaceholder(cv.profilo.trim())) {
    return cv.profilo.trim();
  }

  // If there are no experiences and no skills, do not invent anything
  if ((!cv.esperienze || cv.esperienze.length === 0) && (!cv.competenze || cv.competenze.length === 0)) {
    return '';
  }

  const primaryExp = cv.esperienze?.[0];
  const role = primaryExp?.ruolo || cv.targetRole || 'figura operativa e tecnica';
  const company = primaryExp?.azienda ? ` presso ${primaryExp.azienda}` : '';

  // Extract key tasks/processes from the primary experience description
  let mainDuties = '';
  if (primaryExp?.descrizione) {
    const dutyLines = primaryExp.descrizione
      .split(/[\n;•]+/)
      .map(d => d.trim().replace(/^[-*•\d.)\s]+/, ''))
      .filter(d => d.length > 5 && !isPlaceholder(d));
    if (dutyLines.length > 0) {
      mainDuties = dutyLines.slice(0, 2).join(' e ').replace(/[.,;]+$/, '');
    }
  }

  const techSkills = (cv.competenzeTecniche && cv.competenzeTecniche.length > 0
    ? cv.competenzeTecniche
    : cv.competenze.filter(s => !isItSkill(s)))
    .slice(0, 4);

  const hasMultipleExp = (cv.esperienze?.length || 0) > 1;
  const secondExp = hasMultipleExp ? cv.esperienze[1] : null;
  const education = cv.istruzione?.[0];

  const sentences: string[] = [];

  // Sentence 1: Primary role and experience
  if (primaryExp?.azienda) {
    sentences.push(`Profilo professionale con esperienza operativa maturata principalmente nel ruolo di ${role}${company}.`);
  } else {
    sentences.push(`Profilo professionale con esperienza consolidata nelle mansioni di ${role}.`);
  }

  // Sentence 2: Concrete tasks and quality context
  if (mainDuties) {
    sentences.push(
      `Nel corso del percorso lavorativo si è dedicato ad attività di ${mainDuties.toLowerCase()}, operando con precisione nel rispetto delle procedure tecniche e degli standard qualitativi previsti.`
    );
  } else if (secondExp?.ruolo) {
    sentences.push(
      `Il percorso include inoltre esperienze nel ruolo di ${secondExp.ruolo}${secondExp.azienda ? ` presso ${secondExp.azienda}` : ''}, maturando versatilità operativa in contesti produttivi.`
    );
  }

  // Sentence 3: Key technical skills
  if (techSkills.length > 0) {
    sentences.push(`Dispone di competenze pratiche e metodologie operative in: ${techSkills.join(', ')}.`);
  }

  // Sentence 4: Education, driving license, or complementary context
  if (education?.titolo && !isPlaceholder(education.titolo)) {
    sentences.push(
      `Il profilo è completato dalla formazione in ${education.titolo}${education.istituto && !isPlaceholder(education.istituto) ? ` conseguita presso ${education.istituto}` : ''}.`
    );
  } else if (cv.patente && !isPlaceholder(cv.patente)) {
    sentences.push(`In possesso di patente di guida ${cv.patente} e piena disponibilità operativa.`);
  }

  let textResult = sentences.join(' ').trim();
  let words = textResult.split(/\s+/).filter(Boolean);

  // Calibration for target 50-90 words
  if (words.length < 50) {
    const additions: string[] = [];
    if (secondExp?.ruolo && !textResult.includes(secondExp.ruolo)) {
      additions.push(`Ha maturato ulteriore esperienza come ${secondExp.ruolo}${secondExp.azienda ? ` presso ${secondExp.azienda}` : ''}.`);
    }
    if (cv.lingue && cv.lingue.length > 0 && cv.lingue[0].lingua && !isPlaceholder(cv.lingue[0].lingua)) {
      additions.push(
        `Completano il profilo la conoscenza della lingua ${cv.lingue[0].lingua}${cv.lingue[0].livello ? ` (${cv.lingue[0].livello})` : ''}.`
      );
    }
    if (additions.length > 0) {
      textResult = `${textResult} ${additions.join(' ')}`.trim();
      words = textResult.split(/\s+/).filter(Boolean);
    }
  }

  // If words > 90, trim cleanly at a sentence boundary
  if (words.length > 90) {
    const splitSentences = textResult.split(/(?<=[.!?])\s+/);
    let trimmed = '';
    for (const s of splitSentences) {
      const nextCand = trimmed ? `${trimmed} ${s}` : s;
      if (nextCand.split(/\s+/).filter(Boolean).length <= 90) {
        trimmed = nextCand;
      } else {
        break;
      }
    }
    if (trimmed && trimmed.split(/\s+/).filter(Boolean).length >= 45) {
      textResult = trimmed;
    }
  }

  return textResult;
}

/**
 * Generates both brief and full summaries strictly using normalized data.
 */
export function generateSummaryFromParsedCv(parsed: CVData): {
  profilo: string;
  sintesiBreve: string;
  sintesiCompleta: string;
} {
  const profilo = generateDerivedProfile(parsed);
  const skills = mergeAndDeduplicateSkills(
    parsed.competenze,
    parsed.competenzeTecniche,
    parsed.competenzeInformatiche,
    parsed.esperienze
  );

  // Sintesi breve: ruolo principale, aziende/settori, 3-6 competenze tecniche rilevanti
  const primaryRole = parsed.esperienze?.[0]?.ruolo || parsed.targetRole || 'Profilo professionale';
  const primaryCompany = parsed.esperienze?.[0]?.azienda ? ` presso ${parsed.esperienze[0].azienda}` : '';
  const topTechSkills = (skills.competenzeTecniche.length > 0 ? skills.competenzeTecniche : skills.competenze).slice(0, 5);
  const sintesiBreve = topTechSkills.length > 0
    ? `${primaryRole}${primaryCompany}. Competenze tecniche principali: ${topTechSkills.join(', ')}.`
    : `${primaryRole}${primaryCompany}.`.trim();

  // Sintesi completa: esperienze con mansioni, formazione, competenze, lingue, info aggiuntive
  const sections: string[] = [];

  if (profilo) {
    sections.push(`PROFILO PROFESSIONALE\n${profilo}`);
  }

  if (parsed.esperienze && parsed.esperienze.length > 0) {
    const expText = parsed.esperienze
      .map(e => {
        const header = [e.ruolo, e.azienda].filter(Boolean).join(' – ');
        const dates = [e.dataInizio, e.dataFine].filter(Boolean).join(' – ');
        const parts = [header, dates, e.descrizione].filter(Boolean);
        return parts.join('\n');
      })
      .join('\n\n');
    sections.push(`ESPERIENZE PROFESSIONALI\n${expText}`);
  }

  if (skills.competenzeTecniche.length > 0) {
    sections.push(`COMPETENZE TECNICHE E PROFESSIONALI\n${skills.competenzeTecniche.join(', ')}`);
  }

  if (skills.competenzeInformatiche.length > 0) {
    sections.push(`COMPETENZE INFORMATICHE\n${skills.competenzeInformatiche.join(', ')}`);
  }

  if (parsed.istruzione && parsed.istruzione.length > 0) {
    const eduText = parsed.istruzione
      .map(e => {
        const header = [e.titolo, e.istituto].filter(Boolean).join(' – ');
        const dates = e.anno || [e.dataInizio, e.dataFine].filter(Boolean).join(' – ');
        const parts = [header, dates, e.descrizione].filter(Boolean);
        return parts.join('\n');
      })
      .join('\n\n');
    sections.push(`FORMAZIONE E ISTRUZIONE\n${eduText}`);
  }

  if (parsed.lingue && parsed.lingue.length > 0) {
    const langText = parsed.lingue.map(l => [l.lingua, l.livello].filter(Boolean).join(': ')).join('\n');
    sections.push(`LINGUE\n${langText}`);
  }

  const otherInfo: string[] = [];
  if (parsed.patente && !isPlaceholder(parsed.patente)) otherInfo.push(`Patente: ${parsed.patente}`);
  if (parsed.certificazioni && parsed.certificazioni.length > 0) {
    otherInfo.push(`Certificazioni: ${parsed.certificazioni.join(', ')}`);
  }
  if (parsed.altreInformazioni && parsed.altreInformazioni.length > 0) {
    otherInfo.push(`Altre informazioni: ${parsed.altreInformazioni.join(', ')}`);
  }
  if (otherInfo.length > 0) {
    sections.push(`INFORMAZIONI AGGIUNTIVE\n${otherInfo.join('\n')}`);
  }

  const sintesiCompleta = sections.join('\n\n');

  return {
    profilo,
    sintesiBreve,
    sintesiCompleta,
  };
}

/** The only parser/database/UI schema. Missing facts stay empty; output is Firestore safe. */
export function normalizeCvData(rawData: unknown): CVData {
  let source = object(rawData);
  for (let i = 0; i < 5; i++) {
    const wrapped = pick(source.cvParsedData, source.extractedData, source.data);
    if (!wrapped || typeof wrapped !== 'object' || Array.isArray(wrapped)) break;
    source = wrapped;
  }
  const personal = object(pick(source.personalInfo, source.personal_info, source.datiPersonali));
  source = { ...personal, ...source };
  let nome = text(source.nome, source.firstName, source.first_name);
  let cognome = text(source.cognome, source.lastName, source.last_name);
  const full = text(source.full_name, source.fullName);
  if (!nome && !cognome && full) {
    const parts = full.split(/\s+/);
    nome = parts[0];
    cognome = parts.slice(1).join(' ');
  }
  const permit = pick(source.permessoG, source.permesso_g);
  const rawLanguages = pick(source.lingue, source.languages);
  const languages = Array.isArray(rawLanguages)
    ? rawLanguages
    : Object.entries(object(rawLanguages)).map(([lingua, livello]) => ({ lingua, livello }));

  const rawSkills = strings(pick(source.competenze, source.skills));
  const rawTech = strings(pick(source.competenzeTecniche, source.technicalSkills));
  const rawIt = strings(pick(source.competenzeInformatiche, source.itSkills, source.computerSkills));

  const rawEsperienze = list(
    pick(source.esperienze, source.experiences, source.esperienzeLavorative, source.work_experience, source.workExperience)
  )
    .map((value, i) => {
      const e = object(value);
      return {
        id: text(e.id) || String(i + 1),
        ruolo: text(e.ruolo, e.role, e.posizione, e.position, e.title),
        azienda: text(e.azienda, e.company, e.datoreLavoro, e.employer),
        dataInizio: text(e.dataInizio, e.data_inizio, e.startDate, e.start_date, e.from),
        dataFine: text(e.dataFine, e.data_fine, e.endDate, e.end_date, e.to),
        descrizione: lines(pick(e.descrizione, e.description, e.mansioni, e.tasks, e.responsibilities)),
      };
    })
    .filter(e => e.ruolo || e.azienda || e.descrizione || e.dataInizio || e.dataFine);

  const skills = mergeAndDeduplicateSkills(rawSkills, rawTech, rawIt, rawEsperienze);

  const normalized: CVData = {
    nome,
    cognome,
    email: text(source.email),
    telefono: text(source.telefono, source.phone),
    citta: text(source.citta, source.city),
    cap: text(source.cap, source.postalCode, source.postal_code),
    indirizzo: text(source.indirizzo, source.address),
    dataNascita: text(source.dataNascita, source.data_nascita, source.birthDate, source.dateOfBirth),
    patente: lines(pick(source.patente, source.drivingLicense)),
    profilo: text(source.profilo, source.profile_summary, source.summary),
    targetRole: text(source.targetRole, source.target_role),
    permessoG: typeof permit === 'boolean' ? permit : str(permit),
    statoPermesso: text(source.statoPermesso, source.stato_permesso),
    competenze: skills.competenze,
    competenzeTecniche: skills.competenzeTecniche,
    competenzeInformatiche: skills.competenzeInformatiche,
    esperienze: rawEsperienze,
    istruzione: list(pick(source.istruzione, source.education, source.formazione))
      .map((value, i) => {
        const e = object(value);
        return {
          id: text(e.id) || String(i + 1),
          titolo: text(e.titolo, e.title, e.qualifica, e.degree),
          istituto: text(e.istituto, e.institution, e.scuola, e.school),
          anno: text(e.anno, e.year, e.date, e.periodo),
          dataInizio: text(e.dataInizio, e.data_inizio, e.startDate, e.start_date),
          dataFine: text(e.dataFine, e.data_fine, e.endDate, e.end_date),
          descrizione: lines(pick(e.descrizione, e.description)),
        };
      })
      .filter(e => e.titolo || e.istituto || e.anno || e.dataInizio || e.dataFine || e.descrizione),
    lingue: languages
      .map((value, i) => {
        const l = typeof value === 'string' ? { lingua: value } : object(value);
        return {
          id: text(l.id) || String(i + 1),
          lingua: text(l.lingua, l.language, l.name),
          livello: text(l.livello, l.level, l.proficiency),
        };
      })
      .filter(l => l.lingua),
    certificazioni: strings(pick(source.certificazioni, source.certifications)),
    altreInformazioni: strings(pick(source.altreInformazioni, source.additionalInformation, source.otherInformation)),
    sintesiBreve: text(source.sintesiBreve, source.sintesi_breve, source.cv_short_summary),
    sintesiCompleta: text(source.sintesiCompleta, source.sintesi_completa, source.cv_full_summary),
  };

  // Derive profile and summaries if there is actual content and they are missing
  const hasContent = Boolean(
    normalized.esperienze.length > 0 ||
      normalized.competenze.length > 0 ||
      normalized.istruzione.length > 0 ||
      normalized.nome ||
      normalized.cognome
  );

  if (hasContent) {
    if (!normalized.profilo) {
      normalized.profilo = generateDerivedProfile(normalized);
    }
    const summary = generateSummaryFromParsedCv(normalized);
    if (!normalized.sintesiBreve) {
      normalized.sintesiBreve = summary.sintesiBreve;
    }
    if (!normalized.sintesiCompleta) {
      normalized.sintesiCompleta = summary.sintesiCompleta;
    }
  }

  return normalized;
}

export const getEmptyCvData = (): CVData => normalizeCvData({});

export function hasCvData(raw: unknown): boolean {
  const cv = normalizeCvData(raw);
  return Object.entries(cv).some(
    ([k, v]) =>
      !['sintesiBreve', 'sintesiCompleta', 'competenzeTecniche', 'competenzeInformatiche'].includes(k) &&
      (Array.isArray(v) ? v.length > 0 : typeof v === 'boolean' || Boolean(v))
  );
}

/** A partial synchronization cannot erase known facts or arrays. */
export function mergeCvData(existing: unknown, incoming: unknown): CVData {
  const previous = normalizeCvData(existing);
  const next = normalizeCvData(incoming);
  for (const key of Object.keys(previous) as (keyof CVData)[]) {
    const value = next[key];
    if (value === '' || value == null || (Array.isArray(value) && !value.length)) {
      (next as any)[key] = previous[key];
    }
  }
  return next;
}

/** Deterministic summaries contain only facts already present in the CV. */
export function summarizeCv(raw: unknown): { profilo: string; sintesiBreve: string; sintesiCompleta: string } {
  const c = normalizeCvData(raw);
  if (!hasCvData(c)) {
    return { profilo: '', sintesiBreve: '', sintesiCompleta: '' };
  }
  const summary = generateSummaryFromParsedCv(c);
  return {
    profilo: summary.profilo,
    sintesiBreve: summary.sintesiBreve,
    sintesiCompleta: summary.sintesiCompleta,
  };
}

