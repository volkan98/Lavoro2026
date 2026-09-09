import type { CVData } from '../types/cv';

type Raw = Record<string, any>;
const object = (v: unknown): Raw => v && typeof v === 'object' && !Array.isArray(v) ? v : {};
const placeholders = /^(candidato(?: svizzera\/ticino)?|svizzera\/ticino|null|undefined|n\/?a|non specificato|non disponibile)$/i;
const str = (v: unknown): string => {
  if (typeof v !== 'string' && typeof v !== 'number') return '';
  const s = String(v).trim();
  return placeholders.test(s) ? '' : s;
};
const pick = (...values: unknown[]) => values.find(v => v !== null && v !== undefined && v !== '');
const text = (...values: unknown[]) => str(pick(...values));
const list = (v: unknown): any[] => Array.isArray(v) ? v : [];
const lines = (v: unknown): string => Array.isArray(v) ? v.map(str).filter(Boolean).join('\n') : str(v);
const strings = (v: unknown): string[] => (typeof v === 'string' ? v.split(/[;\n•]+/) : list(v))
  .map(x => typeof x === 'object' ? text(x?.nome, x?.name, x?.titolo, x?.title) : str(x)).filter(Boolean);

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
  // Never derive a candidate name from an account email or filename.
  if (!nome && !cognome && full) {
    const parts = full.split(/\s+/);
    nome = parts[0]; cognome = parts.slice(1).join(' ');
  }
  const permit = pick(source.permessoG, source.permesso_g);
  const rawLanguages = pick(source.lingue, source.languages);
  const languages = Array.isArray(rawLanguages) ? rawLanguages
    : Object.entries(object(rawLanguages)).map(([lingua, livello]) => ({ lingua, livello }));
  return {
    nome, cognome,
    email: text(source.email), telefono: text(source.telefono, source.phone),
    citta: text(source.citta, source.city), cap: text(source.cap, source.postalCode, source.postal_code),
    indirizzo: text(source.indirizzo, source.address),
    dataNascita: text(source.dataNascita, source.data_nascita, source.birthDate, source.dateOfBirth),
    patente: lines(pick(source.patente, source.drivingLicense)),
    profilo: text(source.profilo, source.profile_summary, source.summary),
    targetRole: text(source.targetRole, source.target_role),
    permessoG: typeof permit === 'boolean' ? permit : str(permit),
    statoPermesso: text(source.statoPermesso, source.stato_permesso),
    competenze: strings(pick(source.competenze, source.skills)),
    esperienze: list(pick(source.esperienze, source.experiences, source.esperienzeLavorative, source.work_experience, source.workExperience)).map((value, i) => {
      const e = object(value);
      return {
        id: text(e.id) || String(i + 1),
        ruolo: text(e.ruolo, e.role, e.posizione, e.position, e.title),
        azienda: text(e.azienda, e.company, e.datoreLavoro, e.employer),
        dataInizio: text(e.dataInizio, e.data_inizio, e.startDate, e.start_date, e.from),
        dataFine: text(e.dataFine, e.data_fine, e.endDate, e.end_date, e.to),
        descrizione: lines(pick(e.descrizione, e.description, e.mansioni, e.tasks, e.responsibilities)),
      };
    }).filter(e => e.ruolo || e.azienda || e.descrizione || e.dataInizio || e.dataFine),
    istruzione: list(pick(source.istruzione, source.education, source.formazione)).map((value, i) => {
      const e = object(value);
      return {
        id: text(e.id) || String(i + 1), titolo: text(e.titolo, e.title, e.qualifica, e.degree),
        istituto: text(e.istituto, e.institution, e.scuola, e.school),
        anno: text(e.anno, e.year, e.date, e.periodo),
        dataInizio: text(e.dataInizio, e.data_inizio, e.startDate, e.start_date),
        dataFine: text(e.dataFine, e.data_fine, e.endDate, e.end_date),
        descrizione: lines(pick(e.descrizione, e.description)),
      };
    }).filter(e => e.titolo || e.istituto || e.anno || e.dataInizio || e.dataFine || e.descrizione),
    lingue: languages.map((value, i) => {
      const l = typeof value === 'string' ? { lingua: value } : object(value);
      return { id: text(l.id) || String(i + 1), lingua: text(l.lingua, l.language, l.name), livello: text(l.livello, l.level, l.proficiency) };
    }).filter(l => l.lingua),
    certificazioni: strings(pick(source.certificazioni, source.certifications)),
    altreInformazioni: strings(pick(source.altreInformazioni, source.additionalInformation, source.otherInformation)),
    sintesiBreve: text(source.sintesiBreve, source.sintesi_breve, source.cv_short_summary),
    sintesiCompleta: text(source.sintesiCompleta, source.sintesi_completa, source.cv_full_summary),
  };
}

export const getEmptyCvData = (): CVData => normalizeCvData({});
export function hasCvData(raw: unknown): boolean {
  const cv = normalizeCvData(raw);
  return Object.entries(cv).some(([k, v]) => !['sintesiBreve', 'sintesiCompleta'].includes(k) &&
    (Array.isArray(v) ? v.length > 0 : typeof v === 'boolean' || Boolean(v)));
}

/** A partial synchronization cannot erase known facts or arrays. */
export function mergeCvData(existing: unknown, incoming: unknown): CVData {
  const previous = normalizeCvData(existing);
  const next = normalizeCvData(incoming);
  for (const key of Object.keys(previous) as (keyof CVData)[]) {
    const value = next[key];
    if (value === '' || value == null || (Array.isArray(value) && !value.length)) (next as any)[key] = previous[key];
  }
  return next;
}

/** Deterministic summaries contain only facts already present in the CV. */
export function summarizeCv(raw: unknown): { sintesiBreve: string; sintesiCompleta: string } {
  const c = normalizeCvData(raw);
  return {
    sintesiBreve: [c.profilo, c.competenze.join(', ')].filter(Boolean).join('\n'),
    sintesiCompleta: [c.profilo,
      ...c.esperienze.map(e => [e.ruolo, e.azienda, [e.dataInizio, e.dataFine].filter(Boolean).join(' – '), e.descrizione].filter(Boolean).join('\n')),
      ...c.istruzione.map(e => [e.titolo, e.istituto, e.anno, e.dataInizio, e.dataFine, e.descrizione].filter(Boolean).join('\n')),
      ...c.lingue.map(l => [l.lingua, l.livello].filter(Boolean).join(': ')),
      ...c.certificazioni, ...c.altreInformazioni,
    ].filter(Boolean).join('\n\n'),
  };
}
