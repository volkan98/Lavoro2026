import { scopedStorageKey } from '@/lib/api/client';
import { useMemo, useState } from 'react';
import { useCVContext } from '@/contexts/CVContext';
import { aiAgent, Company } from '@/lib/api/ai-agent';
import { Azienda } from '@/types/cv';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Progress } from '@/components/ui/progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import {
  Loader2,
  ExternalLink,
  Mail,
  Phone,
  Globe,
  Plus,
  Ban,
  Send,
  Trophy,
  ShieldCheck,
  ShieldQuestion,
  ShieldAlert,
} from 'lucide-react';
import {
  DEFAULT_WEIGHTS,

  ScoredAzienda,

  SWISS_CITIES,
  TICINO_CITIES,
  dedupeKeys,
  mergeCompany,
  scoreCompany,
  similarityLabel,
} from '@/lib/swissSimilarity';

const ANALYZED_KEY = 'swiss_similar_analyzed';
const RESULTS_KEY = 'swiss_similar_results';
const EXCLUDED_KEY = 'swiss_similar_excluded';

// Ricerca automatica e mirata: verniciatura industriale / trattamento superfici
const PAINTING_KEYWORD_SETS: string[][] = [
  ['verniciatura industriale', 'verniciatura a liquido', 'verniciatura a polvere'],
  ['verniciatura metalli', 'trattamento superfici', 'sabbiatura'],
  ['industrial coating', 'powder coating', 'wet painting'],
  ['industrielle Lackierung', 'Pulverbeschichtung', 'Oberflächenbehandlung'],
  ['peinture industrielle', 'traitement de surface', 'thermolaquage'],
];


function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  return r ? `${m}m ${r}s` : `${m}m`;
}

function loadSet(key: string): Set<string> {
  try {
    const raw = localStorage.getItem(scopedStorageKey(key));
    const parsed = raw ? JSON.parse(raw) : [];
    return new Set<string>(Array.isArray(parsed) ? parsed : []);
  } catch {
    return new Set();
  }
}

function saveSet(key: string, set: Set<string>) {
  try {
    localStorage.setItem(scopedStorageKey(key), JSON.stringify([...set]));
  } catch {
    /* ignore */
  }
}

function mapCompany(c: Company, fallbackCity: string, index: number): Azienda {
  const email =
    c.email && !['', 'null', 'n/a', 'undefined'].includes(c.email.trim().toLowerCase())
      ? c.email.trim()
      : null;
  return {
    id: `ch-${index}-${(c.name || '').slice(0, 20)}`,
    nome: c.name,
    indirizzo: c.address || '',
    citta: c.city || fallbackCity,
    sito: c.website || '',
    email,
    emailVerified: email ? c.email_verified || 'unverified' : null,
    emailSource: email ? c.email_source || null : null,
    telefono: c.phone || '',
    settore: c.sector || 'Altro',
    fonte: c.source || 'AI Search',
    distanza: c.distance_km || 0,
    tempoPercorrenza: c.travel_time || '',
    domainValid: c.domain_valid ?? null,
    emailExplicit: c.email_explicit ?? false,
    emailSourceType: c.email_source_type ?? null,
    smtpStatus: c.smtp_status ?? null,
    catchAll: c.catch_all ?? null,
    confidenceScore: c.confidence_score ?? 0,
    finalStatus: c.final_status || 'discarded',
    contactFormUrl: c.contact_form_url ?? null,
  };
}

export function SwissSimilarSearch() {
  const { cvData, aziendeSelezionate, setAziendeSelezionate, setCurrentStep } = useCVContext();
  const { toast } = useToast();

  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<'ticino' | 'svizzera'>('ticino');
  const [startCity, setStartCity] = useState('Lugano');
  const [radius, setRadius] = useState('50');
  const [maxCompanies, setMaxCompanies] = useState('40');
  const [findContacts, setFindContacts] = useState(true);
  const [autoAdd, setAutoAdd] = useState(false);
  const [onlyNew, setOnlyNew] = useState(false);
  const weights = DEFAULT_WEIGHTS;

  const [isSearching, setIsSearching] = useState(false);
  const [progress, setProgress] = useState('');
  const [done, setDone] = useState(0);
  const [total, setTotal] = useState(0);
  const [foundCount, setFoundCount] = useState(0);
  const [eta, setEta] = useState('');

  const [results, setResults] = useState<ScoredAzienda[]>(() => {
    try {
      const raw = localStorage.getItem(scopedStorageKey(RESULTS_KEY));
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  });
  const [excluded, setExcluded] = useState<Set<string>>(() => loadSet(EXCLUDED_KEY));

  const persistResults = (list: ScoredAzienda[]) => {
    setResults(list);
    try {
      localStorage.setItem(scopedStorageKey(RESULTS_KEY), JSON.stringify(list));
    } catch {
      /* ignore */
    }
  };

  const visible = useMemo(
    () =>
      (Array.isArray(results) ? results : []).filter(
        (r) => r?.nome && !excluded.has(r.nome.toLowerCase()),
      ),
    [results, excluded],
  );

  const stats = useMemo(() => {
    const withEmail = visible.filter((r) => !!r.email);
    return {
      trovate: visible.length,
      verificate: visible.filter((r) => r.sito || r.emailVerified?.startsWith('verified')).length,
      altaCompat: visible.filter((r) => typeof r.similarityScore === 'number' && r.similarityScore >= 75).length,
      email: withEmail.length,
      pronte: withEmail.filter((r) => r.finalStatus !== 'discarded').length,
      inCampagna: (aziendeSelezionate || []).length,
    };
  }, [visible, aziendeSelezionate]);

  const top10 = useMemo(
    () => [...visible].sort((a, b) => (b.finalScore || 0) - (a.finalScore || 0)).slice(0, 10),
    [visible],
  );

  const runSearch = async () => {
    setIsSearching(true);
    const analyzed = onlyNew ? loadSet(ANALYZED_KEY) : new Set<string>();
    const seen = new Map<string, Azienda>();
    const keyIndex = new Map<string, string>(); // dedupe key -> company id

    const cities = mode === 'ticino' ? [startCity, ...TICINO_CITIES] : [startCity, ...SWISS_CITIES];
    const uniqueCities = [...new Set(cities)];
    const target = parseInt(maxCompanies, 10);

    // Ricerca completa: tutte le combinazioni parola chiave × città (nessuna fretta)
    const searchCities = mode === 'ticino' ? uniqueCities : uniqueCities;
    const totalQueries = PAINTING_KEYWORD_SETS.length * searchCities.length;
    const startedAt = Date.now();
    setDone(0);
    setTotal(totalQueries);
    setFoundCount(0);
    setEta('');

    try {
      let queryIdx = 0;
      for (const keywordSet of PAINTING_KEYWORD_SETS) {
        for (const city of searchCities) {
          queryIdx += 1;
          setProgress(`${keywordSet[0]} — ${city}`);

          try {
            const res = await aiAgent.searchCompanies(
              `${city}, Svizzera`,
              parseInt(radius, 10),
              keywordSet,
              cvData?.competenze,
              'verniciatore industriale',
              Math.min(25, target),
              cvData?.citta || startCity,
              false,
            );

            if (res.success && res.data) {
              res.data.forEach((c, i) => {
                const azienda = mapCompany(c, city, seen.size + i);
                // Solo aziende con sito web verificato online dal backend
                if (!azienda.nome || !azienda.sito) return;
                // Mai email inventate: teniamo solo quelle estratte realmente dal sito
                if (azienda.email && !azienda.emailExplicit) {
                  azienda.email = null;
                  azienda.emailVerified = null;
                  azienda.emailSource = null;
                }

                const keys = dedupeKeys(azienda);
                const existingId = keys.map((k) => keyIndex.get(k)).find(Boolean);
                if (existingId) {
                  const prev = seen.get(existingId)!;
                  seen.set(existingId, mergeCompany(prev, azienda));
                  return;
                }
                if (onlyNew && keys.some((k) => analyzed.has(k))) return;
                keys.forEach((k) => keyIndex.set(k, azienda.id));
                seen.set(azienda.id, azienda);
              });
            }
          } catch (err) {
            console.error('Query fallita, continuo:', err);
          }

          setDone(queryIdx);
          setFoundCount(seen.size);
          const elapsed = Date.now() - startedAt;
          const avg = elapsed / queryIdx;
          const remaining = Math.max(0, totalQueries - queryIdx) * avg;
          setEta(formatDuration(remaining));
        }
      }


      // Escludi aziende già contattate (anti-spam / anti duplicati)
      const sent = await aiAgent.getSentEmails();
      const sentEmails = new Set((sent || []).map((s: any) => (s.email || '').toLowerCase()));
      const sentDomains = new Set((sent || []).map((s: any) => (s.domain || (s.email?.includes('@') ? s.email.split('@')[1] : '')).toLowerCase()).filter(Boolean));

      const scored = [...seen.values()]
        .filter((a) => {
          const email = (a.email || '').toLowerCase();
          const domain = email.split('@')[1] || '';
          return !(email && sentEmails.has(email)) && !(domain && sentDomains.has(domain));
        })
        .map((a) => scoreCompany(a, cvData?.competenze || [], weights))
        .filter((a) => a.similarityScore >= 40)
        .sort((a, b) => b.finalScore - a.finalScore);

      persistResults(scored);

      // Memorizza le aziende analizzate per la modalità "Scopri aziende nuove"
      const memo = loadSet(ANALYZED_KEY);
      [...seen.values()].forEach((a) => dedupeKeys(a).forEach((k) => memo.add(k)));
      saveSet(ANALYZED_KEY, memo);

      if (autoAdd) {
        const ready = scored.filter((a) => a.email && a.finalStatus !== 'discarded' && a.finalScore >= 60);
        const merged = Array.isArray(aziendeSelezionate) ? [...aziendeSelezionate] : [];
        ready.forEach((r) => {
          const rName = (r?.nome || '').trim().toLowerCase();
          if (rName && !merged.some((m) => (m?.nome || '').trim().toLowerCase() === rName)) {
            merged.push(r);
          }
        });
        setAziendeSelezionate(merged);
      }

      toast({
        title: '🇨🇭 Ricerca completata',
        description: `${scored.length} aziende compatibili trovate (${queryIdx} query multilingua).`,
      });
    } catch (e: any) {
      toast({
        title: 'Errore nella ricerca',
        description: e?.message || 'Riprova tra qualche istante.',
        variant: 'destructive',
      });
    } finally {
      setProgress('');
      setIsSearching(false);
    }
  };

  const addToCampaign = (a: ScoredAzienda) => {
    const aName = (a?.nome || '').trim().toLowerCase();
    if (!aName) return;
    const list = Array.isArray(aziendeSelezionate) ? aziendeSelezionate : [];
    if (list.some((s) => (s?.nome || '').trim().toLowerCase() === aName)) return;
    setAziendeSelezionate([...list, a]);
    toast({ title: 'Aggiunta alla campagna', description: a.nome });
  };

  const excludeCompany = (a: ScoredAzienda) => {
    const aName = (a?.nome || '').trim().toLowerCase();
    if (!aName) return;
    const next = new Set<string>(excluded);
    next.add(aName);
    setExcluded(next);
    saveSet(EXCLUDED_KEY, next);
  };

  const emailBadge = (a: ScoredAzienda) => {
    if (!a.email) return <Badge variant="outline" className="text-xs">🔴 Nessuna email — Contatto non trovato</Badge>;
    if (a.emailVerified === 'verified_official' || a.emailVerified === 'verified_directory')
      return <Badge className="text-xs bg-emerald-600 hover:bg-emerald-600">✅ Email verificata</Badge>;
    return <Badge variant="secondary" className="text-xs">🟡 Email non verificata</Badge>;
  };

  return (
    <Card className="border-primary/30">
      <CardContent className="p-4 md:p-6 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
          <div>
            <h3 className="text-lg font-semibold text-foreground">🇨🇭 Aziende simili in Svizzera</h3>
            <p className="text-sm text-muted-foreground">
              Trova aziende con profilo simile a Faiko Verniciature Industriali e Poretti &amp; Gaggini
            </p>
          </div>
          <div className="flex gap-2 flex-wrap">
            <Button onClick={() => { setMode('svizzera'); setOpen(true); }}>
              🇨🇭 Cerca aziende simili in Svizzera
            </Button>
            <Button variant="outline" onClick={() => { setMode('ticino'); setStartCity('Lugano'); setOpen(true); }}>
              📍 Ticino — Aziende simili
            </Button>
          </div>
        </div>

        {open && (
          <div className="space-y-4 border-t border-border pt-4">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              <div>
                <label className="text-sm font-medium mb-1 block">Modalità</label>
                <Select value={mode} onValueChange={(v) => setMode(v as 'ticino' | 'svizzera')}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ticino">Solo Ticino</SelectItem>
                    <SelectItem value="svizzera">Tutta la Svizzera</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-sm font-medium mb-1 block">Zona iniziale</label>
                <Select value={startCity} onValueChange={setStartCity}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(mode === 'ticino' ? TICINO_CITIES : SWISS_CITIES).map((c) => (
                      <SelectItem key={c} value={c}>{c}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-sm font-medium mb-1 block">Raggio</label>
                <Select value={radius} onValueChange={setRadius}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="25">25 km</SelectItem>
                    <SelectItem value="50">50 km</SelectItem>
                    <SelectItem value="100">100 km</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-sm font-medium mb-1 block">Max aziende</label>
                <Select value={maxCompanies} onValueChange={setMaxCompanies}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="20">20</SelectItem>
                    <SelectItem value="40">40</SelectItem>
                    <SelectItem value="60">60</SelectItem>
                    <SelectItem value="100">100</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="flex flex-wrap gap-4">
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <Checkbox checked={findContacts} onCheckedChange={(v) => setFindContacts(!!v)} />
                Ricerca automatica contatti
              </label>
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <Checkbox checked={autoAdd} onCheckedChange={(v) => setAutoAdd(!!v)} />
                Aggiungi automaticamente alla campagna
              </label>
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <Checkbox checked={onlyNew} onCheckedChange={(v) => setOnlyNew(!!v)} />
                🔎 Scopri aziende nuove
              </label>
            </div>

            <p className="text-xs text-muted-foreground">
              La ricerca è automatica e mirata alle aziende di <strong>verniciatura industriale</strong> e
              trattamento superfici. Vengono mostrate solo aziende con <strong>sito web online verificato</strong> e
              email estratta realmente dal sito (mai inventata).
            </p>


            {isSearching && total > 0 && (
              <div className="space-y-2 rounded-lg border border-border bg-muted/40 p-3">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span className="flex items-center gap-2">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Query {done}/{total} — {progress}
                  </span>
                  <span>{Math.round((done / total) * 100)}%</span>
                </div>
                <Progress value={(done / total) * 100} className="h-2" />
                <p className="text-xs text-muted-foreground">
                  {foundCount} aziende raccolte{eta ? ` • tempo stimato rimanente: ~${eta}` : ''}
                </p>
              </div>
            )}

            <div className="flex justify-end">
              <Button onClick={runSearch} disabled={isSearching}>
                {isSearching ? (
                  <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Ricerca approfondita in corso…</>
                ) : (
                  <>Avvia ricerca approfondita</>
                )}
              </Button>
            </div>

          </div>
        )}

        {visible.length > 0 && (
          <div className="space-y-4 border-t border-border pt-4">
            <div className="grid grid-cols-2 md:grid-cols-6 gap-2 text-center">
              {[
                ['Trovate', stats.trovate],
                ['Verificate', stats.verificate],
                ['Alta compat.', stats.altaCompat],
                ['Email trovate', stats.email],
                ['Pronte', stats.pronte],
                ['In campagna', stats.inCampagna],
              ].map(([label, value]) => (
                <div key={label as string} className="rounded-lg bg-muted p-2">
                  <div className="text-lg font-semibold text-foreground">{value as number}</div>
                  <div className="text-xs text-muted-foreground">{label as string}</div>
                </div>
              ))}
            </div>

            <div>
              <p className="text-sm font-medium flex items-center gap-2 mb-2">
                <Trophy className="h-4 w-4 text-amber-500" /> Top 10 aziende più compatibili
              </p>
              <div className="flex flex-wrap gap-2">
                {top10.map((a) => (
                  <Badge key={a.id} variant="outline" className="text-xs">
                    {a.nome} — {a.finalScore}/100
                  </Badge>
                ))}
              </div>
            </div>

            <div className="space-y-3">
              {visible.map((a) => (
                <div key={a.id} className="rounded-lg border border-border p-3 space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="font-semibold text-foreground">{a.nome}</p>
                      <p className="text-xs text-muted-foreground">
                        {a.citta} • {a.cantone} • {a.settore}
                        {a.distanza ? ` • ${a.distanza} km` : ''}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge className="text-xs">Similarity {a.similarityScore}/100</Badge>
                      <Badge variant="secondary" className="text-xs">CV {a.cvScore}/100</Badge>
                      <Badge variant="outline" className="text-xs">Finale {a.finalScore}/100</Badge>
                      {typeof a.priority === 'number' && a.priority > 0 && a.priority <= 5 && (
                        <span className="text-xs">{'⭐'.repeat(Math.max(1, Math.min(5, Math.floor(a.priority))))}</span>
                      )}
                    </div>
                  </div>

                  <p className="text-xs text-muted-foreground flex items-center gap-1.5 flex-wrap">
                    <span className={`px-1.5 py-0.5 rounded font-medium text-[11px] ${similarityLabel(a.similarityScore).color}`}>
                      {similarityLabel(a.similarityScore).label}
                    </span>
                    {a.similarityReason && <span>{a.similarityReason}</span>}
                  </p>

                  <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                    {a.sito && (
                      <span className="flex items-center gap-1"><Globe className="h-3 w-3" />{a.sito}</span>
                    )}
                    <span className="flex items-center gap-1">
                      <Mail className="h-3 w-3" />{a.email || 'Contatto non trovato'}
                    </span>
                    {a.telefono && (
                      <span className="flex items-center gap-1"><Phone className="h-3 w-3" />{a.telefono}</span>
                    )}
                    <span>Fonte: {a.fonte}</span>
                    {emailBadge(a)}
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {a.sito && (
                      <Button size="sm" variant="outline" asChild>
                        <a href={a.sito.startsWith('http') ? a.sito : `https://${a.sito}`} target="_blank" rel="noreferrer">
                          <ExternalLink className="h-3 w-3 mr-1" /> Apri sito
                        </a>
                      </Button>
                    )}
                    <Button size="sm" variant="outline" onClick={() => addToCampaign(a)} disabled={!a.email}>
                      <Plus className="h-3 w-3 mr-1" /> Aggiungi alla campagna
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!a.email}
                      onClick={() => { addToCampaign(a); setCurrentStep(3); }}
                    >
                      <Send className="h-3 w-3 mr-1" /> Invia candidatura
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => excludeCompany(a)}>
                      <Ban className="h-3 w-3 mr-1" /> Escludi
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
