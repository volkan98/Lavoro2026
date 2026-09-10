import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../src/lib/firebase', () => ({
  auth: {
    currentUser: { uid: 'test_user_dedup_999' },
  },
  db: {},
}));

import {
  isCompanyMatchSentRecord,
  extractEmailDomain,
  extractWebsiteDomain,
  isGenericEmailDomain,
  normalizeCompanyName,
  normalizeEmail,
  filterUncontactedCompaniesFirestore,
  GENERIC_EMAIL_DOMAINS,
} from '../src/lib/companyDeduplication';

describe('Auto Mode Company Search & Pre-Send Deduplication (Firestore Source of Truth)', () => {
  const userId = 'test_user_dedup_999';

  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  describe('Domain & Email Extraction and Normalization', () => {
    it('correctly extracts and normalizes email domain', () => {
      expect(extractEmailDomain('HR.CH@Mikron.COM ')).toBe('mikron.com');
      expect(extractEmailDomain('recruiting@sintetica.ch')).toBe('sintetica.ch');
      expect(extractEmailDomain('invalid-email')).toBe('');
      expect(extractEmailDomain('')).toBe('');
    });

    it('correctly extracts domain from website URLs', () => {
      expect(extractWebsiteDomain('https://www.mikron.com/careers')).toBe('mikron.com');
      expect(extractWebsiteDomain('http://schindler.com')).toBe('schindler.com');
      expect(extractWebsiteDomain('www.casale.ch/contact')).toBe('casale.ch');
    });

    it('identifies generic email domains to prevent false positives', () => {
      expect(isGenericEmailDomain('gmail.com')).toBe(true);
      expect(isGenericEmailDomain('hotmail.it')).toBe(true);
      expect(isGenericEmailDomain('yahoo.com')).toBe(true);
      expect(isGenericEmailDomain('bluewin.ch')).toBe(true);
      expect(isGenericEmailDomain('libero.it')).toBe(true);

      expect(isGenericEmailDomain('mikron.com')).toBe(false);
      expect(isGenericEmailDomain('sintetica.com')).toBe(false);
      expect(isGenericEmailDomain('schindler.com')).toBe(false);
    });

    it('normalizes company names removing legal entity abbreviations', () => {
      expect(normalizeCompanyName('Mikron SA Manno')).toBe('mikron manno');
      expect(normalizeCompanyName('Sintetica S.A. ')).toBe('sintetica');
      expect(normalizeCompanyName('Casale SAGL')).toBe('casale');
      expect(normalizeCompanyName('Schindler Elettronica S.r.l.')).toBe('schindler elettronica');
    });
  });

  describe('Deduplication Matching Criteria', () => {
    const sentHistoryRecord = {
      id: 'sent_001',
      company_id: 'comp_mikron_100',
      company_name: 'Mikron SA',
      email: 'hr.mma@mikron.com',
      domain: 'mikron.com',
      sent_at: '2026-03-01T10:00:00.000Z',
    };

    it('matches candidate by exact same recipient email', () => {
      const candidate = {
        name: 'Different Name SA',
        email: 'HR.MMA@MIKRON.COM', // same email with different casing
      };

      const match = isCompanyMatchSentRecord(candidate, sentHistoryRecord);
      expect(match.isMatch).toBe(true);
      expect(match.matchType).toBe('email');
    });

    it('matches candidate by same corporate email domain (e.g. contacting another department/address in same company)', () => {
      const candidate = {
        name: 'Mikron Jobs Desk',
        email: 'jobs.ticino@mikron.com', // different email prefix, same corporate domain
      };

      const match = isCompanyMatchSentRecord(candidate, sentHistoryRecord);
      expect(match.isMatch).toBe(true);
      expect(match.matchType).toBe('domain');
    });

    it('matches candidate by same companyId when available', () => {
      const candidate = {
        companyId: 'comp_mikron_100',
        name: 'New Division',
        email: 'other@otherdomain.com',
      };

      const match = isCompanyMatchSentRecord(candidate, sentHistoryRecord);
      expect(match.isMatch).toBe(true);
      expect(match.matchType).toBe('company_id');
    });

    it('matches candidate by normalized company name', () => {
      const candidate = {
        name: 'Mikron SA',
        email: 'contact@generic-domain.com',
      };

      const match = isCompanyMatchSentRecord(candidate, sentHistoryRecord);
      expect(match.isMatch).toBe(true);
      expect(match.matchType).toBe('company_name');
    });

    it('DOES NOT create false duplicate when two distinct businesses use generic webmail (@gmail.com)', () => {
      const gmailSentRecord = {
        id: 'sent_gmail_01',
        company_id: 'comp_plumber_01',
        company_name: 'Idraulico Rossi',
        email: 'idraulico.rossi@gmail.com',
        domain: 'gmail.com',
        sent_at: '2026-03-01T10:00:00.000Z',
      };

      const candidateNewCompany = {
        companyId: 'comp_electrician_02',
        name: 'Elettricista Bianchi',
        email: 'elettricista.bianchi@gmail.com', // also uses gmail, but completely different business
      };

      const match = isCompanyMatchSentRecord(candidateNewCompany, gmailSentRecord);
      expect(match.isMatch).toBe(false);
    });

    it('DOES create duplicate for generic email when exact email address is identical', () => {
      const gmailSentRecord = {
        id: 'sent_gmail_01',
        company_id: 'comp_plumber_01',
        company_name: 'Idraulico Rossi',
        email: 'idraulico.rossi@gmail.com',
        domain: 'gmail.com',
        sent_at: '2026-03-01T10:00:00.000Z',
      };

      const candidateSameAddress = {
        name: 'Rossi Pronto Intervento',
        email: 'IDRAULICO.ROSSI@GMAIL.COM',
      };

      const match = isCompanyMatchSentRecord(candidateSameAddress, gmailSentRecord);
      expect(match.isMatch).toBe(true);
      expect(match.matchType).toBe('email');
    });
  });

  describe('Search Phase & Pre-Send Auto-Correction in Queue', () => {
    it('filters out already-contacted companies from search results before queue creation', () => {
      const sentList = [
        {
          id: 'sent_1',
          company_id: 'comp_1',
          company_name: 'Sintetica SA',
          email: 'careers@sintetica.com',
          domain: 'sintetica.com',
        },
      ];

      const searchResults = [
        {
          id: 'comp_1',
          name: 'Sintetica SA',
          email: 'careers@sintetica.com',
          city: 'Mendrisio',
        },
        {
          id: 'comp_2',
          name: 'Schindler Elettronica SA',
          email: 'jobs.ch@schindler.com',
          city: 'Lugano',
        },
      ];

      // Simulate search phase filter
      const uncontacted: typeof searchResults = [];
      const skipped: typeof searchResults = [];

      for (const comp of searchResults) {
        const isSent = sentList.some((record) => isCompanyMatchSentRecord(comp, record).isMatch);
        if (isSent) {
          skipped.push(comp);
        } else {
          uncontacted.push(comp);
        }
      }

      expect(uncontacted.length).toBe(1);
      expect(uncontacted[0].name).toBe('Schindler Elettronica SA');
      expect(skipped.length).toBe(1);
      expect(skipped[0].name).toBe('Sintetica SA');
    });

    it('corrects pending queue items to sent when present in Firestore history', () => {
      const mockQueue = [
        {
          id: 'queue_item_1',
          company_name: 'Mikron SA',
          company_email: 'hr.mma@mikron.com',
          status: 'pending',
        },
        {
          id: 'queue_item_2',
          company_name: 'Hupac SA',
          company_email: 'jobs@hupac.com',
          status: 'pending',
        },
      ];

      const firestoreSentHistory = [
        {
          id: 'sent_mikron',
          company_name: 'Mikron SA',
          email: 'hr.mma@mikron.com',
          sent_at: '2026-03-02T14:30:00.000Z',
          message_id: 'gmail_msg_mikron_123',
        },
      ];

      // Reconcile queue with Firestore history
      const reconciledQueue = mockQueue.map((item) => {
        const matched = firestoreSentHistory.find(
          (rec) => isCompanyMatchSentRecord(item, rec).isMatch
        );
        if (matched) {
          return {
            ...item,
            status: 'sent',
            sent_at: matched.sent_at,
            gmail_message_id: matched.message_id,
          };
        }
        return item;
      });

      expect(reconciledQueue[0].status).toBe('sent');
      expect(reconciledQueue[0].gmail_message_id).toBe('gmail_msg_mikron_123');
      expect(reconciledQueue[1].status).toBe('pending');
    });
  });
});
