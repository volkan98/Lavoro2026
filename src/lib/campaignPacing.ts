/**
 * Campaign Pacing and Anti-Spam Safety System for Auto Mode
 *
 * Strict Rules:
 * - Max 50 applications per day per Gmail account (strict cap).
 * - Minimum target: 50 / day.
 * - Max 8 applications per hour (sliding 60-min window).
 * - Random interval between 6 and 12 minutes between subsequent emails.
 * - Never send multiple emails at once or in rapid succession.
 * - After a block of 8–10 applications, enforce a random safety pause of 20–40 minutes.
 * - No automatic catch-up of unsent emails on the same day.
 * - If 50 emails reached today: stop completely until the next calendar day.
 * - Critical Gmail errors (rate limits, suspicious activity, auth, spam): abort Auto Mode immediately and alert user.
 * - Temporary errors: wait at least 30 minutes before any retry attempt (no aggressive retries).
 * - Deduplication & Blacklist checks before sending.
 * - Varied subject lines and personalized content for each company/recipient.
 * - Strict CV attachment verification (PDF format required).
 */

export const PACING_CONSTANTS = {
  DAILY_MAX_SENDS: 50,
  HOURLY_MAX_SENDS: 8,
  MIN_INTERVAL_MS: 6 * 60 * 1000,       // 6 minutes
  MAX_INTERVAL_MS: 12 * 60 * 1000,      // 12 minutes
  MIN_BLOCK_SIZE: 8,                    // 8 applications
  MAX_BLOCK_SIZE: 10,                   // 10 applications
  MIN_BLOCK_PAUSE_MS: 20 * 60 * 1000,   // 20 minutes
  MAX_BLOCK_PAUSE_MS: 40 * 60 * 1000,   // 40 minutes
  TEMP_ERROR_WAIT_MS: 30 * 60 * 1000,   // 30 minutes
} as const;

export type PauseType =
  | 'none'
  | 'interval'          // Regular 6-12 min natural interval
  | 'block_cooldown'    // 20-40 min pause after 8-10 sends
  | 'daily_limit'       // 50/50 reached, stopped until tomorrow
  | 'hourly_limit'      // 8/hr reached, waiting for window to open
  | 'temp_error_cooldown' // 30 min cooldown after temporary error
  | 'gmail_error'       // Aborted due to Gmail rate limit/spam/auth error
  | 'manual';           // Paused by user

export interface PacingState {
  dailyDate: string;                 // YYYY-MM-DD
  dailySentCount: number;            // Count of emails sent on dailyDate (max 50)
  hourlySentTimestamps: number[];    // Timestamps of sends in last 60 min
  currentBlockSends: number;         // Count towards current block (0..target)
  currentBlockTarget: number;        // Target for this block (8..10)
  nextScheduledSendAt: number | null;// Timestamp when next send is allowed
  pauseType: PauseType;
  pauseReason: string | null;
  gmailError: string | null;
  lastSentAt: string | null;
}

const STORAGE_KEY_PREFIX = 'ais_automode_pacing_state_';

export function getTodayDateString(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function getRandomIntervalMs(): number {
  const min = PACING_CONSTANTS.MIN_INTERVAL_MS;
  const max = PACING_CONSTANTS.MAX_INTERVAL_MS;
  return Math.floor(min + Math.random() * (max - min));
}

export function getRandomBlockTarget(): number {
  const min = PACING_CONSTANTS.MIN_BLOCK_SIZE;
  const max = PACING_CONSTANTS.MAX_BLOCK_SIZE;
  return Math.floor(min + Math.random() * (max - min + 1));
}

export function getRandomBlockPauseMs(): number {
  const min = PACING_CONSTANTS.MIN_BLOCK_PAUSE_MS;
  const max = PACING_CONSTANTS.MAX_BLOCK_PAUSE_MS;
  return Math.floor(min + Math.random() * (max - min));
}

export function cleanHourlyTimestamps(timestamps: number[], now = Date.now()): number[] {
  const oneHourAgo = now - 60 * 60 * 1000;
  return timestamps.filter((t) => typeof t === 'number' && t > oneHourAgo);
}

export function loadPacingState(userId = 'user_blunero90'): PacingState {
  const today = getTodayDateString();
  const defaultState: PacingState = {
    dailyDate: today,
    dailySentCount: 0,
    hourlySentTimestamps: [],
    currentBlockSends: 0,
    currentBlockTarget: getRandomBlockTarget(),
    nextScheduledSendAt: null,
    pauseType: 'none',
    pauseReason: null,
    gmailError: null,
    lastSentAt: null,
  };

  try {
    const raw = localStorage.getItem(`${STORAGE_KEY_PREFIX}${userId}`);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        // Check if date rolled over to a new day
        if (parsed.dailyDate !== today) {
          return {
            ...defaultState,
            // Retain any ongoing fatal Gmail error or manual pause if needed, but reset daily count
            gmailError: parsed.gmailError || null,
            pauseType: parsed.gmailError ? 'gmail_error' : 'none',
            pauseReason: parsed.gmailError ? parsed.pauseReason : null,
          };
        }

        // Clean hourly timestamps
        const cleanedHourly = cleanHourlyTimestamps(parsed.hourlySentTimestamps || []);

        return {
          ...defaultState,
          ...parsed,
          dailyDate: today,
          dailySentCount: typeof parsed.dailySentCount === 'number' ? parsed.dailySentCount : 0,
          hourlySentTimestamps: cleanedHourly,
          currentBlockSends: typeof parsed.currentBlockSends === 'number' ? parsed.currentBlockSends : 0,
          currentBlockTarget: typeof parsed.currentBlockTarget === 'number' ? parsed.currentBlockTarget : getRandomBlockTarget(),
        };
      }
    }
  } catch (err) {
    console.warn('[Pacing] Error loading pacing state:', err);
  }

  return defaultState;
}

export function savePacingState(state: PacingState, userId = 'user_blunero90'): void {
  try {
    localStorage.setItem(`${STORAGE_KEY_PREFIX}${userId}`, JSON.stringify(state));
  } catch (err) {
    console.warn('[Pacing] Error saving pacing state:', err);
  }
}

/**
 * Evaluates whether an email can be sent right now according to all anti-spam rules.
 */
export function checkCanSendNow(state: PacingState, now = Date.now()): {
  allowed: boolean;
  reason?: string;
  waitMs?: number;
  pauseType: PauseType;
} {
  const today = getTodayDateString();

  // 1. Check if date rolled over
  if (state.dailyDate !== today) {
    return { allowed: true, pauseType: 'none' };
  }

  // 2. Fatal Gmail error check
  if (state.gmailError) {
    return {
      allowed: false,
      reason: `Auto Mode interrotto per sicurezza: ${state.gmailError}`,
      pauseType: 'gmail_error',
    };
  }

  // 3. Strict daily limit: 50 emails max
  if (state.dailySentCount >= PACING_CONSTANTS.DAILY_MAX_SENDS) {
    // Calculate wait until tomorrow midnight
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 5, 0, 0); // 00:05 AM tomorrow
    const waitTillTomorrow = Math.max(tomorrow.getTime() - now, 60000);

    return {
      allowed: false,
      reason: `Limite giornaliero rigido raggiunto (${state.dailySentCount}/${PACING_CONSTANTS.DAILY_MAX_SENDS} candidature). Gli invii riprenderanno domani.`,
      waitMs: waitTillTomorrow,
      pauseType: 'daily_limit',
    };
  }

  // 4. Strict hourly limit: 8 emails max in sliding 60 minutes
  const activeHourly = cleanHourlyTimestamps(state.hourlySentTimestamps, now);
  if (activeHourly.length >= PACING_CONSTANTS.HOURLY_MAX_SENDS) {
    // Find when oldest timestamp exits the 60-min window
    const oldestTimestamp = Math.min(...activeHourly);
    const windowExpiresAt = oldestTimestamp + 60 * 60 * 1000 + 5000; // 5s safety buffer
    const waitMs = Math.max(windowExpiresAt - now, 10000);

    return {
      allowed: false,
      reason: `Limite orario raggiunto (${activeHourly.length}/${PACING_CONSTANTS.HOURLY_MAX_SENDS} email nell'ultima ora). Attesa di apertura della finestra oraria.`,
      waitMs,
      pauseType: 'hourly_limit',
    };
  }

  // 5. Next scheduled send timestamp (natural interval or block cooldown)
  if (state.nextScheduledSendAt && state.nextScheduledSendAt > now) {
    const waitMs = state.nextScheduledSendAt - now;
    const minutesLeft = Math.ceil(waitMs / 60000);

    const defaultMsg = state.pauseType === 'block_cooldown'
      ? `Pausa di sicurezza blocco (${minutesLeft} min rimanenti) per proteggere la reputazione del mittente.`
      : state.pauseType === 'temp_error_cooldown'
      ? `Attesa precauzionale post-errore (${minutesLeft} min rimanenti). Nessun retry aggressivo.`
      : `Intervallo naturale tra email (${minutesLeft} min rimanenti) per un invio graduale e umano.`;

    return {
      allowed: false,
      reason: state.pauseReason || defaultMsg,
      waitMs,
      pauseType: state.pauseType !== 'none' ? state.pauseType : 'interval',
    };
  }

  return { allowed: true, pauseType: 'none' };
}

/**
 * Updates pacing state after a successful email send:
 * - Increments daily count.
 * - Appends to hourly timestamps.
 * - Increments block counter and determines whether to schedule block pause (20-40 min) or normal interval (6-12 min).
 */
export function recordSendSuccess(
  prevState: PacingState,
  now = Date.now()
): {
  updatedState: PacingState;
  nextIntervalMs: number;
  isBlockPause: boolean;
  isDailyLimitReached: boolean;
} {
  const today = getTodayDateString();
  const isNewDay = prevState.dailyDate !== today;

  const currentDailyCount = (isNewDay ? 0 : prevState.dailySentCount) + 1;
  const currentBlockSends = (isNewDay ? 0 : prevState.currentBlockSends) + 1;
  const blockTarget = prevState.currentBlockTarget || getRandomBlockTarget();

  const cleanedHourly = cleanHourlyTimestamps(isNewDay ? [] : prevState.hourlySentTimestamps, now);
  cleanedHourly.push(now);

  let nextIntervalMs = 0;
  let isBlockPause = false;
  let isDailyLimitReached = false;
  let pauseType: PauseType = 'none';
  let pauseReason: string | null = null;
  let newBlockSends = currentBlockSends;
  let newBlockTarget = blockTarget;

  // 1. Check if strict daily limit of 50 reached
  if (currentDailyCount >= PACING_CONSTANTS.DAILY_MAX_SENDS) {
    isDailyLimitReached = true;
    pauseType = 'daily_limit';
    pauseReason = `Limite giornaliero rigido raggiunto (${currentDailyCount}/${PACING_CONSTANTS.DAILY_MAX_SENDS} invii). Invii sospesi fino a domani.`;

    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 5, 0, 0);
    nextIntervalMs = Math.max(tomorrow.getTime() - now, 60000);
  }
  // 2. Check if block pause of 8-10 sends reached
  else if (currentBlockSends >= blockTarget) {
    isBlockPause = true;
    pauseType = 'block_cooldown';
    nextIntervalMs = getRandomBlockPauseMs(); // 20 to 40 minutes
    const pauseMinutes = Math.round(nextIntervalMs / 60000);
    pauseReason = `Pausa di sicurezza: inviate ${currentBlockSends} candidature consecutive. Pausa programmata di ${pauseMinutes} minuti per evitare filtri antispam.`;
    newBlockSends = 0;
    newBlockTarget = getRandomBlockTarget();
  }
  // 3. Regular gradual interval: 6 to 12 minutes
  else {
    pauseType = 'interval';
    nextIntervalMs = getRandomIntervalMs(); // 6 to 12 minutes
    const intervalMin = (nextIntervalMs / 60000).toFixed(1);
    pauseReason = `Intervallo naturale di ${intervalMin} min per simulare comportamento umano ed evitare classificazione spam.`;
  }

  const updatedState: PacingState = {
    ...prevState,
    dailyDate: today,
    dailySentCount: currentDailyCount,
    hourlySentTimestamps: cleanedHourly,
    currentBlockSends: newBlockSends,
    currentBlockTarget: newBlockTarget,
    nextScheduledSendAt: now + nextIntervalMs,
    pauseType,
    pauseReason,
    lastSentAt: new Date(now).toISOString(),
  };

  return {
    updatedState,
    nextIntervalMs,
    isBlockPause,
    isDailyLimitReached,
  };
}

/**
 * Checks if an error returned by Gmail indicates rate-limiting, spam warning, suspicious activity, or auth failure.
 */
export function isGmailFatalOrSuspiciousError(errorStr: string): boolean {
  if (!errorStr) return false;
  const lower = errorStr.toLowerCase();

  const patterns = [
    'ratelimit',
    'rate limit',
    'userratelimitexceeded',
    'dailylimitexceeded',
    'quotaexceeded',
    '429',
    'suspicious',
    'spam',
    'blocked',
    'abuse',
    'security',
    'account suspended',
    'temporarily disabled',
    'invalid_grant',
    'token has been expired or revoked',
    'unauthorized',
    'forbidden',
    'insufficient permissions',
    'limite di invio superato',
    'comportamento insolito',
  ];

  return patterns.some((p) => lower.includes(p));
}

/**
 * Handles error pacing:
 * - If Gmail fatal/suspicious: stops immediately with a user alert.
 * - If temporary: enforces a 30-minute minimum cooldown before any retry (no aggressive retries).
 */
export function recordSendError(
  prevState: PacingState,
  errorMessage: string,
  now = Date.now()
): {
  updatedState: PacingState;
  isFatalGmail: boolean;
  waitMs: number;
  reason: string;
} {
  const isFatal = isGmailFatalOrSuspiciousError(errorMessage);

  if (isFatal) {
    const reason = `Errore critico Gmail (${errorMessage}). Auto Mode interrotto per proteggere l'account.`;
    const updatedState: PacingState = {
      ...prevState,
      gmailError: errorMessage,
      pauseType: 'gmail_error',
      pauseReason: reason,
      nextScheduledSendAt: null,
    };
    return {
      updatedState,
      isFatalGmail: true,
      waitMs: 0,
      reason,
    };
  }

  // Temporary error: enforce 30-minute calm-down period
  const waitMs = PACING_CONSTANTS.TEMP_ERROR_WAIT_MS; // 30 minutes
  const reason = `Errore temporaneo di invio (${errorMessage}). Attesa precauzionale di 30 minuti prima del prossimo tentativo per salvaguardare la reputazione.`;

  const updatedState: PacingState = {
    ...prevState,
    nextScheduledSendAt: now + waitMs,
    pauseType: 'temp_error_cooldown',
    pauseReason: reason,
  };

  return {
    updatedState,
    isFatalGmail: false,
    waitMs,
    reason,
  };
}

/**
 * Generates personalized, varied email subject and content to prevent identical spam templates.
 */
export function generateVariedEmail(params: {
  candidateName: string;
  companyName: string;
  companyCity?: string | null;
  companySector?: string | null;
  skills?: string[];
  style?: string;
  seedIndex?: number;
}): { subject: string; bodyText: string } {
  const {
    candidateName,
    companyName,
    companyCity = 'Ticino',
    companySector = 'settore tecnico / produttivo',
    skills = [],
    seedIndex = Math.floor(Math.random() * 100),
  } = params;

  const loc = companyCity || 'Canton Ticino';
  const roleKeywords = skills.length > 0 ? skills.slice(0, 2).join(' e ') : 'mansioni tecniche / operative';

  // 1. Varied Subject Lines (rotates based on seedIndex to avoid identical inbox subjects)
  const subjectTemplates = [
    `Candidatura Spontanea - ${candidateName} (Disponibilità Frontaliere ${loc} / Permesso G)`,
    `${candidateName} - Autocandidatura per opportunità lavorative presso ${companyName}`,
    `Candidatura: disponibilità per ${companyName} (${loc}) - ${candidateName}`,
    `All'attenzione delle Risorse Umane di ${companyName} - Candidatura ${candidateName}`,
    `Proposta di candidatura: ${roleKeywords} - ${candidateName} (Frontaliere Ticino)`,
    `Candidatura spontanea per il vostro organico a ${loc} - ${candidateName}`,
  ];

  const subject = subjectTemplates[seedIndex % subjectTemplates.length];

  // 2. Varied Salutations
  const salutations = [
    `Gentile Responsabile Risorse Umane di ${companyName},`,
    `Alla cortese attenzione del Team Risorse Umane di ${companyName},`,
    `Gentile Direzione e Ufficio del Personale di ${companyName},`,
    `Spettabile ${companyName}, all'attenzione del dipartimento HR,`,
  ];
  const salutation = salutations[seedIndex % salutations.length];

  // 3. Varied Openings
  const openings = [
    `desidero sottoporre alla Vostra cortese attenzione la mia candidatura spontanea per eventuali opportunità lavorative aperte presso la Vostra sede di ${loc}.`,
    `con la presente desidero manifestare il mio vivo interesse a collaborare con la Vostra azienda nel contesto delle Vostre attività a ${loc}.`,
    `Le scrivo per proporre il mio profilo professionale per possibili inserimenti lavorativi all'interno del Vostro organico aziendale a ${loc}.`,
    `mi permetto di trasmettere il mio profilo professionale in vista di future ricerche di personale qualificato per la Vostra struttura di ${loc}.`,
  ];
  const opening = openings[seedIndex % openings.length];

  // 4. Swiss Permesso G readiness formulation
  const swissStatus = [
    `Residente in zona di confine e immediatamente disponibile, possiedo piena idoneità per l'attività lavorativa in Svizzera con rilascio del Permesso G (Frontalieri).`,
    `Grazie alla vicinanza geografica con il Ticino, posso garantire massima puntualità, flessibilità negli orari e immediata disponibilità con Permesso G per frontalieri.`,
    `Sono cittadino comunitario residente nella fascia frontaliera, pronto a prendere servizio tempestivamente con la necessaria procedura per il Permesso G.`,
  ];
  const swissPart = swissStatus[seedIndex % swissStatus.length];

  // 5. Varied closings
  const closings = [
    `Allego alla presente il mio Curriculum Vitae dettagliato in formato PDF e resto a completa disposizione per un colloquio conoscitivo, anche con breve preavviso.`,
    `In allegato troverete il mio Curriculum Vitae aggiornato (PDF). RingraziandoVi per l'attenzione riservatami, rimango a Vostra disposizione per qualsiasi approfondimento.`,
    `Trasmetto in allegato il mio CV in PDF per una Vostra valutazione e sarei lieto di poter illustrare di persona le mie esperienze in un colloquio conoscitivo.`,
  ];
  const closing = closings[seedIndex % closings.length];

  const bodyText = `${salutation}\n\n` +
    `${opening}\n\n` +
    `Ho maturato esperienza pratica nel settore (${companySector}), sviluppando precisione, affidabilità e capacità di lavorare sia in autonomia che in squadra.\n\n` +
    `${swissPart}\n\n` +
    `${closing}\n\n` +
    `Cordiali saluti,\n` +
    `${candidateName}`;

  return { subject, bodyText };
}
