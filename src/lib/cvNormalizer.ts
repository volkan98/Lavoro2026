import { CVData, Esperienza, Istruzione, Lingua } from '@/types/cv';

/**
 * Creates an empty, clean CVData object with no hardcoded or placeholder values.
 */
export function getEmptyCvData(): CVData {
  return {
    nome: '',
    cognome: '',
    email: '',
    telefono: '',
    citta: '',
    cap: '',
    indirizzo: '',
    dataNascita: '',
    patente: '',
    profilo: '',
    competenze: [],
    esperienze: [],
    istruzione: [],
    lingue: [],
    certificazioni: [],
    permessoG: '',
    statoPermesso: '',
    sintesiBreve: '',
    sintesiCompleta: '',
  };
}

/**
 * Normalizes any CV parser output or raw database payload into the canonical CVData schema.
 * Rejects fictitious/hardcoded placeholders (e.g. "Candidato", "Svizzera/Ticino") and formats all fields consistently.
 */
export function normalizeCvData(rawData: any): CVData {
  if (!rawData || typeof rawData !== 'object') {
    return getEmptyCvData();
  }

  // Handle nested wraps if passed: e.g. { cvParsedData: ... } or { data: ... }
  const source = rawData.cvParsedData || rawData.data || rawData;

  const cleanStr = (val: any): string => {
    if (val === null || val === undefined) return '';
    const str = String(val).trim();
    if (str.toLowerCase() === 'null' || str.toLowerCase() === 'undefined') return '';
    return str;
  };

  // Name extraction & filtering out fictitious fallbacks
  let nome = cleanStr(source.nome || source.firstName || source.first_name);
  let cognome = cleanStr(source.cognome || source.lastName || source.last_name);

  if (!nome && !cognome && source.full_name) {
    const full = cleanStr(source.full_name);
    if (full && !full.toLowerCase().includes('candidato svizzera')) {
      const parts = full.split(/\s+/);
      nome = parts[0] || '';
      cognome = parts.slice(1).join(' ') || '';
    }
  }

  // Strip banned placeholder terms
  if (nome.toLowerCase() === 'candidato') nome = '';
  if (cognome.toLowerCase().includes('svizzera/ticino') || cognome.toLowerCase().includes('ticino')) cognome = '';

  const email = cleanStr(source.email);
  const telefono = cleanStr(source.telefono || source.phone);
  const citta = cleanStr(source.citta || source.city);
  const cap = cleanStr(source.cap || source.postalCode || source.postal_code);
  const indirizzo = cleanStr(source.indirizzo || source.address);
  const dataNascita = cleanStr(source.dataNascita || source.data_nascita || source.birthDate);
  const patente = cleanStr(source.patente || source.drivingLicense);
  const profilo = cleanStr(source.profilo || source.profile_summary || source.summary);
  const targetRole = cleanStr(source.targetRole || source.target_role);

  // Permesso G normalization
  let permessoG = cleanStr(source.permessoG || source.permesso_g);
  if (source.permessoG === true || source.permesso_g === true || /in possesso/i.test(permessoG)) {
    permessoG = 'In possesso';
  } else if (source.permessoG === false || source.permesso_g === false || /idoneo/i.test(permessoG)) {
    permessoG = 'Idoneo';
  }

  let statoPermesso = cleanStr(source.statoPermesso || source.stato_permesso);
  if (!statoPermesso && permessoG) {
    statoPermesso = permessoG === 'In possesso'
      ? 'In possesso di Permesso G (Frontalieri Svizzera)'
      : 'Idoneo al rilascio immediato di Permesso G (Cittadino UE / Frontalieri Svizzera)';
  }

  // Competenze / Skills
  let competenze: string[] = [];
  const rawSkills = source.competenze || source.skills;
  if (Array.isArray(rawSkills)) {
    competenze = rawSkills
      .map((s) => (typeof s === 'string' ? s.trim() : cleanStr(s?.nome || s?.name)))
      .filter(Boolean);
  } else if (typeof rawSkills === 'string' && rawSkills.trim()) {
    competenze = rawSkills.split(/[,;\n•]+/).map((s) => s.trim()).filter(Boolean);
  }

  // Esperienze Lavorative
  let esperienze: Esperienza[] = [];
  const rawExp = source.esperienze || source.experiences || source.esperienzeLavorative || source.work_experience;
  if (Array.isArray(rawExp)) {
    esperienze = rawExp
      .map((exp: any, idx: number) => ({
        id: cleanStr(exp.id) || String(idx + 1),
        ruolo: cleanStr(exp.ruolo || exp.role || exp.posizione || exp.position || exp.title),
        azienda: cleanStr(exp.azienda || exp.company || exp.datoreLavoro),
        dataInizio: cleanStr(exp.dataInizio || exp.data_inizio || exp.startDate || exp.from),
        dataFine: cleanStr(exp.dataFine || exp.data_fine || exp.endDate || exp.to || 'Presente'),
        descrizione: cleanStr(exp.descrizione || exp.description || exp.mansioni || exp.tasks),
      }))
      .filter((exp) => exp.ruolo || exp.azienda || exp.descrizione);
  }

  // Istruzione e Formazione
  let istruzione: Istruzione[] = [];
  const rawEdu = source.istruzione || source.education || source.formazione;
  if (Array.isArray(rawEdu)) {
    istruzione = rawEdu
      .map((edu: any, idx: number) => ({
        id: cleanStr(edu.id) || String(idx + 1),
        titolo: cleanStr(edu.titolo || edu.title || edu.qualifica || edu.degree),
        istituto: cleanStr(edu.istituto || edu.institution || edu.scuola || edu.school),
        anno: cleanStr(edu.anno || edu.year || edu.date || edu.periodo),
      }))
      .filter((edu) => edu.titolo || edu.istituto);
  }

  // Lingue
  let lingue: Lingua[] = [];
  const rawLang = source.lingue || source.languages;
  if (Array.isArray(rawLang)) {
    lingue = rawLang
      .map((lang: any, idx: number) => {
        if (typeof lang === 'string') {
          const parts = lang.split(/[:(-]/);
          return {
            id: String(idx + 1),
            lingua: parts[0]?.trim() || lang.trim(),
            livello: parts[1]?.replace(/[)]/g, '').trim() || '',
          };
        }
        return {
          id: cleanStr(lang.id) || String(idx + 1),
          lingua: cleanStr(lang.lingua || lang.language || lang.name),
          livello: cleanStr(lang.livello || lang.level || lang.proficiency),
        };
      })
      .filter((l) => l.lingua);
  }

  // Certificazioni
  let certificazioni: string[] = [];
  const rawCert = source.certificazioni || source.certifications;
  if (Array.isArray(rawCert)) {
    certificazioni = rawCert
      .map((c) => (typeof c === 'string' ? c.trim() : cleanStr(c?.nome || c?.titolo)))
      .filter(Boolean);
  }

  const sintesiBreve = cleanStr(source.sintesiBreve || source.sintesi_breve || source.cv_short_summary);
  const sintesiCompleta = cleanStr(source.sintesiCompleta || source.sintesi_completa || source.cv_full_summary);

  return {
    nome,
    cognome,
    email,
    telefono,
    citta,
    cap,
    indirizzo: indirizzo || undefined,
    dataNascita: dataNascita || undefined,
    patente: patente || undefined,
    profilo,
    targetRole: targetRole || undefined,
    permessoG,
    statoPermesso,
    competenze,
    esperienze,
    istruzione,
    lingue,
    certificazioni,
    sintesiBreve,
    sintesiCompleta,
  };
}
