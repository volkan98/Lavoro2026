import { useState, useEffect, useRef } from 'react';
import { ManualCompanySearch } from './ManualCompanySearch';
import { useCVContext } from '@/contexts/CVContext';
import { useUserProfile } from '@/hooks/useUserProfile';
import { useAutoCampaign, CampaignSetupData } from '@/hooks/useAutoCampaign';
import { useEmailOAuth } from '@/hooks/useEmailOAuth';
import { CityAutocomplete, LocationSelection } from '@/components/ui/city-autocomplete';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  Rocket, Pause, Play, Square, Search, Send, AlertTriangle,
  CheckCircle2, Clock, XCircle, Loader2, Sparkles, Building2,
  Mail, Shield, Timer, RotateCcw, Zap, Activity, Target,
  TrendingUp, RefreshCw, Terminal, FileText, ShieldCheck,
  AlertOctagon, Calendar, Info
} from 'lucide-react';
import { PACING_CONSTANTS, cleanHourlyTimestamps, getTodayDateString, PacingState } from '@/lib/campaignPacing';

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

function CampaignSetup({ onStart }: { onStart: (data: CampaignSetupData) => void }) {
  const { cvData, cvFileState } = useCVContext();
  const { profile } = useUserProfile();
  const { connectedProviders, connect } = useEmailOAuth();

  const [searchMode, setSearchMode] = useState<'standard' | 'swiss_painting'>('standard');
  const [location, setLocation] = useState(cvData?.citta || profile?.city || 'Lugano, Canton Ticino');
  const [locationSelection, setLocationSelection] = useState<LocationSelection | null>(null);
  const [radius, setRadius] = useState('30');
  const [keywords, setKeywords] = useState<string[]>(() => {
    if (cvData?.competenze && cvData.competenze.length > 0) {
      return cvData.competenze.slice(0, 3);
    }
    return ['produzione', 'verniciatura', 'metalmeccanica'];
  });
  const [target, setTarget] = useState('50');
  const [emailStyle, setEmailStyle] = useState('standard');
  const [includeRisky, setIncludeRisky] = useState(false);
  const [onlyCity, setOnlyCity] = useState(false);

  // Keep location synced if candidate data loads late
  useEffect(() => {
    if (!location && (cvData?.citta || profile?.city)) {
      setLocation(cvData?.citta || profile?.city || 'Lugano, Canton Ticino');
    }
  }, [cvData?.citta, profile?.city, location]);

  const hasGmail = connectedProviders.some(p => p.provider === 'gmail');
  const isSwissMode = searchMode === 'swiss_painting';

  const handleStart = () => {
    if (isSwissMode) {
      onStart({
        search_mode: 'swiss_painting',
        search_location: 'Bioggio, Canton Ticino',
        search_location_query: 'Bioggio, Canton Ticino, Svizzera',
        search_radius: 15,
        search_keywords: ['verniciatura industriale'],
        only_selected_city: false,
        target_total: parseInt(target),
        email_style: emailStyle,
        include_risky: includeRisky,
        user_city: cvData?.citta || 'Bioggio',

        cv_file_path: profile?.cv_file_path || undefined,
      });
      return;
    }
    if (!location || keywords.length === 0) return;
    onStart({
      search_mode: 'standard',
      search_location: location,
      search_location_query: locationSelection?.searchQuery || location,
      search_radius: parseInt(radius),
      search_keywords: keywords,
      only_selected_city: onlyCity,
      target_total: parseInt(target),
      email_style: emailStyle,
      include_risky: includeRisky,
      user_city: cvData?.citta || location,
      cv_file_path: profile?.cv_file_path || undefined,
    });
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="text-center space-y-2">
        <h2 className="text-2xl md:text-3xl font-bold text-foreground flex items-center justify-center gap-2">
          <Rocket className="h-7 w-7 text-primary" />
          Auto Mode
        </h2>
        <p className="text-muted-foreground">
          Il sistema cerca aziende, genera email e invia automaticamente
        </p>
      </div>

      {!hasGmail && (
        <Alert className="border-destructive/50 bg-destructive/5">
          <AlertTriangle className="h-4 w-4 text-destructive" />
          <AlertDescription>
            <div className="flex items-center justify-between">
              <span>Connetti Gmail per usare Auto Mode</span>
              <Button size="sm" onClick={() => connect('gmail')}>Connetti Gmail</Button>
            </div>
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Target className="h-5 w-5 text-primary" />
            Configura Campagna
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label className="text-sm font-medium mb-2 block">Modalità di ricerca</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setSearchMode('standard')}
                className={`p-3 rounded-lg border text-left transition-colors ${
                  !isSwissMode
                    ? 'border-primary bg-primary/10'
                    : 'border-border hover:border-primary/50'
                }`}
              >
                <div className="font-semibold text-sm flex items-center gap-1.5">
                  <Search className="h-4 w-4" /> Standard
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  Scegli città e settori manualmente
                </div>
              </button>
              <button
                type="button"
                onClick={() => setSearchMode('swiss_painting')}
                className={`p-3 rounded-lg border text-left transition-colors ${
                  isSwissMode
                    ? 'border-primary bg-primary/10'
                    : 'border-border hover:border-primary/50'
                }`}
              >
                <div className="font-semibold text-sm">🇨🇭 Verniciatura Ticino – Zona Bioggio/Lugano</div>
                <div className="text-xs text-muted-foreground mt-1">
                  Ricerca mirata entro 10-15 min da Bioggio. Priorità Manno, Lamone, Bedano. Esclusi Mendrisio e Chiasso.
                </div>
              </button>
            </div>
          </div>

          {!isSwissMode && (
          <div>
            <label className="text-sm font-medium mb-2 block">📍 Zona / Città</label>
            <CityAutocomplete
              placeholder="es. Lugano, Ticino..."
              value={location}
              onChange={setLocation}
              onLocationSelect={setLocationSelection}
            />
          </div>
          )}


          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium mb-2 block">Raggio</label>
              <Select value={radius} onValueChange={setRadius}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="10">10 km</SelectItem>
                  <SelectItem value="20">20 km</SelectItem>
                  <SelectItem value="30">30 km</SelectItem>
                  <SelectItem value="50">50 km</SelectItem>
                  <SelectItem value="100">100 km</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium mb-2 block">🎯 Target email</label>
              <Select value={target} onValueChange={setTarget}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="20">20 email</SelectItem>
                  <SelectItem value="50">50 email</SelectItem>
                  <SelectItem value="100">100 email</SelectItem>
                  <SelectItem value="150">150 email</SelectItem>
                  <SelectItem value="200">200 email</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {!isSwissMode && (
          <div>
            <label className="text-sm font-medium mb-2 block">Settori</label>
            <div className="flex flex-wrap gap-2">
              {KEYWORDS.map(kw => (
                <Badge
                  key={kw.id}
                  variant={keywords.includes(kw.id) ? 'default' : 'outline'}
                  className="cursor-pointer hover:bg-primary/80"
                  onClick={() => setKeywords(prev =>
                    prev.includes(kw.id) ? prev.filter(k => k !== kw.id) : [...prev, kw.id]
                  )}
                >
                  {kw.label}
                </Badge>
              ))}
            </div>
          </div>
          )}

          {isSwissMode && (
            <Alert className="border-primary/30 bg-primary/5">
              <Search className="h-4 w-4 text-primary" />
              <AlertDescription className="text-sm">
                Il bot cercherà automaticamente aziende di <strong>verniciatura industriale</strong> nella
                zona Bioggio/Lugano (entro 10-15 min da Bioggio, limite nord: Bellinzona), verificando che
                ogni sito sia online e che l'email sia reale. Mendrisio, Chiasso, Italia e il resto della
                Svizzera sono esclusi.
              </AlertDescription>
            </Alert>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium mb-2 block">Stile email</label>
              <Select value={emailStyle} onValueChange={setEmailStyle}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="breve">Breve</SelectItem>
                  <SelectItem value="standard">Standard</SelectItem>
                  <SelectItem value="formale">Formale</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Checkbox id="includeRisky" checked={includeRisky} onCheckedChange={(c) => setIncludeRisky(c as boolean)} />
              <label htmlFor="includeRisky" className="text-sm cursor-pointer">Includi contatti "risky" (meno verificati)</label>
            </div>
            {!isSwissMode && (
            <div className="flex items-center gap-2">
              <Checkbox id="onlyCity" checked={onlyCity} onCheckedChange={(c) => setOnlyCity(c as boolean)} />
              <label htmlFor="onlyCity" className="text-sm cursor-pointer">Solo città selezionata</label>
            </div>
            )}
          </div>

          <div className="flex items-center gap-2.5 p-3 rounded-lg border bg-muted/40 text-xs text-muted-foreground">
            <FileText className="h-4 w-4 text-primary shrink-0" />
            <div className="flex-1">
              <span className="font-semibold text-foreground">Allegato CV PDF:</span>{' '}
              <span className="text-foreground/90 font-mono text-[11px]">{cvFileState?.fileName || (profile?.cv_file_path ? profile.cv_file_path.split('/').pop() : 'Curriculum_Vitae.pdf')}</span>
              <div className="text-green-600 dark:text-green-400 font-medium text-[11px] mt-0.5">
                ✓ Il tuo Curriculum Vitae in formato PDF verrà allegato a ciascuna email inviata
              </div>
            </div>
          </div>

          <Button
            className="w-full"
            size="lg"
            onClick={handleStart}
            disabled={!hasGmail || (!isSwissMode && (!location || keywords.length === 0))}
          >
            <Rocket className="h-5 w-5 mr-2" />
            Avvia Auto Mode
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

function StatusBadge({
  status,
  pauseType,
  hasGmailError,
}: {
  status: string;
  pauseType?: string;
  hasGmailError?: boolean;
}) {
  if (hasGmailError) {
    return (
      <Badge variant="destructive" className="bg-destructive/15 text-destructive border-destructive/40 font-medium">
        <AlertOctagon className="h-3 w-3 mr-1" />
        Errore Gmail (Arrestato)
      </Badge>
    );
  }

  if (pauseType === 'daily_limit') {
    return (
      <Badge variant="outline" className="bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/30 font-medium">
        <Calendar className="h-3 w-3 mr-1" />
        Limite 50/giorno raggiunto
      </Badge>
    );
  }

  if (pauseType === 'block_cooldown') {
    return (
      <Badge variant="outline" className="bg-indigo-500/10 text-indigo-700 dark:text-indigo-400 border-indigo-500/30 font-medium">
        <Shield className="h-3 w-3 mr-1" />
        Pausa blocco (20–40m)
      </Badge>
    );
  }

  if (pauseType === 'interval') {
    return (
      <Badge variant="outline" className="bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/30 font-medium">
        <Timer className="h-3 w-3 mr-1" />
        Pacing naturale (6–12m)
      </Badge>
    );
  }

  if (pauseType === 'hourly_limit') {
    return (
      <Badge variant="outline" className="bg-orange-500/10 text-orange-700 dark:text-orange-400 border-orange-500/30 font-medium">
        <Clock className="h-3 w-3 mr-1" />
        Limite 8/ora (In attesa)
      </Badge>
    );
  }

  const config: Record<string, { icon: any; label: string; className: string }> = {
    running: { icon: Activity, label: 'In esecuzione (Pacing naturale)', className: 'bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/30' },
    paused: { icon: Pause, label: 'In pausa', className: 'bg-yellow-500/10 text-yellow-700 dark:text-yellow-400 border-yellow-500/30' },
    completed: { icon: CheckCircle2, label: 'Obiettivo completato', className: 'bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/30' },
    stopped: { icon: Square, label: 'Fermata', className: 'bg-muted text-muted-foreground' },
    idle: { icon: Clock, label: 'In attesa', className: 'bg-muted text-muted-foreground' },
    error: { icon: XCircle, label: 'Errore', className: 'bg-destructive/10 text-destructive' },
  };
  const c = config[status] || config.idle;
  const Icon = c.icon;
  return (
    <Badge variant="outline" className={c.className}>
      <Icon className="h-3 w-3 mr-1" />
      {c.label}
    </Badge>
  );
}

function CampaignDashboard({
  campaign,
  events,
  queueItems,
  pacingState,
  clearGmailError,
  pauseCampaign,
  resumeCampaign,
  stopCampaign,
  resetCampaign,
  triggerProcessor,
}: {
  campaign: any;
  events: any[];
  queueItems: any[];
  pacingState?: PacingState;
  clearGmailError?: () => void;
  pauseCampaign: () => Promise<void>;
  resumeCampaign: () => Promise<void>;
  stopCampaign: () => Promise<void>;
  resetCampaign: () => Promise<void>;
  triggerProcessor: () => void;
}) {
  const { cvFileState } = useCVContext();
  const { profile } = useUserProfile();
  const { connect } = useEmailOAuth();
  const [cooldownRemaining, setCooldownRemaining] = useState('');

  // Pacing calculations
  const today = getTodayDateString();
  const dailySent = pacingState?.dailyDate === today
    ? pacingState.dailySentCount
    : (campaign?.daily_date === today ? (campaign.daily_sent_count || 0) : 0);

  const dailyRemaining = Math.max(0, PACING_CONSTANTS.DAILY_MAX_SENDS - dailySent);
  const targetRemaining = Math.max(0, (campaign?.target_total || 50) - (campaign?.total_sent || 0));
  const hourlySentCount = pacingState?.hourlySentTimestamps
    ? cleanHourlyTimestamps(pacingState.hourlySentTimestamps).length
    : (campaign?.hourly_sent_count || 0);

  const nextSendTimestamp = pacingState?.nextScheduledSendAt || (campaign?.resume_at ? new Date(campaign.resume_at).getTime() : null);
  const nextSendFormatted = nextSendTimestamp && nextSendTimestamp > Date.now()
    ? new Date(nextSendTimestamp).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : null;

  const activePauseType = pacingState?.pauseType || campaign?.active_pause_type || 'none';
  const hasGmailError = Boolean(pacingState?.gmailError || campaign?.gmail_error);

  useEffect(() => {
    const updateCountdown = () => {
      const targetTime = pacingState?.nextScheduledSendAt || (campaign?.resume_at ? new Date(campaign.resume_at).getTime() : null);
      if (!targetTime) {
        setCooldownRemaining('');
        return;
      }
      const remaining = targetTime - Date.now();
      if (remaining <= 0) {
        setCooldownRemaining('');
        return;
      }
      const min = Math.floor(remaining / 60000);
      const sec = Math.floor((remaining % 60000) / 1000);
      setCooldownRemaining(`${min}m ${sec.toString().padStart(2, '0')}s`);
    };

    updateCountdown();
    const interval = setInterval(updateCountdown, 1000);
    return () => clearInterval(interval);
  }, [pacingState?.nextScheduledSendAt, campaign?.resume_at]);

  if (!campaign) return null;

  const progress = campaign.target_total > 0 ? (campaign.total_sent / campaign.target_total) * 100 : 0;
  const dailyPercent = Math.min(100, Math.round((dailySent / PACING_CONSTANTS.DAILY_MAX_SENDS) * 100));
  const isActive = ['running', 'paused'].includes(campaign.status);

  const safeQueue = Array.isArray(queueItems) ? queueItems : [];
  const queueStats = {
    pending: safeQueue.filter(q => q.status === 'pending').length,
    generated: safeQueue.filter(q => q.status === 'email_generated').length,
    sent: safeQueue.filter(q => q.status === 'sent').length,
    failed: safeQueue.filter(q => q.status === 'failed').length,
    discarded: safeQueue.filter(q => q.status === 'discarded').length,
  };

  // Human description of active pause
  const getPauseDescription = () => {
    switch (activePauseType) {
      case 'interval':
        return 'Intervallo naturale casuale di 6–12 minuti tra un\'email e la successiva per simulare un comportamento umano autentico.';
      case 'block_cooldown':
        return `Pausa di sicurezza di 20–40 minuti dopo un blocco di candidature per proteggere l'account dai filtri antispam di Google.`;
      case 'hourly_limit':
        return `Limite orario di 8 candidature raggiunto nell'ultima ora (${hourlySentCount}/8). In attesa dello sblocco della finestra mobile.`;
      case 'daily_limit':
        return `Limite giornaliero rigido di 50 candidature raggiunto per oggi (${dailySent}/50). Gli invii riprenderanno automaticamente domani.`;
      case 'temp_error_cooldown':
        return 'Attesa precauzionale di 30 minuti dopo un errore temporaneo per evitare ulteriori blocchi.';
      case 'gmail_error':
        return 'Auto Mode interrotto per salvaguardare l\'account Gmail da segnalazioni o limitazioni.';
      default:
        return campaign.pause_reason || 'Pausa attiva';
    }
  };

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      {/* Header with status badges */}
      <div className="text-center space-y-2">
        <h2 className="text-2xl md:text-3xl font-bold text-foreground flex items-center justify-center gap-2">
          <Zap className="h-7 w-7 text-primary" />
          Auto Mode Dashboard
        </h2>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <StatusBadge
            status={campaign.status}
            pauseType={activePauseType}
            hasGmailError={hasGmailError}
          />
          {cooldownRemaining && (
            <Badge variant="outline" className="bg-yellow-500/10 text-yellow-700 dark:text-yellow-400 border-yellow-500/30">
              <Timer className="h-3 w-3 mr-1" />
              Prossimo invio in {cooldownRemaining}
            </Badge>
          )}
        </div>
      </div>

      {/* ----------------------------------------------------------------- */}
      {/* VISIBLE DAILY COUNTER CARD: "Invii oggi: X / 50" */}
      {/* ----------------------------------------------------------------- */}
      <div className="p-4 rounded-xl border bg-card/90 shadow-sm space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="h-12 w-12 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
              <ShieldCheck className="h-6 w-6" />
            </div>
            <div>
              <div className="flex items-center gap-2.5 flex-wrap">
                <span className="text-2xl font-black tracking-tight text-foreground">
                  Invii oggi: {dailySent} / {PACING_CONSTANTS.DAILY_MAX_SENDS}
                </span>
                {dailySent >= PACING_CONSTANTS.DAILY_MAX_SENDS ? (
                  <Badge variant="destructive" className="text-xs">
                    Limite 50/giorno completato
                  </Badge>
                ) : (
                  <Badge variant="outline" className="bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/30 text-xs font-semibold">
                    Pacing Antispam Attivo
                  </Badge>
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                Massimo 50 al giorno • Minimo obiettivo 50 • Max 8 all'ora • Intervallo naturale 6–12 min tra email • Pausa 20–40 min ogni blocco
              </p>
            </div>
          </div>

          <div className="w-full sm:w-64 space-y-1.5 self-center">
            <div className="flex justify-between text-xs font-medium">
              <span className="text-muted-foreground">Progresso giornaliero:</span>
              <span className="text-foreground font-semibold">{dailySent} / 50 ({dailyPercent}%)</span>
            </div>
            <Progress value={dailyPercent} className="h-2.5" />
          </div>
        </div>
      </div>

      {/* ----------------------------------------------------------------- */}
      {/* GMAIL ERROR ALERT (If Gmail error occurred) */}
      {/* ----------------------------------------------------------------- */}
      {hasGmailError && (
        <Alert variant="destructive" className="border-destructive/60 bg-destructive/10">
          <AlertOctagon className="h-5 w-5 text-destructive mt-0.5" />
          <div className="flex-1 space-y-2">
            <AlertTitle className="font-bold text-base flex items-center justify-between flex-wrap gap-2">
              <span>🚨 Auto Mode Interrotto: Errore Account Gmail</span>
              {clearGmailError && (
                <Button size="sm" variant="outline" onClick={clearGmailError} className="h-7 text-xs bg-background">
                  Azzera Errore e Sblocca
                </Button>
              )}
            </AlertTitle>
            <AlertDescription className="text-xs space-y-2 text-foreground/90">
              <div className="p-2.5 rounded bg-background/80 border border-destructive/30 font-mono text-[11px] text-destructive break-words">
                {pacingState?.gmailError || campaign.gmail_error}
              </div>
              <p>
                Per proteggere il tuo account Gmail da penalizzazioni o segnalazioni di spam, l'Auto Mode è stato immediatamente arrestato.
                Riconnetti l'account Google oppure verifica che le credenziali siano valide prima di riprendere.
              </p>
              <div className="flex items-center gap-2 pt-1">
                <Button size="sm" onClick={() => connect('gmail')}>
                  Riconnetti Account Gmail
                </Button>
                {clearGmailError && (
                  <Button size="sm" variant="secondary" onClick={clearGmailError}>
                    Sblocca Campagna
                  </Button>
                )}
              </div>
            </AlertDescription>
          </div>
        </Alert>
      )}

      {/* ----------------------------------------------------------------- */}
      {/* ACTIVE PAUSE / SCHEDULE BANNER */}
      {/* ----------------------------------------------------------------- */}
      {(cooldownRemaining || activePauseType !== 'none' || campaign.status === 'paused') && !hasGmailError && (
        <Alert className="bg-amber-500/5 border-amber-500/30">
          <Clock className="h-4 w-4 text-amber-600 dark:text-amber-400" />
          <div className="flex-1">
            <AlertTitle className="text-sm font-bold text-amber-800 dark:text-amber-300 flex items-center justify-between flex-wrap gap-2">
              <span>
                {activePauseType === 'daily_limit' ? '🛑 Invii Sospesi fino a Domani (Limite 50/giorno)' :
                 activePauseType === 'block_cooldown' ? '⏸️ Pausa di Sicurezza Blocco Attiva (20–40 min)' :
                 activePauseType === 'interval' ? '⏳ Intervallo Naturale Graduale Attivo (6–12 min)' :
                 activePauseType === 'hourly_limit' ? '⏱️ Pausa Limite Orario (Max 8 all\'ora)' :
                 '⏸️ Campagna in Pausa'}
              </span>
              {cooldownRemaining && (
                <span className="font-mono text-xs px-2 py-0.5 rounded bg-amber-500/20 text-amber-900 dark:text-amber-200">
                  Prossimo invio in {cooldownRemaining} {nextSendFormatted ? `(alle ${nextSendFormatted})` : ''}
                </span>
              )}
            </AlertTitle>
            <AlertDescription className="text-xs text-muted-foreground mt-1">
              {getPauseDescription()}
            </AlertDescription>
          </div>
        </Alert>
      )}

      {/* Controls */}
      <div className="flex items-center justify-center gap-3 flex-wrap">
        {campaign.status === 'running' && (
          <Button variant="outline" onClick={pauseCampaign}>
            <Pause className="h-4 w-4 mr-2" /> Pausa
          </Button>
        )}
        {campaign.status === 'paused' && (
          <Button onClick={resumeCampaign}>
            <Play className="h-4 w-4 mr-2" /> Riprendi
          </Button>
        )}
        {isActive && (
          <Button variant="destructive" onClick={stopCampaign}>
            <Square className="h-4 w-4 mr-2" /> Ferma
          </Button>
        )}
        {isActive && (
          <Button variant="outline" size="sm" onClick={triggerProcessor} title="Esegui controllo del pacing antispam">
            <RefreshCw className="h-4 w-4 mr-1" /> Verifica Coda
          </Button>
        )}
        <Button variant="outline" size="sm" onClick={resetCampaign} className="text-muted-foreground hover:text-foreground">
          <RotateCcw className="h-4 w-4 mr-1.5" /> Nuova Campagna
        </Button>
      </div>

      {/* CV PDF Attachment Guarantee */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 px-4 py-2.5 rounded-lg border bg-muted/30 text-xs">
        <div className="flex items-center gap-2">
          <FileText className="h-4 w-4 text-primary shrink-0" />
          <span className="font-semibold text-foreground">Allegato CV PDF Certificato:</span>
          <span className="font-mono text-muted-foreground">{cvFileState?.fileName || (profile?.cv_file_path ? profile.cv_file_path.split('/').pop() : 'Curriculum_Vitae.pdf')}</span>
        </div>
        <Badge variant="outline" className="bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/30 text-[10px]">
          ✓ Allegato PDF verificato e inviato in ogni candidatura
        </Badge>
      </div>

      {/* ----------------------------------------------------------------- */}
      {/* 4 MANDATORY SUMMARY STATS */}
      {/* 1. Candidature inviate | 2. Rimanenti | 3. Prossimo invio | 4. Stato */}
      {/* ----------------------------------------------------------------- */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {/* 1. Candidature inviate */}
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">Candidature Inviate</span>
              <Send className="h-4 w-4 text-green-500" />
            </div>
            <div className="text-2xl font-bold text-foreground mt-1">
              {dailySent} <span className="text-sm font-normal text-muted-foreground">/ 50 oggi</span>
            </div>
            <p className="text-[11px] text-muted-foreground mt-1">
              Totale campagna: <span className="font-semibold text-foreground">{campaign.total_sent}</span> • Ultima ora: <span className="font-semibold text-foreground">{hourlySentCount}/8</span>
            </p>
          </CardContent>
        </Card>

        {/* 2. Candidature rimanenti */}
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">Candidature Rimanenti</span>
              <Target className="h-4 w-4 text-blue-500" />
            </div>
            <div className="text-2xl font-bold text-foreground mt-1">
              {dailyRemaining} <span className="text-sm font-normal text-muted-foreground">oggi</span>
            </div>
            <p className="text-[11px] text-muted-foreground mt-1">
              {targetRemaining} per l'obiettivo ({campaign.target_total}) • {queueStats.pending + queueStats.generated} in coda
            </p>
          </CardContent>
        </Card>

        {/* 3. Prossimo invio previsto */}
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">Prossimo Invio Previsto</span>
              <Timer className="h-4 w-4 text-amber-500" />
            </div>
            <div className="text-xl font-bold text-foreground mt-1 truncate">
              {cooldownRemaining ? (
                <span className="text-amber-600 dark:text-amber-400 font-mono">{cooldownRemaining}</span>
              ) : campaign.status === 'running' ? (
                <span className="text-green-600 dark:text-green-400">In preparazione</span>
              ) : (
                <span className="text-muted-foreground">In pausa</span>
              )}
            </div>
            <p className="text-[11px] text-muted-foreground mt-1 truncate">
              {nextSendFormatted ? `Stimato alle ${nextSendFormatted}` : 'Pacing graduale (6–12 min)'}
            </p>
          </CardContent>
        </Card>

        {/* 4. Stato Auto Mode */}
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">Stato Auto Mode</span>
              <Activity className="h-4 w-4 text-primary" />
            </div>
            <div className="mt-1.5">
              <StatusBadge
                status={campaign.status}
                pauseType={activePauseType}
                hasGmailError={hasGmailError}
              />
            </div>
            <p className="text-[11px] text-muted-foreground mt-1">
              Ciclo ricerca {campaign.current_search_cycle}/{campaign.max_search_cycles} • Zero rischio spam
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Progress towards overall target */}
      <Card>
        <CardContent className="pt-5 pb-5">
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium">Progresso Obiettivo Campagna</span>
              <span className="text-muted-foreground font-mono text-xs">
                {campaign.total_sent} / {campaign.target_total} email totali ({Math.round(progress)}%)
              </span>
            </div>
            <Progress value={progress} className="h-2.5" />
          </div>
        </CardContent>
      </Card>

      {/* Secondary Stats Grid */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Card>
          <CardContent className="pt-3 pb-3 text-center">
            <Search className="h-4 w-4 mx-auto text-primary mb-1" />
            <div className="text-xl font-bold">{campaign.total_found}</div>
            <div className="text-[11px] text-muted-foreground">Trovate</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-3 pb-3 text-center">
            <Mail className="h-4 w-4 mx-auto text-blue-500 mb-1" />
            <div className="text-xl font-bold">{queueStats.generated}</div>
            <div className="text-[11px] text-muted-foreground">Pronte</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-3 pb-3 text-center">
            <Send className="h-4 w-4 mx-auto text-green-500 mb-1" />
            <div className="text-xl font-bold text-green-600">{campaign.total_sent}</div>
            <div className="text-[11px] text-muted-foreground">Inviate Totali</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-3 pb-3 text-center">
            <XCircle className="h-4 w-4 mx-auto text-destructive mb-1" />
            <div className="text-xl font-bold text-destructive">{campaign.total_failed}</div>
            <div className="text-[11px] text-muted-foreground">Fallite</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-3 pb-3 text-center">
            <AlertTriangle className="h-4 w-4 mx-auto text-muted-foreground mb-1" />
            <div className="text-xl font-bold">{campaign.total_skipped}</div>
            <div className="text-[11px] text-muted-foreground">Scartate</div>
          </CardContent>
        </Card>
      </div>

      {/* Three columns: Queue | Manual Search | Live Console */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Queue Status */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Building2 className="h-4 w-4 text-primary" />
              Coda ({safeQueue.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <ScrollArea className="h-[350px]">
              <div className="space-y-1 p-4">
                {safeQueue.length === 0 && (
                  <p className="text-sm text-muted-foreground text-center py-4">Coda vuota — ricerca in corso</p>
                )}
                {safeQueue.slice(0, 50).map(item => (
                  <div key={item.id} className="flex items-center justify-between py-1.5 border-b border-border/50 last:border-0">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate">{item.company_name}</p>
                      <p className="text-xs text-muted-foreground truncate">{item.company_email}</p>
                    </div>
                    <QueueStatusBadge status={item.status} />
                  </div>
                ))}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>

        {/* Manual Search */}
        {campaign && <ManualCompanySearch campaignId={campaign.id} />}

        {/* Live Console */}
        <LiveConsole events={events} />
      </div>

      {/* Campaign Info */}
      <Card>
        <CardContent className="pt-4 pb-4">
          <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
            {(campaign as any).search_mode === 'swiss_painting' && (
              <Badge variant="outline" className="border-primary/40 text-primary">🇨🇭 Verniciatura Svizzera</Badge>
            )}
            <span>📍 {campaign.search_location}</span>
            <span>📏 {campaign.search_radius} km</span>
            <span>🔑 {campaign.search_keywords?.join(', ')}</span>
            <span>✉️ Stile: {campaign.email_style}</span>
            {campaign.started_at && <span>⏱️ Avviata: {new Date(campaign.started_at).toLocaleString('it-IT')}</span>}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function LiveConsole({ events }: { events: { id: string; event_type: string; message: string; created_at: string; metadata: any }[] }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const safeEvents = Array.isArray(events) ? events : [];

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = 0;
    }
  }, [safeEvents.length]);

  const getLogColor = (type: string) => {
    if (['email_sent', 'search_completed', 'auto_resume', 'target_completed'].includes(type)) return 'text-green-400';
    if (['send_failed', 'error'].includes(type)) return 'text-red-400';
    if (['paused_rate_limit', 'rate_limit', 'search_empty'].includes(type)) return 'text-yellow-400';
    if (['search_started'].includes(type)) return 'text-blue-400';
    return 'text-gray-300';
  };

  const getPrefix = (type: string) => {
    if (['email_sent', 'search_completed', 'auto_resume', 'target_completed'].includes(type)) return '✓';
    if (['send_failed', 'error'].includes(type)) return '✗';
    if (['paused_rate_limit', 'rate_limit'].includes(type)) return '⏸';
    if (['search_started'].includes(type)) return '→';
    if (['search_empty', 'search_exhausted'].includes(type)) return '⚠';
    return '•';
  };

  return (
    <Card className="bg-[#1e1e2e] border-[#313244]">
      <CardHeader className="pb-2 pt-3 px-4">
        <CardTitle className="text-sm flex items-center gap-2 text-gray-300">
          <Terminal className="h-4 w-4 text-green-400" />
          <span className="font-mono">Console Live</span>
          <span className="ml-auto text-[10px] font-mono text-gray-500">{safeEvents.length} eventi</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <div ref={scrollRef} className="h-[300px] overflow-y-auto font-mono text-xs px-4 pb-3">
          {safeEvents.length === 0 && (
            <div className="flex items-center gap-2 py-4 text-gray-500">
              <span className="animate-pulse">▌</span>
              <span>In attesa di eventi...</span>
            </div>
          )}
          {safeEvents.map((event, i) => (
            <div key={event.id} className="py-0.5 flex gap-2 leading-5">
              <span className="text-gray-600 shrink-0 select-none">
                {new Date(event.created_at).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              </span>
              <span className={`shrink-0 ${getLogColor(event.event_type)}`}>{getPrefix(event.event_type)}</span>
              <span className={getLogColor(event.event_type)}>{event.message}</span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function EventIcon({ type }: { type: string }) {
  const icons: Record<string, any> = {
    search_started: <Search className="h-3.5 w-3.5 text-blue-500 mt-0.5" />,
    search_completed: <CheckCircle2 className="h-3.5 w-3.5 text-green-500 mt-0.5" />,
    search_empty: <AlertTriangle className="h-3.5 w-3.5 text-yellow-500 mt-0.5" />,
    search_exhausted: <XCircle className="h-3.5 w-3.5 text-muted-foreground mt-0.5" />,
    email_sent: <Send className="h-3.5 w-3.5 text-green-500 mt-0.5" />,
    send_failed: <XCircle className="h-3.5 w-3.5 text-destructive mt-0.5" />,
    paused_rate_limit: <Shield className="h-3.5 w-3.5 text-yellow-500 mt-0.5" />,
    auto_resume: <Play className="h-3.5 w-3.5 text-green-500 mt-0.5" />,
    target_completed: <CheckCircle2 className="h-3.5 w-3.5 text-primary mt-0.5" />,
    error: <AlertTriangle className="h-3.5 w-3.5 text-destructive mt-0.5" />,
    rate_limit: <Timer className="h-3.5 w-3.5 text-yellow-500 mt-0.5" />,
  };
  return icons[type] || <Activity className="h-3.5 w-3.5 text-muted-foreground mt-0.5" />;
}

function QueueStatusBadge({ status }: { status: string }) {
  const config: Record<string, { label: string; className: string }> = {
    pending: { label: 'In attesa', className: 'bg-muted text-muted-foreground' },
    email_generated: { label: 'Pronta', className: 'bg-blue-500/10 text-blue-700' },
    sent: { label: 'Inviata', className: 'bg-green-500/10 text-green-700' },
    failed: { label: 'Fallita', className: 'bg-destructive/10 text-destructive' },
    discarded: { label: 'Scartata', className: 'bg-muted text-muted-foreground' },
  };
  const c = config[status] || config.pending;
  return <Badge variant="outline" className={`text-[10px] ${c.className}`}>{c.label}</Badge>;
}

export function AutoCampaignDashboard() {
  const { cvData, cvFileState, sintesiBreve, setCurrentStep } = useCVContext();
  const { profile } = useUserProfile();
  const autoCampaign = useAutoCampaign();
  const { campaign, isLoading, startCampaign } = autoCampaign;

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-3">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">Caricamento Auto Mode in corso...</p>
      </div>
    );
  }

  const hasCv = Boolean(
    profile?.cv_file_path ||
    profile?.cv_short_summary ||
    sintesiBreve ||
    cvData?.nome ||
    cvData?.profilo ||
    (cvData?.competenze && cvData.competenze.length > 0) ||
    cvFileState?.fileName ||
    localStorage.getItem('job_agent_cv_data') ||
    localStorage.getItem('ais_job_outreach_profile')
  );

  if (!hasCv) {
    return (
      <div className="text-center py-12 max-w-md mx-auto space-y-4">
        <div className="p-3 bg-muted/60 rounded-full w-14 h-14 mx-auto flex items-center justify-center">
          <Rocket className="h-7 w-7 text-primary" />
        </div>
        <h3 className="text-lg font-semibold">Carica il tuo CV per l'Auto Mode</h3>
        <p className="text-sm text-muted-foreground">
          L'intelligenza artificiale utilizzerà le tue competenze e la zona di confine per candidarti automaticamente alle migliori aziende in Svizzera e Italia (con Permesso G Frontalieri).
        </p>
        <div className="flex flex-col sm:flex-row gap-2 justify-center pt-2">
          <Button onClick={() => setCurrentStep(0)}>Carica CV (Fase 1)</Button>
        </div>
      </div>
    );
  }

  if (campaign && ['running', 'paused', 'completed', 'stopped'].includes(campaign.status)) {
    return <CampaignDashboard {...autoCampaign} />;
  }

  return <CampaignSetup onStart={startCampaign} />;
}
