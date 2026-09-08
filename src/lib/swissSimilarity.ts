import { Azienda } from '@/types/cv';

export interface SwissLocation {
  zip: string;
  city: string;
  canton: string;
  region: 'Luganese' | 'Mendrisiotto' | 'Bellinzonese' | 'Locarnese' | 'Altro';
  distanceFromBioggioKm: number;
  priority: number; // 1 = Bioggio/Vedeggio (0-5km), 2 = Luganese (5-10km), 3 = North corridor (10-15km), 4 = Bellinzona boundary, 99 = excluded
  isExcluded?: boolean;
}

// Focus prioritario: Bioggio -> Vedeggio -> Lugano e dintorni (10-15 min da Bioggio)
export const TICINO_MUNICIPALITIES: SwissLocation[] = [
  { zip: '6934', city: 'Bioggio', canton: 'TI', region: 'Luganese', distanceFromBioggioKm: 0, priority: 1 },
  { zip: '6928', city: 'Manno', canton: 'TI', region: 'Luganese', distanceFromBioggioKm: 2, priority: 1 },
  { zip: '6814', city: 'Lamone', canton: 'TI', region: 'Luganese', distanceFromBioggioKm: 3, priority: 1 },
  { zip: '6814', city: 'Cadempino', canton: 'TI', region: 'Luganese', distanceFromBioggioKm: 3, priority: 1 },
  { zip: '6929', city: 'Gravesano', canton: 'TI', region: 'Luganese', distanceFromBioggioKm: 3, priority: 1 },
  { zip: '6930', city: 'Bedano', canton: 'TI', region: 'Luganese', distanceFromBioggioKm: 4, priority: 1 },
  { zip: '6982', city: 'Agno', canton: 'TI', region: 'Luganese', distanceFromBioggioKm: 4, priority: 1 },
  { zip: '6807', city: 'Taverne', canton: 'TI', region: 'Luganese', distanceFromBioggioKm: 5, priority: 1 },
  { zip: '6808', city: 'Torricella', canton: 'TI', region: 'Luganese', distanceFromBioggioKm: 5, priority: 1 },
  { zip: '6933', city: 'Muzzano', canton: 'TI', region: 'Luganese', distanceFromBioggioKm: 4, priority: 1 },
  { zip: '6943', city: 'Vezia', canton: 'TI', region: 'Luganese', distanceFromBioggioKm: 4, priority: 2 },
  { zip: '6942', city: 'Savosa', canton: 'TI', region: 'Luganese', distanceFromBioggioKm: 5, priority: 2 },
  { zip: '6900', city: 'Lugano', canton: 'TI', region: 'Luganese', distanceFromBioggioKm: 6, priority: 2 },
  { zip: '6948', city: 'Porza', canton: 'TI', region: 'Luganese', distanceFromBioggioKm: 5, priority: 2 },
  { zip: '6944', city: 'Cureglia', canton: 'TI', region: 'Luganese', distanceFromBioggioKm: 6, priority: 2 },
  { zip: '6805', city: 'Mezzovico', canton: 'TI', region: 'Luganese', distanceFromBioggioKm: 9, priority: 2 },
  { zip: '6804', city: 'Bironico', canton: 'TI', region: 'Luganese', distanceFromBioggioKm: 11, priority: 3 },
  { zip: '6802', city: 'Rivera', canton: 'TI', region: 'Luganese', distanceFromBioggioKm: 12, priority: 3 },
  { zip: '6593', city: 'Cadenazzo', canton: 'TI', region: 'Bellinzonese', distanceFromBioggioKm: 20, priority: 3 },
  { zip: '6592', city: 'S. Antonino', canton: 'TI', region: 'Bellinzonese', distanceFromBioggioKm: 22, priority: 4 },
  { zip: '6500', city: 'Bellinzona', canton: 'TI', region: 'Bellinzonese', distanceFromBioggioKm: 28, priority: 4 },

  // Esclusi esplicitamente (Mendrisiotto, Chiasso, Italia, Svizzera interna)
  { zip: '6850', city: 'Mendrisio', canton: 'TI', region: 'Mendrisiotto', distanceFromBioggioKm: 22, priority: 99, isExcluded: true },
  { zip: '6830', city: 'Chiasso', canton: 'TI', region: 'Mendrisiotto', distanceFromBioggioKm: 28, priority: 99, isExcluded: true },
  { zip: '6828', city: 'Balerna', canton: 'TI', region: 'Mendrisiotto', distanceFromBioggioKm: 26, priority: 99, isExcluded: true },
  { zip: '6855', city: 'Stabio', canton: 'TI', region: 'Mendrisiotto', distanceFromBioggioKm: 24, priority: 99, isExcluded: true },
  { zip: '6834', city: 'Morbio Inferiore', canton: 'TI', region: 'Mendrisiotto', distanceFromBioggioKm: 27, priority: 99, isExcluded: true },
];

export const TICINO_CITIES = [
  'Bioggio',
  'Manno',
  'Lamone',
  'Cadempino',
  'Gravesano',
  'Bedano',
  'Agno',
  'Taverne',
  'Torricella',
  'Lugano',
  'Vezia',
  'Mezzovico',
  'Cadenazzo',
  'Bellinzona',
];

export const SWISS_CITIES = TICINO_CITIES; // Riconcentrata rigidamente sull'asse Bioggio/Lugano/Ticino

export const EXCLUDED_REGIONS = [
  'mendrisio',
  'chiasso',
  'balerna',
  'stabio',
  'morbio',
  'novazzano',
  'vacallo',
  'coldrerio',
  'riva san vitale',
  'capolago',
  'genestrerio',
  'besazio',
  'italia',
  'como',
  'varese',
  'milano',
  'zurigo',
  'zurich',
  'bern',
  'berna',
  'basilea',
  'basel',
  'ginevra',
  'geneva',
  'lausanne',
  'losanna',
];

export function isLocationExcluded(cityOrZip?: string): boolean {
  if (!cityOrZip) return false;
  const norm = cityOrZip.toLowerCase().trim();
  return EXCLUDED_REGIONS.some((ex) => norm.includes(ex));
}

export function getLocationPriority(cityOrZip?: string): { priority: number; distanceKm: number; isAllowed: boolean } {
  if (!cityOrZip) return { priority: 2, distanceKm: 8, isAllowed: true };
  if (isLocationExcluded(cityOrZip)) {
    return { priority: 99, distanceKm: 99, isAllowed: false };
  }

  const norm = cityOrZip.toLowerCase().trim();
  const match = TICINO_MUNICIPALITIES.find(
    (m) => norm.includes(m.city.toLowerCase()) || (m.zip && norm.includes(m.zip))
  );

  if (match) {
    return {
      priority: match.priority,
      distanceKm: match.distanceFromBioggioKm,
      isAllowed: !match.isExcluded && match.priority <= 4,
    };
  }

  return { priority: 2, distanceKm: 8, isAllowed: true };
}

export interface ScoredAzienda extends Azienda {
  similarityScore: number;
  finalScore: number;
  matchReasons?: string[];
}

export interface SimilarityWeights {
  sector: number;
  location: number;
  emailQuality: number;
  skills: number;
}

export const DEFAULT_WEIGHTS: SimilarityWeights = {
  sector: 0.35,
  location: 0.30,
  emailQuality: 0.20,
  skills: 0.15,
};

export function dedupeKeys(a: Partial<Azienda>): string[] {
  const keys: string[] = [];
  if (a.email) {
    const e = a.email.toLowerCase().trim();
    keys.push(`email:${e}`);
    if (e.includes('@')) {
      const dom = e.split('@')[1];
      if (dom && !['gmail.com', 'hotmail.com', 'yahoo.it', 'outlook.com', 'bluewin.ch'].includes(dom)) {
        keys.push(`dom:${dom}`);
      }
    }
  }
  if (a.nome) {
    const cleanName = a.nome
      .toLowerCase()
      .replace(/\b(sa|sagl|ag|gmbh|srl|spa|snc|ltd|llc|inc|ch)\b/gi, '')
      .replace(/[^a-z0-9]/g, '')
      .trim();
    if (cleanName.length > 2) {
      keys.push(`name:${cleanName}`);
    }
  }
  if (a.sito) {
    try {
      const url = a.sito.startsWith('http') ? a.sito : `http://${a.sito}`;
      const hostname = new URL(url).hostname.replace(/^www\./, '').toLowerCase();
      keys.push(`web:${hostname}`);
    } catch {
      // ignore
    }
  }
  return keys;
}

export function mergeCompany(existing: Azienda, incoming: Azienda): Azienda {
  return {
    ...existing,
    email: existing.email || incoming.email || null,
    sito: existing.sito || incoming.sito || '',
    telefono: existing.telefono || incoming.telefono || '',
    indirizzo: existing.indirizzo || incoming.indirizzo || '',
    citta: existing.citta || incoming.citta || '',
    settore: existing.settore || incoming.settore || 'Verniciatura / Trattamento Superfici',
    emailVerified: existing.emailVerified || incoming.emailVerified || 'unverified',
    confidenceScore: Math.max(existing.confidenceScore || 0, incoming.confidenceScore || 0),
    finalStatus:
      existing.finalStatus === 'ready_to_send' || incoming.finalStatus === 'ready_to_send'
        ? 'ready_to_send'
        : existing.finalStatus || incoming.finalStatus || 'risky_send',
  };
}

export function scoreCompany(
  a: Azienda,
  skills: string[] = [],
  weights: SimilarityWeights = DEFAULT_WEIGHTS
): ScoredAzienda {
  let sectorScore = 60;
  const settNorm = (a.settore || '').toLowerCase();
  const nomeNorm = (a.nome || '').toLowerCase();

  if (
    settNorm.includes('vernic') ||
    settNorm.includes('polvere') ||
    settNorm.includes('sabbiat') ||
    settNorm.includes('superfici') ||
    nomeNorm.includes('vernic') ||
    nomeNorm.includes('powder') ||
    nomeNorm.includes('lackier')
  ) {
    sectorScore = 100;
  } else if (
    settNorm.includes('metalloc') ||
    settNorm.includes('carpenteria') ||
    settNorm.includes('metalmecc') ||
    settNorm.includes('industri') ||
    settNorm.includes('carrozzeria')
  ) {
    sectorScore = 80;
  }

  const locInfo = getLocationPriority(a.citta);
  let locScore = 70;
  if (!locInfo.isAllowed) {
    locScore = 10;
  } else if (locInfo.priority === 1) {
    locScore = 100; // Bioggio & immediate Vedeggio area
  } else if (locInfo.priority === 2) {
    locScore = 85; // Lugano & suburbs
  } else if (locInfo.priority === 3) {
    locScore = 70;
  } else {
    locScore = 50;
  }

  let emailScore = 20;
  if (a.email && a.email.includes('@')) {
    if (a.emailVerified === 'verified_official') emailScore = 100;
    else if (a.emailVerified === 'verified_directory') emailScore = 80;
    else emailScore = 65;
  }

  let skillsScore = 50;
  if (skills.length > 0) {
    const matched = skills.filter((s) =>
      settNorm.includes(s.toLowerCase()) || nomeNorm.includes(s.toLowerCase())
    );
    skillsScore = Math.min(100, 50 + matched.length * 20);
  }

  const similarityScore = Math.round(
    sectorScore * weights.sector +
      locScore * weights.location +
      emailScore * weights.emailQuality +
      skillsScore * weights.skills
  );

  const finalScore = Math.round(
    similarityScore * 0.7 + (a.confidenceScore || 50) * 0.3
  );

  const matchReasons: string[] = [];
  if (locInfo.priority === 1) matchReasons.push(`Vicinanza immediata (${locInfo.distanceKm} km da Bioggio)`);
  if (sectorScore >= 80) matchReasons.push('Settore verniciatura/metalmeccanica altamente compatibile');
  if (a.email) matchReasons.push('Email aziendale disponibile');

  return {
    ...a,
    similarityScore,
    finalScore,
    matchReasons,
  };
}

export function similarityLabel(score: number): { label: string; color: string } {
  if (score >= 85) return { label: 'Eccellente', color: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400' };
  if (score >= 70) return { label: 'Alta', color: 'bg-blue-500/15 text-blue-700 dark:text-blue-400' };
  if (score >= 50) return { label: 'Media', color: 'bg-amber-500/15 text-amber-700 dark:text-amber-400' };
  return { label: 'Bassa', color: 'bg-muted text-muted-foreground' };
}
