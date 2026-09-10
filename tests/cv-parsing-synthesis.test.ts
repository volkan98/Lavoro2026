import { describe, it, expect, vi } from 'vitest';
import {
  normalizeCvData,
  generateDerivedProfile,
  generateSummaryFromParsedCv,
  mergeAndDeduplicateSkills,
  mergeCvData,
  isPlaceholder,
  summarizeCv,
} from '../src/lib/cvNormalizer';
import { createCvParser } from '../server/cvParser';

describe('CV Parsing and Controlled Synthesis Suite', () => {
  // Test 1: CV con profilo esplicito
  it('1. CV con profilo esplicito — preserva fedelmente il profilo dichiarato', () => {
    const rawCv = {
      nome: 'Mario',
      cognome: 'Rossi',
      profilo: 'Professionista con 10 anni di esperienza nella logistica e gestione magazzino.',
      esperienze: [
        {
          ruolo: 'Responsabile Magazzino',
          azienda: 'Logistica SA',
          descrizione: 'Gestione ordini, coordinamento squadre, inventario.',
        },
      ],
      competenze: ['Gestione magazzino', 'WMS'],
    };

    const normalized = normalizeCvData(rawCv);
    expect(normalized.profilo).toBe(
      'Professionista con 10 anni di esperienza nella logistica e gestione magazzino.'
    );
  });

  // Test 2: CV senza profilo ma con esperienza dettagliata
  it('2. CV senza profilo — genera profilo derivato di 50-90 parole con ruolo, compiti e competenze tecniche', () => {
    const rawCv = {
      nome: 'Luca',
      cognome: 'Bianchi',
      profilo: '', // Profilo assente nel CV
      targetRole: 'Verniciatore Industriale',
      esperienze: [
        {
          id: '1',
          ruolo: 'Verniciatore industriale a liquido e polvere',
          azienda: 'Verniciature Ticino SA',
          dataInizio: '2019-03',
          dataFine: '2024-01',
          descrizione:
            'Preparazione superfici metalliche tramite sabbiatura e sgrassaggio chimico.\nVerniciatura a polvere elettrostatica e a liquido con pompa airless su carpenteria metallica.\nControllo visivo e verifica spessori di rivestimento con spessimetro digitale.',
        },
        {
          id: '2',
          ruolo: 'Operaio addetto al trattamento superfici',
          azienda: 'MetalColor Srl',
          dataInizio: '2016-01',
          dataFine: '2019-02',
          descrizione: 'Carteggiatura, stuccatura e mascheratura parti meccaniche.',
        },
      ],
      competenzeTecniche: [
        'Verniciatura a polvere',
        'Verniciatura a liquido airless',
        'Preparazione superfici',
        'Controllo spessori rivestimento',
      ],
      competenzeInformatiche: ['Windows', 'Gestione PDF'],
      patente: 'B',
      istruzione: [
        {
          titolo: 'Qualifica Professionale Meccanica',
          istituto: 'Centro Formazione Tecnica',
        },
      ],
    };

    const normalized = normalizeCvData(rawCv);
    expect(normalized.profilo).toBeTruthy();

    const words = normalized.profilo.split(/\s+/).filter(Boolean);
    // Deve essere tra circa 50 e 90 parole
    expect(words.length).toBeGreaterThanOrEqual(45);
    expect(words.length).toBeLessThanOrEqual(95);

    // Contiene ruolo principale ed esperienza
    expect(normalized.profilo).toContain('Verniciatore industriale a liquido e polvere');
    expect(normalized.profilo).toContain('Verniciature Ticino SA');

    // Contiene compiti tecnici estratti dalle mansioni
    expect(normalized.profilo.toLowerCase()).toContain('preparazione superfici metalliche');

    // Contiene competenze tecniche
    expect(normalized.profilo).toContain('Verniciatura a polvere');

    // Non contiene allucinazioni
    expect(normalized.profilo).not.toContain('motivato');
    expect(normalized.profilo).not.toContain('dinamico');
    expect(normalized.profilo).not.toContain('problem solving');
  });

  // Test 3: CV con competenze tecniche solo dentro le esperienze
  it('3. CV con competenze tecniche solo dentro le esperienze — estrae e valorizza le competenze operative', () => {
    const rawCv = {
      nome: 'Giuseppe',
      cognome: 'Verdi',
      profilo: '',
      competenze: [], // Sezione competenze vuota nel CV originale
      esperienze: [
        {
          ruolo: 'Saldatore e Montatore Meccanico',
          azienda: 'Officine Meccaniche SA',
          descrizione:
            'Saldatura a filo continuo MIG/MAG su acciaio al carbonio e saldatura TIG su inox.\nAssemblaggio componenti meccanici secondo disegno tecnico.\nControllo qualità visivo e dimensionali con calibro e micrometro.',
        },
      ],
    };

    const normalized = normalizeCvData(rawCv);

    // Competenze tecniche estratte dalle mansioni
    expect(normalized.competenze.length).toBeGreaterThan(0);
    const techMatches = normalized.competenze.filter(c =>
      /saldat|assembl|disegno|controllo|meccanic/i.test(c)
    );
    expect(techMatches.length).toBeGreaterThanOrEqual(2);
    expect(normalized.competenzeTecniche?.length).toBeGreaterThan(0);
  });

  // Test 4: CV PDF multipagina — inlineData e modalità PDF inline
  it('4. CV PDF multipagina — invia PDF inline a Gemini e gestisce estrazione', async () => {
    let capturedOptions: any = null;
    const mockGenerate = vi.fn().mockImplementation(async (options: any) => {
      capturedOptions = options;
      return {
        text: JSON.stringify({
          nome: 'Anna',
          cognome: 'Neri',
          profilo: 'Profilo estratto da PDF multipagina',
          competenzeTecniche: ['Contabilità analitica', 'Bilancio'],
          competenzeInformatiche: ['Excel Avanzato', 'SAP'],
          esperienze: [
            {
              ruolo: 'Contabile Senior',
              azienda: 'Swiss Finance AG',
              descrizione: 'Redazione bilancio e reportistica mensile',
            },
          ],
        }),
      };
    });

    const parser = createCvParser(mockGenerate);

    const req: any = {
      body: {
        fileName: 'Curriculum-Anna-Neri-Multipage.pdf',
        mimeType: 'application/pdf',
        base64Data: Buffer.from('%PDF-1.4 Mock multipage pdf content').toString('base64'),
      },
    };

    let statusCalled = 200;
    let jsonResult: any = null;
    const res: any = {
      status: (s: number) => {
        statusCalled = s;
        return res;
      },
      json: (data: any) => {
        jsonResult = data;
        return res;
      },
    };

    await parser(req, res, () => {});

    expect(statusCalled).toBe(200);
    expect(jsonResult.success).toBe(true);
    expect(jsonResult.data.nome).toBe('Anna');
    expect(jsonResult.data.cognome).toBe('Neri');

    // Verifica che a Gemini sia stato inviato inlineData con mimeType application/pdf
    expect(Array.isArray(capturedOptions.contents)).toBe(true);
    const partWithPdf = capturedOptions.contents[0].parts.find((p: any) => p.inlineData);
    expect(partWithPdf).toBeDefined();
    expect(partWithPdf.inlineData.mimeType).toBe('application/pdf');
    expect(partWithPdf.inlineData.data).toBeTruthy();
  });

  // Test 5: CV con competenze informatiche + tecniche — priorità alle tecniche
  it('5. Competenze informatiche + tecniche — le competenze tecniche hanno priorità assoluta', () => {
    const rawCv = {
      nome: 'Marco',
      cognome: 'Ferrari',
      profilo: 'Fresatore CNC',
      competenze: [
        'Windows 11',
        'Fresatura CNC a 5 assi',
        'Posta elettronica',
        'Pacchetto Office',
        'Programmazione ISO Fanuc',
        'Gestione PDF',
        'Lettura disegno meccanico',
      ],
    };

    const normalized = normalizeCvData(rawCv);

    // Competenze informatiche separate
    expect(normalized.competenzeInformatiche).toContain('Windows 11');
    expect(normalized.competenzeInformatiche).toContain('Posta elettronica');
    expect(normalized.competenzeInformatiche).toContain('Pacchetto Office');
    expect(normalized.competenzeInformatiche).toContain('Gestione PDF');

    // Competenze tecniche separate
    expect(normalized.competenzeTecniche).toContain('Fresatura CNC a 5 assi');
    expect(normalized.competenzeTecniche).toContain('Programmazione ISO Fanuc');
    expect(normalized.competenzeTecniche).toContain('Lettura disegno meccanico');

    // Nell'elenco generale `competenze`, le competenze tecniche compaiono prima di quelle IT
    const firstTechnical = normalized.competenze[0];
    expect(normalized.competenzeTecniche).toContain(firstTechnical);
    expect(normalized.competenzeInformatiche).not.toContain(firstTechnical);
  });

  // Test 6: Parsing parziale non deve cancellare dati precedenti
  it('6. Parsing parziale — mergeCvData non cancella dati o liste completi precedenti', () => {
    const existingFullProfile = normalizeCvData({
      nome: 'Roberto',
      cognome: 'Galli',
      email: 'roberto.galli@example.ch',
      telefono: '+41 79 123 45 67',
      profilo: 'Profilo dettagliato precedentemente salvato e validato.',
      esperienze: [
        {
          id: '1',
          ruolo: 'Elettricista di manutenzione',
          azienda: 'Impianti Ticino',
          descrizione: 'Manutenzione cabine di media tensione.',
        },
      ],
      competenze: ['Media tensione', 'Schemi elettrici'],
      istruzione: [
        {
          titolo: 'Attestato Federale di Capacità (AFC)',
          istituto: 'Scuola Professionale',
        },
      ],
      lingue: [{ lingua: 'Italiano', livello: 'Madrelingua' }],
    });

    const incomingPartialParse = {
      nome: 'Roberto',
      cognome: 'Galli',
      email: '',
      telefono: '',
      profilo: '', // Nessun profilo nel nuovo parse parziale
      esperienze: [], // Nessuna esperienza rilevata nel parse difettoso
      competenze: [],
    };

    const merged = mergeCvData(existingFullProfile, incomingPartialParse);

    // I dati precedenti devono essere intatti
    expect(merged.nome).toBe('Roberto');
    expect(merged.cognome).toBe('Galli');
    expect(merged.email).toBe('roberto.galli@example.ch');
    expect(merged.telefono).toBe('+41 79 123 45 67');
    expect(merged.profilo).toBe(
      'Profilo dettagliato precedentemente salvato e validato.'
    );
    expect(merged.esperienze.length).toBe(1);
    expect(merged.esperienze[0].ruolo).toBe('Elettricista di manutenzione');
    expect(merged.competenze).toContain('Media tensione');
    expect(merged.istruzione.length).toBe(1);
    expect(merged.lingue.length).toBe(1);
  });

  // Test 7: Nessun dato inventato
  it('7. Nessun dato inventato — campi non presenti rimangono vuoti', () => {
    const rawCv = {
      nome: 'Test',
      cognome: 'Candidate',
    };

    const normalized = normalizeCvData(rawCv);

    expect(normalized.email).toBe('');
    expect(normalized.telefono).toBe('');
    expect(normalized.patente).toBe('');
    expect(normalized.statoPermesso).toBe('');
    expect(normalized.permessoG).toBe('');
    expect(normalized.certificazioni).toEqual([]);
    expect(normalized.altreInformazioni).toEqual([]);
  });

  // Test 8: "Non presente nel CV" non deve entrare nel database
  it('8. Nessun placeholder salvato nel database — "Non presente nel CV" viene ripulito', () => {
    const rawWithPlaceholders = {
      nome: 'Non presente nel CV',
      cognome: 'Rossi',
      email: 'non presente',
      telefono: 'N/A',
      profilo: 'Non presente nel CV',
      patente: 'Dato non presente',
      competenze: ['Saldatura', 'Non specificato', 'Nessuna informazione'],
      esperienze: [
        {
          ruolo: 'Montatore',
          azienda: 'Azienda SA',
          descrizione: 'Montaggio componenti.\nNon presente nel CV',
        },
      ],
    };

    const normalized = normalizeCvData(rawWithPlaceholders);

    expect(normalized.nome).toBe('');
    expect(normalized.email).toBe('');
    expect(normalized.telefono).toBe('');
    expect(normalized.patente).toBe('');
    expect(normalized.competenze).toContain('Saldatura');
    expect(normalized.competenze).not.toContain('Non specificato');
    expect(normalized.competenze).not.toContain('Nessuna informazione');
    expect(normalized.competenze).not.toContain('Non presente nel CV');
    expect(isPlaceholder('Non presente nel CV')).toBe(true);
    expect(isPlaceholder('N/A')).toBe(true);
    expect(isPlaceholder('Dato non presente')).toBe(true);
    expect(isPlaceholder('Saldatura')).toBe(false);
  });
});
