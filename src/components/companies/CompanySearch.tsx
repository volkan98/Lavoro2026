import { scopedStorageKey } from '@/lib/api/client';
import { useState, useEffect } from 'react';
import { useCVContext } from '@/contexts/CVContext';
import { aiAgent, Company } from '@/lib/api/ai-agent';
import { Azienda } from '@/types/cv';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { CityAutocomplete, LocationSelection } from '@/components/ui/city-autocomplete';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { 
  Search, 
  MapPin, 
  Building2, 
  Globe, 
  Mail, 
  Phone,
  ExternalLink,
  Download,
  ArrowLeft,
  ArrowRight,
  Filter,
  CheckCircle2,
  XCircle,
  Loader2,
  Sparkles,
  AlertTriangle,
  Star,
  StarOff,
  ShieldCheck,
  ShieldQuestion,
  ShieldAlert,
  ShieldBan,
  Link2
} from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { SwissSimilarSearch } from './SwissSimilarSearch';
import { useBlacklist } from '@/lib/blacklist';

interface SavedSearchPreferences {
  searchLocation: string;
  locationSelection: LocationSelection | null;
  searchRadius: string;
  minResults: string;
  selectedKeywords: string[];
  showOnlyWithEmail: boolean;
  onlySelectedCity: boolean;
}

const STORAGE_KEY = 'search_preferences';

const SETTORI = [
  'Tutti i settori',
  'Metalmeccanico',
  'Produzione',
  'Packaging',
  'Farmaceutico',
  'Logistica',
  'Verniciatura',
  'Alimentare',
  'Chimico',
  'Tessile',
  'Agenzie per il lavoro',
];

const KEYWORDS = [
  { id: 'produzione', label: 'Produzione' },
  { id: 'metalmeccanica', label: 'Metalmeccanica' },
  { id: 'packaging', label: 'Packaging' },
  { id: 'farmaceutico', label: 'Farmaceutico' },
  { id: 'logistica', label: 'Logistica' },
  { id: 'verniciatura', label: 'Verniciatura' },
  { id: 'alimentare', label: 'Alimentare' },
  { id: 'agenzie', label: 'Agenzie' },
];

export function CompanySearch() {
  const { cvData, aziendeSelezionate, setAziendeSelezionate, setCurrentStep } = useCVContext();
  const { toast } = useToast();
  const { isBlacklisted, addToBlacklist, removeFromBlacklist, blacklist } = useBlacklist();
  const [hideBlacklisted, setHideBlacklisted] = useState(false);
  const [searchLocation, setSearchLocation] = useState(cvData?.citta || '');
  const [locationSelection, setLocationSelection] = useState<LocationSelection | null>(null);
  const [searchRadius, setSearchRadius] = useState('30');
  const [minResults, setMinResults] = useState('30');
  const [selectedSector, setSelectedSector] = useState('Tutti i settori');
  const [selectedKeywords, setSelectedKeywords] = useState<string[]>([]);
  const [showOnlyWithEmail, setShowOnlyWithEmail] = useState(false);
  const [onlySelectedCity, setOnlySelectedCity] = useState(false);
  const [aziende, setAziendeRaw] = useState<Azienda[]>(() => {
    try {
      const saved = sessionStorage.getItem('search_results');
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });
  const setAziende = (data: Azienda[]) => {
    setAziendeRaw(data);
    try { sessionStorage.setItem('search_results', JSON.stringify(data)); } catch {}
  };
  const [isSearching, setIsSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(() => {
    return !!sessionStorage.getItem('search_results');
  });
  const [originCity, setOriginCity] = useState(cvData?.citta || '');
  const [searchStats, setSearchStats] = useState<{
    totalPasses: number;
    totalAiCalls: number;
    companiesPerPass: { pass: string; found: number; new: number }[];
    stoppedReason: string;
  } | null>(null);
  const [hasSavedPreferences, setHasSavedPreferences] = useState(false);
  const [sentEmails, setSentEmails] = useState<Set<string>>(new Set());
  const [sentDomains, setSentDomains] = useState<Set<string>>(new Set());
  const [sentCompanyNames, setSentCompanyNames] = useState<Set<string>>(new Set());

  // Carica le email già inviate all'avvio
  useEffect(() => {
    const loadSentEmails = async () => {
      try {
        const emails = await aiAgent.getSentEmails();
        const emailSet = new Set<string>();
        const domainSet = new Set<string>();
        const nameSet = new Set<string>();
        
        (Array.isArray(emails) ? emails : []).forEach((e: any) => {
          if (e?.email) {
            emailSet.add(e.email.toLowerCase());
            const domain = e.email.split('@')[1]?.toLowerCase();
            if (domain) domainSet.add(domain);
          }
          if (e?.company_name) {
            // Normalizza il nome: rimuovi suffissi legali e spazi
            const normalized = e.company_name.toLowerCase().trim()
              .replace(/\s*(sa|sagl|srl|spa|snc|sas|ag|gmbh|ltd|s\.a\.|s\.r\.l\.)\s*$/i, '')
              .trim();
            if (normalized) nameSet.add(normalized);
          }
        });
        
        setSentEmails(emailSet);
        setSentDomains(domainSet);
        setSentCompanyNames(nameSet);
      } catch (error) {
        console.error('Error loading sent emails:', error);
      }
    };
    loadSentEmails();
  }, []);

  // Controlla se ci sono preferenze salvate
  useEffect(() => {
    const saved = localStorage.getItem(scopedStorageKey(STORAGE_KEY));
    setHasSavedPreferences(!!saved);
  }, []);

  const savePreferences = () => {
    const prefs: SavedSearchPreferences = {
      searchLocation,
      locationSelection,
      searchRadius,
      minResults,
      selectedKeywords,
      showOnlyWithEmail,
      onlySelectedCity,
    };
    localStorage.setItem(scopedStorageKey(STORAGE_KEY), JSON.stringify(prefs));
    setHasSavedPreferences(true);
    toast({
      title: '⭐ Preferenze salvate',
      description: 'I tuoi parametri di ricerca sono stati salvati.',
    });
  };

  const loadPreferences = () => {
    const saved = localStorage.getItem(scopedStorageKey(STORAGE_KEY));
    if (saved) {
      try {
        const prefs: SavedSearchPreferences = JSON.parse(saved);
        setSearchLocation(prefs.searchLocation || '');
        setLocationSelection(prefs.locationSelection || null);
        setSearchRadius(prefs.searchRadius || '30');
        setMinResults(prefs.minResults || '30');
        setSelectedKeywords(prefs.selectedKeywords || []);
        setShowOnlyWithEmail(prefs.showOnlyWithEmail || false);
        setOnlySelectedCity(prefs.onlySelectedCity || false);
        toast({
          title: '✅ Preferenze caricate',
          description: 'I parametri della tua ultima ricerca sono stati ripristinati.',
        });
      } catch (e) {
        console.error('Error loading preferences:', e);
      }
    }
  };

  const clearPreferences = () => {
    localStorage.removeItem(scopedStorageKey(STORAGE_KEY));
    setHasSavedPreferences(false);
    toast({
      title: 'Preferenze rimosse',
      description: 'I parametri salvati sono stati cancellati.',
    });
  };

  const toggleKeyword = (keyword: string) => {
    if (selectedKeywords.includes(keyword)) {
      setSelectedKeywords(selectedKeywords.filter(k => k !== keyword));
    } else {
      setSelectedKeywords([...selectedKeywords, keyword]);
    }
  };

  const handleSearch = async () => {
    if (!searchLocation) {
      toast({
        title: 'Errore',
        description: 'Inserisci una località per la ricerca.',
        variant: 'destructive',
      });
      return;
    }

    const keywords = selectedKeywords.length > 0 
      ? selectedKeywords 
      : selectedSector !== 'Tutti i settori' 
        ? [selectedSector.toLowerCase()] 
        : ['produzione', 'industria'];

    // Usa la query della selezione se disponibile (include regione completa)
    const locationQuery = locationSelection?.searchQuery || searchLocation;

    setIsSearching(true);
    
    try {
      // Usa la città del CV come punto di origine per il calcolo distanza
      const userCity = cvData?.citta || '';
      
      const result = await aiAgent.searchCompanies(
        locationQuery,
        parseInt(searchRadius),
        keywords,
        cvData?.competenze,
        undefined,
        parseInt(minResults),
        userCity,
        onlySelectedCity // Passa il filtro "solo città selezionata" al backend
      );

      if (!result.success || !result.data) {
        throw new Error(result.error || 'Errore nella ricerca');
      }

      // Salva la città di origine per la visualizzazione
      if (result.originCity) {
        setOriginCity(result.originCity);
      }

      // Salva le statistiche di ricerca
      if (result.searchStats) {
        setSearchStats(result.searchStats);
      }

      const mappedAziende: Azienda[] = result.data.map((company: Company, index: number) => {
        const normalizedEmail = company.email && 
          company.email.trim() !== '' && 
          company.email.toLowerCase() !== 'null' &&
          company.email.toLowerCase() !== 'n/a' &&
          company.email.toLowerCase() !== 'undefined'
          ? company.email.trim() 
          : null;

        const normalizedEmailSource = company.email_source && 
          company.email_source.trim() !== '' && 
          company.email_source.toLowerCase() !== 'null' &&
          company.email_source.toLowerCase() !== 'n/a'
          ? company.email_source.trim() 
          : null;
        
        return {
          id: String(index + 1),
          nome: company.name,
          indirizzo: company.address || '',
          citta: company.city || searchLocation,
          sito: company.website || '',
          email: normalizedEmail,
          emailVerified: normalizedEmail ? (company.email_verified || 'unverified') : null,
          emailSource: normalizedEmail ? normalizedEmailSource : null,
          telefono: company.phone || '',
          settore: company.sector || 'Altro',
          fonte: company.source || 'AI Search',
          distanza: company.distance_km || 0,
          tempoPercorrenza: company.travel_time || '',
          domainValid: company.domain_valid ?? null,
          emailExplicit: company.email_explicit ?? false,
          emailSourceType: company.email_source_type ?? null,
          smtpStatus: company.smtp_status ?? null,
          catchAll: company.catch_all ?? null,
          confidenceScore: company.confidence_score ?? 0,
          finalStatus: company.final_status || 'discarded',
          contactFormUrl: company.contact_form_url ?? null,
        };
      });

      // Escludi aziende già contattate (email o dominio già presenti in sent_emails / Firestore)
      let filtered = mappedAziende;
      let excludedCount = 0;
      const sent = await aiAgent.getSentEmails();

      if (sent && sent.length > 0) {
        const sentEmails = new Set(sent.map((s: any) => (s.email || '').toLowerCase()));
        const sentDomains = new Set(sent.map((s: any) => (s.domain || (s.email?.includes('@') ? s.email.split('@')[1] : '')).toLowerCase()).filter(Boolean));
        const sentNames = new Set(sent.map((s: any) => (s.company_name || '').trim().toLowerCase()).filter(Boolean));

        filtered = mappedAziende.filter(a => {
          const email = (a.email || '').toLowerCase();
          const domain = email.split('@')[1] || '';
          const name = (a.nome || '').trim().toLowerCase();
          return !(
            (email && sentEmails.has(email)) ||
            (domain && sentDomains.has(domain)) ||
            (name && sentNames.has(name))
          );
        });
        excludedCount = mappedAziende.length - filtered.length;
      }

      // Le aziende sono già ordinate per distanza dal backend
      setAziende(filtered);
      setHasSearched(true);
      
      const statsInfo = result.searchStats 
        ? ` (${result.searchStats.totalPasses} passaggi, ${result.searchStats.totalAiCalls} query AI)` 
        : '';
      
      toast({
        title: 'Ricerca completata!',
        description: `Trovate ${filtered.length} aziende${excludedCount > 0 ? ` (${excludedCount} già contattate escluse)` : ''}${statsInfo}.`,
      });
    } catch (error: any) {
      console.error('Search error:', error);
      toast({
        title: 'Errore nella ricerca',
        description: error.message || 'Impossibile completare la ricerca. Riprova.',
        variant: 'destructive',
      });
    } finally {
      setIsSearching(false);
    }
  };

  // Filtra per settore, email, città e escludi aziende già contattate
  const filteredAziende = aziende.filter(az => {
    if (selectedSector !== 'Tutti i settori' && az.settore !== selectedSector) return false;
    // Controlla sia null che stringa vuota
    if (showOnlyWithEmail && (!az.email || az.email.trim() === '')) return false;
    // Filtra per città selezionata
    if (onlySelectedCity && searchLocation) {
      const normalizedSearchCity = searchLocation.toLowerCase().trim();
      const normalizedAzCity = (az.citta || '').toLowerCase().trim();
      if (!normalizedAzCity.includes(normalizedSearchCity) && !normalizedSearchCity.includes(normalizedAzCity)) {
        return false;
      }
    }
    // Escludi aziende già contattate (per email, dominio O nome azienda)
    if (az.email) {
      const emailLower = az.email.toLowerCase();
      const domain = emailLower.split('@')[1];
      if (sentEmails.has(emailLower) || (domain && sentDomains.has(domain))) {
        return false;
      }
    }
    // Controlla anche per nome azienda (fuzzy match senza suffissi legali)
    const normalizedName = (az.nome || '').toLowerCase().trim()
      .replace(/\s*(sa|sagl|srl|spa|snc|sas|ag|gmbh|ltd|s\.a\.|s\.r\.l\.)\s*$/i, '')
      .trim();
    if (normalizedName && sentCompanyNames.has(normalizedName)) {
      return false;
    }
    // Filtro Blacklist: se attivo "hideBlacklisted", escludi contatti in blacklist
    if (hideBlacklisted && az.email && isBlacklisted(az.email).isBlacklisted) {
      return false;
    }
    return true;
  });

  // Calcola quante aziende nei risultati sono in blacklist
  const blacklistedResultsCount = aziende.filter(a => a.email && isBlacklisted(a.email).isBlacklisted).length;

  const toggleAzienda = (azienda: Azienda) => {
    const isSelected = aziendeSelezionate.some(a => a.id === azienda.id);
    if (isSelected) {
      setAziendeSelezionate(aziendeSelezionate.filter(a => a.id !== azienda.id));
    } else {
      setAziendeSelezionate([...aziendeSelezionate, azienda]);
    }
  };

  const selectAll = () => {
    const readyCompanies = filteredAziende.filter(
      a => a.email && a.finalStatus !== 'discarded' && !isBlacklisted(a.email).isBlacklisted
    );
    setAziendeSelezionate(readyCompanies);
  };

  const exportCSV = () => {
    const headers = ['Nome', 'Indirizzo', 'Città', 'Email', 'Telefono', 'Settore', 'Sito', 'Fonte'];
    const rows = filteredAziende.map(a => [
      a.nome, a.indirizzo, a.citta, a.email || '', a.telefono, a.settore, a.sito, a.fonte
    ]);
    
    const csv = [headers, ...rows].map(row => row.map(cell => `"${cell}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `aziende_${searchLocation}_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="text-center space-y-2">
        <h2 className="text-2xl md:text-3xl font-bold text-foreground flex items-center justify-center gap-2">
          <Sparkles className="h-6 w-6 text-primary" />
          AI Agent - Trova Aziende
        </h2>
        <p className="text-muted-foreground">
          L'AI cerca aziende nella tua zona e trova contatti email pubblici
        </p>
      </div>

      {/* Ricerca per similarità aziendale in Svizzera / Ticino */}
      <SwissSimilarSearch />

      {/* Search Form */}
      <Card>
        <CardContent className="p-4 md:p-6 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="md:col-span-2">
              <label className="text-sm font-medium text-foreground flex items-center gap-2 mb-2">
                <MapPin className="h-4 w-4" /> Zona / Città
              </label>
              <CityAutocomplete
                placeholder="es. Lugano, Ticino, Lombardia..."
                value={searchLocation}
                onChange={setSearchLocation}
                onLocationSelect={setLocationSelection}
              />
            </div>
            
            <div>
              <label className="text-sm font-medium text-foreground mb-2 block">
                Raggio di ricerca
              </label>
              <Select value={searchRadius} onValueChange={setSearchRadius}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="5">5 km</SelectItem>
                  <SelectItem value="10">10 km</SelectItem>
                  <SelectItem value="20">20 km</SelectItem>
                  <SelectItem value="30">30 km</SelectItem>
                  <SelectItem value="50">50 km</SelectItem>
                  <SelectItem value="100">100 km</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium text-foreground mb-2 block">
                🎯 Numero minimo di aziende da cercare
              </label>
              <Select value={minResults} onValueChange={setMinResults}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="20">20 aziende (veloce)</SelectItem>
                  <SelectItem value="30">30 aziende (standard)</SelectItem>
                  <SelectItem value="50">50 aziende (approfondita)</SelectItem>
                  <SelectItem value="75">75 aziende (molto approfondita)</SelectItem>
                  <SelectItem value="100">100 aziende (massima)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Keywords */}
          <div>
            <label className="text-sm font-medium text-foreground mb-2 block">
              Settori di interesse
            </label>
            <div className="flex flex-wrap gap-2">
              {KEYWORDS.map(kw => (
                <Badge 
                  key={kw.id}
                  variant={selectedKeywords.includes(kw.id) ? "default" : "outline"}
                  className="cursor-pointer hover:bg-primary/80"
                  onClick={() => toggleKeyword(kw.id)}
                >
                  {kw.label}
                </Badge>
              ))}
            </div>
          </div>

          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="flex flex-col sm:flex-row gap-4">
              <div className="flex items-center gap-2">
                <Checkbox 
                  id="emailOnly"
                  checked={showOnlyWithEmail}
                  onCheckedChange={(checked) => setShowOnlyWithEmail(checked as boolean)}
                />
                <label htmlFor="emailOnly" className="text-sm text-muted-foreground cursor-pointer">
                  Mostra solo aziende con email
                </label>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox 
                  id="cityOnly"
                  checked={onlySelectedCity}
                  onCheckedChange={(checked) => setOnlySelectedCity(checked as boolean)}
                />
                <label htmlFor="cityOnly" className="text-sm text-muted-foreground cursor-pointer">
                  Solo città selezionata
                </label>
              </div>
            </div>
            
            <div className="flex gap-2 flex-wrap">
              {hasSavedPreferences && (
                <Button variant="outline" size="sm" onClick={loadPreferences}>
                  <Star className="h-4 w-4 mr-2 text-amber-500 fill-amber-500" />
                  Carica preferiti
                </Button>
              )}
              <Button variant="outline" size="sm" onClick={savePreferences}>
                <Star className="h-4 w-4 mr-2" />
                Salva preferiti
              </Button>
              {hasSavedPreferences && (
                <Button variant="ghost" size="sm" onClick={clearPreferences}>
                  <StarOff className="h-4 w-4" />
                </Button>
              )}
            </div>
          </div>
          
          <div className="flex justify-end pt-2">
            <Button onClick={handleSearch} disabled={isSearching || !searchLocation}>
              {isSearching ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  AI sta cercando...
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4 mr-2" />
                  Cerca con AI
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Results */}
      {hasSearched && (
        <>
          {/* Search Stats */}
          {searchStats && (
            <Card className="border-primary/20 bg-primary/5">
              <CardContent className="p-4">
                <div className="flex items-start gap-3">
                  <Sparkles className="h-5 w-5 text-primary mt-0.5 shrink-0" />
                  <div className="space-y-2 flex-1">
                    <p className="text-sm font-medium text-foreground">
                      Ricerca multi-pass completata: {searchStats.totalPasses} passaggi, {searchStats.totalAiCalls} query AI
                    </p>
                    {Array.isArray(searchStats.companiesPerPass) && searchStats.companiesPerPass.map((pass: any, i: number) => (
                      <Badge key={i} variant="outline" className="text-xs">
                        {pass.pass}: +{pass.new} nuove
                      </Badge>
                    ))}
                    <p className="text-xs text-muted-foreground">{searchStats.stoppedReason}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          <Alert className="bg-amber-500/10 border-amber-500/30">
            <AlertTriangle className="h-4 w-4 text-amber-600" />
            <AlertDescription className="text-sm">
              <strong>Fonti gratuite:</strong> I risultati sono basati su directory pubbliche (local.ch, Pagine Gialle, siti aziendali). 
              L'AI suggerisce aziende realistiche - verifica sempre le email sui siti ufficiali prima di inviare.
            </AlertDescription>
          </Alert>

          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="flex items-center gap-2 flex-wrap">
              <Filter className="h-5 w-5 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">
                {filteredAziende.length} aziende visibili
                {filteredAziende.length < aziende.length && (
                  <span className="text-xs ml-1">(su {aziende.length} totali — {aziende.length - filteredAziende.length} nascoste da filtri/duplicati)</span>
                )}
                {' '}• {aziendeSelezionate.length} selezionate
              </span>
              {blacklistedResultsCount > 0 && (
                <Button
                  variant={hideBlacklisted ? 'secondary' : 'outline'}
                  size="sm"
                  onClick={() => setHideBlacklisted(!hideBlacklisted)}
                  className="text-xs h-7 px-2 flex items-center gap-1 border-destructive/40 text-destructive hover:bg-destructive/10"
                  title="Filtra le aziende presenti nella Blacklist"
                >
                  <ShieldBan className="h-3.5 w-3.5" />
                  {hideBlacklisted ? `Mostra escluse (${blacklistedResultsCount})` : `Nascondi blacklist (${blacklistedResultsCount})`}
                </Button>
              )}
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={selectAll}>
                Seleziona tutte pronte
              </Button>
              <Button variant="outline" size="sm" onClick={exportCSV}>
                <Download className="h-4 w-4 mr-2" />
                Esporta CSV
              </Button>
            </div>
          </div>

          <div className="space-y-3">
            {filteredAziende.map(azienda => {
              const isSelected = aziendeSelezionate.some(a => a.id === azienda.id);
              const blacklistStatus = isBlacklisted(azienda.email);
              const isBlocked = blacklistStatus.isBlacklisted;
              const canSelect = !!azienda.email && azienda.finalStatus !== 'discarded' && !isBlocked;
              
              return (
                <Card 
                  key={azienda.id} 
                  className={`transition-all ${
                    isBlocked 
                      ? 'border-destructive/40 bg-destructive/5' 
                      : isSelected 
                      ? 'ring-2 ring-primary bg-primary/5 cursor-pointer' 
                      : 'hover:bg-accent/50 cursor-pointer'
                  }`}
                  onClick={() => canSelect && toggleAzienda(azienda)}
                >
                  <CardContent className="p-4">
                    <div className="flex items-start gap-4">
                      <div className="pt-1">
                        <Checkbox 
                          checked={isSelected}
                          disabled={!canSelect}
                          onCheckedChange={() => canSelect && toggleAzienda(azienda)}
                          title={isBlocked ? 'Azienda presente in Blacklist: non selezionabile' : undefined}
                        />
                      </div>
                      
                      <div className="flex-1 min-w-0">
                        <div className="flex flex-col sm:flex-row sm:items-center gap-2 mb-2">
                          <h3 className="font-semibold text-foreground flex items-center gap-2">
                            <Building2 className="h-4 w-4 text-primary shrink-0" />
                            {azienda.nome}
                          </h3>
                          <div className="flex gap-2 flex-wrap">
                            <Badge variant="secondary">{azienda.settore}</Badge>
                            <Badge variant="outline" className="text-xs">
                              📍 {azienda.distanza} km – ⏱️ {azienda.tempoPercorrenza || 'n/d'} da {originCity}
                            </Badge>
                            {isBlocked ? (
                              <Badge variant="destructive" className="text-xs flex items-center gap-1 font-semibold">
                                <ShieldBan className="h-3 w-3" /> In Blacklist (Escluso)
                              </Badge>
                            ) : (
                              <Badge variant={azienda.finalStatus === 'ready_to_send' ? 'default' : 'outline'} className="text-xs">
                                {azienda.finalStatus === 'ready_to_send' ? 'Pronta per invio' : azienda.finalStatus === 'risky_send' ? 'Invio rischioso' : 'Scartata'}
                              </Badge>
                            )}
                            <Badge variant="outline" className="text-xs">
                              Score: {azienda.confidenceScore || 0}
                            </Badge>
                          </div>
                        </div>
                        
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 text-sm">
                          <div className="flex items-center gap-2 text-muted-foreground">
                            <MapPin className="h-4 w-4 shrink-0" />
                            <span className="truncate">{azienda.indirizzo ? `${azienda.indirizzo}, ` : ''}{azienda.citta}</span>
                          </div>
                          
                          <div className="flex items-center gap-2 flex-wrap">
                            {azienda.email ? (
                              <div className="flex flex-col gap-1 min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                  {azienda.emailVerified === 'verified_official' ? (
                                    <ShieldCheck className="h-4 w-4 text-primary shrink-0" />
                                  ) : azienda.emailVerified === 'verified_directory' ? (
                                    <ShieldCheck className="h-4 w-4 text-primary shrink-0" />
                                  ) : azienda.emailVerified === 'directory_only' ? (
                                    <ShieldQuestion className="h-4 w-4 text-muted-foreground shrink-0" />
                                  ) : (
                                    <ShieldAlert className="h-4 w-4 text-muted-foreground shrink-0" />
                                  )}
                                  <span className={`text-foreground truncate ${isBlocked ? 'line-through text-muted-foreground' : ''}`}>
                                    {azienda.email}
                                  </span>

                                  {/* Blacklist Quick Buttons */}
                                  {isBlocked ? (
                                    <div className="flex items-center gap-1.5 flex-wrap">
                                      <span className="text-[11px] text-destructive font-medium">
                                        ⛔ {blacklistStatus.reason}
                                      </span>
                                      <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          removeFromBlacklist(azienda.email!);
                                          toast({
                                            title: 'Azienda sbloccata',
                                            description: `${azienda.nome} rimossa dalla Blacklist.`,
                                          });
                                        }}
                                        className="h-6 px-2 text-[11px] text-destructive border-destructive/30 hover:bg-destructive/10"
                                      >
                                        Sblocca
                                      </Button>
                                    </div>
                                  ) : (
                                    <div className="flex items-center gap-1">
                                      <Button
                                        type="button"
                                        variant="ghost"
                                        size="sm"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          addToBlacklist(azienda.email!, `Azienda: ${azienda.nome}`);
                                          if (isSelected) toggleAzienda(azienda);
                                          toast({
                                            title: 'Aggiunta alla Blacklist',
                                            description: `${azienda.nome} (${azienda.email}) è stata bloccata.`,
                                          });
                                        }}
                                        className="h-6 px-2 text-[11px] text-muted-foreground hover:text-destructive hover:bg-destructive/10 shrink-0"
                                        title="Aggiungi email alla Blacklist"
                                      >
                                        <ShieldBan className="h-3 w-3 mr-1 text-destructive" />
                                        Blacklist
                                      </Button>
                                      {azienda.email.includes('@') && (
                                        <Button
                                          type="button"
                                          variant="ghost"
                                          size="sm"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            const domain = azienda.email!.split('@')[1];
                                            addToBlacklist('@' + domain, `Dominio ${azienda.nome}`);
                                            if (isSelected) toggleAzienda(azienda);
                                            toast({
                                              title: 'Dominio bloccato in Blacklist',
                                              description: `Tutte le email del dominio @${domain} sono state bloccate.`,
                                            });
                                          }}
                                          className="h-6 px-1.5 text-[10px] text-muted-foreground hover:text-destructive hover:bg-destructive/10 shrink-0 hidden sm:inline-flex"
                                          title={`Blocca tutte le email di @${azienda.email.split('@')[1]}`}
                                        >
                                          Blocca @dominio
                                        </Button>
                                      )}
                                    </div>
                                  )}
                                </div>
                                {azienda.emailSource && (
                                  <a 
                                    href={azienda.emailSource.startsWith('http') ? azienda.emailSource : `https://${azienda.emailSource}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-xs text-muted-foreground hover:text-primary flex items-center gap-1"
                                    onClick={e => e.stopPropagation()}
                                  >
                                    <Link2 className="h-3 w-3" />
                                    <span className="truncate max-w-[220px]">Fonte: {azienda.emailSource}</span>
                                  </a>
                                )}
                                {azienda.contactFormUrl && (
                                  <a 
                                    href={azienda.contactFormUrl.startsWith('http') ? azienda.contactFormUrl : `https://${azienda.contactFormUrl}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-xs text-muted-foreground hover:text-primary flex items-center gap-1"
                                    onClick={e => e.stopPropagation()}
                                  >
                                    <ExternalLink className="h-3 w-3" />
                                    <span className="truncate max-w-[220px]">Form contatto disponibile</span>
                                  </a>
                                )}
                              </div>
                            ) : (
                              <div className="flex flex-col gap-1">
                                <div className="flex items-center gap-2">
                                  <XCircle className="h-4 w-4 text-muted-foreground shrink-0" />
                                  <span className="text-muted-foreground italic">Nessuna email disponibile</span>
                                </div>
                                {azienda.contactFormUrl && (
                                  <a 
                                    href={azienda.contactFormUrl.startsWith('http') ? azienda.contactFormUrl : `https://${azienda.contactFormUrl}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-xs text-muted-foreground hover:text-primary flex items-center gap-1"
                                    onClick={e => e.stopPropagation()}
                                  >
                                    <ExternalLink className="h-3 w-3" />
                                    <span>Usa form contatto</span>
                                  </a>
                                )}
                              </div>
                            )}
                          </div>
                          
                          {azienda.telefono && (
                            <div className="flex items-center gap-2 text-muted-foreground">
                              <Phone className="h-4 w-4 shrink-0" />
                              <span>{azienda.telefono}</span>
                            </div>
                          )}
                          
                          {azienda.sito && (
                            <div className="flex items-center gap-2">
                              <Globe className="h-4 w-4 text-muted-foreground shrink-0" />
                              <a 
                                href={azienda.sito.startsWith('http') ? azienda.sito : `https://${azienda.sito}`}
                                target="_blank" 
                                rel="noopener noreferrer"
                                className="text-primary hover:underline flex items-center gap-1 truncate"
                                onClick={e => e.stopPropagation()}
                              >
                                {azienda.sito.replace(/^https?:\/\//, '')}
                                <ExternalLink className="h-3 w-3 shrink-0" />
                              </a>
                            </div>
                          )}
                        </div>

                        <div className="mt-3 flex flex-wrap gap-2">
                          <Badge variant="outline" className="text-xs">Dominio: {azienda.domainValid ? '✅ valido' : '❌ non valido'}</Badge>
                          <Badge variant="outline" className="text-xs">Email esplicita: {azienda.emailExplicit ? '✅ sì' : '❌ no'}</Badge>
                          <Badge variant="outline" className="text-xs">Fonte: {azienda.emailSourceType || 'n/d'}</Badge>
                          <Badge variant="outline" className="text-xs">SMTP: {azienda.smtpStatus || 'n/d'}</Badge>
                          <Badge variant="outline" className="text-xs">Catch-all: {azienda.catchAll ? 'Sì' : 'No'}</Badge>
                        </div>
                        
                        <p className="text-xs text-muted-foreground mt-2">
                          Fonte: {azienda.fonte}
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </>
      )}

      {!hasSearched && (
        <Card className="p-12 text-center">
          <Sparkles className="h-16 w-16 text-muted-foreground mx-auto mb-4" />
          <p className="text-muted-foreground">
            Inserisci una località e seleziona i settori di interesse.<br />
            L'AI cercherà aziende nella zona e troverà i contatti pubblici.
          </p>
        </Card>
      )}

      {/* Navigation */}
      <div className="flex justify-between pt-4">
        <Button variant="outline" onClick={() => setCurrentStep(1)}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Indietro
        </Button>
        <Button 
          onClick={() => setCurrentStep(3)}
          disabled={aziendeSelezionate.length === 0}
        >
          Prepara Email ({aziendeSelezionate.length})
          <ArrowRight className="h-4 w-4 ml-2" />
        </Button>
      </div>
    </div>
  );
}
