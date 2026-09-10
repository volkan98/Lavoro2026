import { db } from '@/lib/firebase';
import { collection, getDocs } from 'firebase/firestore';
import { requireUid } from '@/lib/api/client';

export interface DeduplicationCheckResult {
  isAlreadySent: boolean;
  matchType?: 'email' | 'domain' | 'company_id' | 'company_name';
  matchedRecord?: any;
  detail?: string;
}

export interface CandidateCompanyTarget {
  id?: string;
  companyId?: string;
  company_id?: string;
  name?: string;
  company_name?: string;
  email?: string;
  company_email?: string;
  domain?: string;
  website?: string;
  company_website?: string;
  city?: string;
  company_city?: string;
}

/**
 * Common public webmail and generic ISP email domains.
 * Matches on these domains will NOT trigger a domain-level duplicate flag,
 * preventing two different businesses using @gmail.com or @bluewin.ch from being falsely deduplicated.
 */
export const GENERIC_EMAIL_DOMAINS = new Set([
  'gmail.com',
  'googlemail.com',
  'outlook.com',
  'outlook.it',
  'hotmail.com',
  'hotmail.it',
  'live.com',
  'live.it',
  'msn.com',
  'yahoo.com',
  'yahoo.it',
  'yahoo.fr',
  'yahoo.de',
  'icloud.com',
  'me.com',
  'mac.com',
  'libero.it',
  'virgilio.it',
  'tiscali.it',
  'alice.it',
  'tim.it',
  'fastwebnet.it',
  'tin.it',
  'bluewin.ch',
  'swissonline.ch',
  'gmx.net',
  'gmx.ch',
  'gmx.de',
  'gmx.at',
  'web.de',
  'proton.me',
  'protonmail.com',
  'mail.com',
  'zoho.com',
  'aol.com',
  'yandex.com',
  'inbox.com',
  'posteo.de',
  'posteo.net',
]);

/**
 * Normalizes an email address (lowercase, trim).
 */
export function normalizeEmail(email?: string | null): string {
  if (!email || typeof email !== 'string') return '';
  return email.trim().toLowerCase();
}

/**
 * Extracts and normalizes the domain from an email address.
 */
export function extractEmailDomain(email?: string | null): string {
  const norm = normalizeEmail(email);
  if (!norm || !norm.includes('@')) return '';
  const parts = norm.split('@');
  return (parts[parts.length - 1] || '').trim().toLowerCase();
}

/**
 * Extracts domain/hostname from a website URL.
 */
export function extractWebsiteDomain(websiteUrl?: string | null): string {
  if (!websiteUrl || typeof websiteUrl !== 'string') return '';
  try {
    let clean = websiteUrl.trim().toLowerCase();
    if (!/^https?:\/\//i.test(clean)) {
      clean = `http://${clean}`;
    }
    const parsed = new URL(clean);
    return parsed.hostname.replace(/^www\./i, '').trim().toLowerCase();
  } catch {
    return websiteUrl.replace(/^https?:\/\//i, '').replace(/^www\./i, '').split('/')[0].trim().toLowerCase();
  }
}

/**
 * Checks if an email domain is a generic public webmail provider.
 */
export function isGenericEmailDomain(domain?: string | null): boolean {
  if (!domain) return false;
  const d = domain.trim().toLowerCase();
  return GENERIC_EMAIL_DOMAINS.has(d);
}

/**
 * Normalizes a company name for fuzzy/exact matching by removing corporate legal suffixes and punctuation.
 */
export function normalizeCompanyName(name?: string | null): string {
  if (!name || typeof name !== 'string') return '';
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // remove accents
    .replace(/\b(s\.?a\.?|s\.?a\.?g\.?l\.?|s\.?r\.?l\.?|s\.?p\.?a\.?|s\.?n\.?c\.?|s\.?a\.?s\.?|a\.?g\.?|gmbh|ltd|inc|corp|llc|holding|group)\b/gi, '')
    .replace(/[^a-z0-9]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Normalizes a company ID (ignoring generic auto-generated queue/search prefixes).
 */
export function normalizeCompanyId(id?: string | null): string {
  if (!id || typeof id !== 'string') return '';
  const trimmed = id.trim();
  // If it's a transient frontend queue ID (e.g. queue_17123...), don't treat it as a database companyId
  if (/^(queue_|temp_|evt_|log_|manual_)/i.test(trimmed)) {
    return '';
  }
  return trimmed;
}

/**
 * Evaluates whether a candidate company matches an existing sent email record from Firestore.
 */
export function isCompanyMatchSentRecord(
  candidate: CandidateCompanyTarget,
  sentRecord: any
): { isMatch: boolean; matchType?: 'email' | 'domain' | 'company_id' | 'company_name'; detail?: string } {
  if (!candidate || !sentRecord) return { isMatch: false };

  // 1. Recipient email extraction
  const candidateEmail = normalizeEmail(candidate.email || candidate.company_email);
  const recordEmail = normalizeEmail(sentRecord.email || sentRecord.company_email || sentRecord.recipient || sentRecord.to);

  // CRITERION 1: Stessa Email Destinatario
  if (candidateEmail && recordEmail && candidateEmail === recordEmail) {
    return {
      isMatch: true,
      matchType: 'email',
      detail: `Stessa email destinatario (${candidateEmail})`,
    };
  }

  // 2. Email & Website Domain extraction
  const candidateEmailDomain = extractEmailDomain(candidateEmail);
  const candidateWebDomain = extractWebsiteDomain(candidate.website || candidate.company_website);
  const recordEmailDomain = extractEmailDomain(recordEmail) || (sentRecord.domain ? sentRecord.domain.toLowerCase().trim() : '');

  // CRITERION 2: Stesso Dominio Email (escludendo webmail generiche)
  if (recordEmailDomain && !isGenericEmailDomain(recordEmailDomain)) {
    if (candidateEmailDomain && !isGenericEmailDomain(candidateEmailDomain) && candidateEmailDomain === recordEmailDomain) {
      return {
        isMatch: true,
        matchType: 'domain',
        detail: `Stesso dominio email aziendale (${candidateEmailDomain})`,
      };
    }
    if (candidateWebDomain && !isGenericEmailDomain(candidateWebDomain) && candidateWebDomain === recordEmailDomain) {
      return {
        isMatch: true,
        matchType: 'domain',
        detail: `Dominio sito web corrisponde al dominio email aziendale già contattato (${recordEmailDomain})`,
      };
    }
  }

  // 3. Company ID extraction
  const candidateId = normalizeCompanyId(candidate.companyId || candidate.company_id || candidate.id);
  const recordCompanyId = normalizeCompanyId(sentRecord.companyId || sentRecord.company_id || sentRecord.company_code);

  // CRITERION 3: Stesso Company ID (se disponibile)
  if (candidateId && recordCompanyId && candidateId === recordCompanyId) {
    return {
      isMatch: true,
      matchType: 'company_id',
      detail: `Stesso identificativo aziendale (${candidateId})`,
    };
  }

  // 4. Normalized Company Name extraction (extra safety)
  const candidateName = normalizeCompanyName(candidate.name || candidate.company_name);
  const recordName = normalizeCompanyName(sentRecord.company_name || sentRecord.companyName);

  if (candidateName && recordName && candidateName.length >= 3 && candidateName === recordName) {
    return {
      isMatch: true,
      matchType: 'company_name',
      detail: `Stesso nome azienda normalizzato ("${candidate.name || candidate.company_name}")`,
    };
  }

  return { isMatch: false };
}

/**
 * Fetches the complete "Già Inviato" (Sent Emails) history directly from Firestore (primary source of truth).
 * Combines sentEmails subcollection and legacy sent_emails subcollection additively.
 */
export async function fetchFirestoreSentEmailsHistory(
  userId: string = requireUid(),
  options: { timeoutMs?: number } = {}
): Promise<any[]> {
  requireUid(userId);
  const recordsMap = new Map<string, any>();
  const timeoutMs = options.timeoutMs || 10000;

  // 1. Live Firestore sentEmails collection (Primary Source of Truth)
  try {
    const sentColRef = collection(db, 'users', userId, 'sentEmails');
    const docsPromise = getDocs(sentColRef);
    const timeoutPromise = new Promise<null>((res) => setTimeout(() => res(null), timeoutMs));
    const snap = await Promise.race([docsPromise, timeoutPromise]);

    if (snap && !snap.empty) {
      snap.docs.forEach((d) => {
        const data = d.data();
        const key = data.id || d.id || data.message_id || `${data.email}_${data.sent_at}`;
        recordsMap.set(key, { ...data, id: data.id || d.id, status: data.status || 'sent' });
      });
    }
  } catch (fbErr) {
    console.warn('[Firestore Sent History] Firestore read warning:', fbErr);
  }

  // 2. Legacy Firestore sent_emails collection (Additive migration check)
  try {
    const legacyColRef = collection(db, 'users', userId, 'sent_emails');
    const snapLegacy = await getDocs(legacyColRef).catch(() => null);
    if (snapLegacy && !snapLegacy.empty) {
      snapLegacy.docs.forEach((d) => {
        const data = d.data();
        const key = data.id || d.id || data.message_id || `${data.email}_${data.sent_at}`;
        if (!recordsMap.has(key)) {
          recordsMap.set(key, { ...data, id: data.id || d.id, status: data.status || 'sent' });
        }
      });
    }
  } catch {}

  return Array.from(recordsMap.values());
}

/**
 * Checks whether a single company has already been contacted, querying Firestore as the source of truth.
 */
export async function isCompanyAlreadySentFirestore(
  candidate: CandidateCompanyTarget,
  userId: string = requireUid(),
  prefetchedSentHistory?: any[]
): Promise<DeduplicationCheckResult> {
  const sentRecords = prefetchedSentHistory || (await fetchFirestoreSentEmailsHistory(userId));

  for (const record of sentRecords) {
    const matchRes = isCompanyMatchSentRecord(candidate, record);
    if (matchRes.isMatch) {
      return {
        isAlreadySent: true,
        matchType: matchRes.matchType,
        matchedRecord: record,
        detail: matchRes.detail,
      };
    }
  }

  return { isAlreadySent: false };
}

/**
 * Filters a list of candidate companies (e.g. from Auto Mode search),
 * removing any company already present in Firestore "Già Inviato".
 */
export async function filterUncontactedCompaniesFirestore<T extends CandidateCompanyTarget>(
  companies: T[],
  userId: string = requireUid()
): Promise<{
  uncontactedCompanies: T[];
  skippedAlreadySent: { company: T; reason: string; matchedRecord: any }[];
}> {
  if (!Array.isArray(companies) || companies.length === 0) {
    return { uncontactedCompanies: [], skippedAlreadySent: [] };
  }

  const sentRecords = await fetchFirestoreSentEmailsHistory(userId);
  const uncontactedCompanies: T[] = [];
  const skippedAlreadySent: { company: T; reason: string; matchedRecord: any }[] = [];

  for (const company of companies) {
    let matched = false;
    for (const record of sentRecords) {
      const matchRes = isCompanyMatchSentRecord(company, record);
      if (matchRes.isMatch) {
        matched = true;
        skippedAlreadySent.push({
          company,
          reason: matchRes.detail || `Già inviata (${matchRes.matchType})`,
          matchedRecord: record,
        });
        break;
      }
    }

    if (!matched) {
      uncontactedCompanies.push(company);
    }
  }

  return { uncontactedCompanies, skippedAlreadySent };
}
