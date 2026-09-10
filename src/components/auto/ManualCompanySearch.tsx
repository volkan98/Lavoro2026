import { scopedStorageKey, requireUid, apiFetch, sanitizeForFirestore } from '@/lib/api/client';
import { useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Search, Plus, Loader2, Building2, MapPin, Mail, CheckCircle2 } from 'lucide-react';
import { aiAgent, Company } from '@/lib/api/ai-agent';
import { isCompanyAlreadySentFirestore } from '@/lib/companyDeduplication';
import { db } from '@/lib/firebase';
import { doc, setDoc } from 'firebase/firestore';

interface ManualSearchResult {
  name: string;
  email?: string;
  city?: string;
  sector?: string;
  website?: string;
  phone?: string;
  source?: string;
  address?: string;
  confidence_score?: number;
  final_status?: string;
}

interface ManualCompanySearchProps {
  campaignId: string;
}

export function ManualCompanySearch({ campaignId }: ManualCompanySearchProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [query, setQuery] = useState('');
  const [location, setLocation] = useState('');
  const [results, setResults] = useState<ManualSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [addedEmails, setAddedEmails] = useState<Set<string>>(new Set());

  const userId = requireUid(user?.id);

  const handleSearch = async () => {
    if (!query.trim()) return;
    setIsSearching(true);
    setResults([]);

    try {
      const keywords = query.split(',').map((k) => k.trim()).filter(Boolean);
      const res = await aiAgent.searchCompanies(
        location || 'Bioggio, Svizzera',
        50,
        keywords,
        undefined,
        undefined,
        20,
        location || undefined,
        !!location
      );

      if (res.success && res.data && res.data.length > 0) {
        const mapped: ManualSearchResult[] = res.data.map((c: Company) => ({
          name: c.name,
          email: c.email || undefined,
          city: c.city,
          sector: c.sector,
          website: c.website,
          phone: c.phone || undefined,
          source: c.source || 'manual_search',
          address: c.address,
          confidence_score: c.confidence_score,
          final_status: c.final_status,
        }));
        setResults(mapped);
      } else {
        toast({ title: 'Nessun risultato', description: 'Prova con parole chiave diverse.' });
      }
    } catch (err: any) {
      toast({ title: 'Errore ricerca', description: err.message, variant: 'destructive' });
    } finally {
      setIsSearching(false);
    }
  };

  const addToQueue = async (company: ManualSearchResult) => {
    if (!company.email) return;

    // Check duplicate in Firestore "Già Inviato" (Source of Truth)
    const dupCheck = await isCompanyAlreadySentFirestore(
      {
        email: company.email,
        name: company.name,
        website: company.website,
      },
      userId
    );

    if (dupCheck.isAlreadySent) {
      toast({
        title: 'Già contattata',
        description: `Azienda già contattata nello storico Firestore (${dupCheck.detail || company.name}).`,
      });
      return;
    }

    const queueItemId = `queue_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
    const queueRecord = {
      id: queueItemId,
      campaign_id: campaignId,
      user_id: userId,
      company_name: company.name,
      company_email: company.email.toLowerCase(),
      company_city: company.city || null,
      company_sector: company.sector || null,
      company_website: company.website || null,
      company_phone: company.phone || null,
      company_source: 'manual_search',
      company_address: company.address || null,
      contact_final_status: company.final_status || 'ready_to_send',
      confidence_score: company.confidence_score || 75,
      status: 'pending',
      created_at: new Date().toISOString(),
    };

    // Save to Firestore
    try {
      const cleanRecord = sanitizeForFirestore(queueRecord);
      const qDocRef1 = doc(db, 'users', userId, 'campaigns', 'current', 'queue', queueItemId);
      const qDocRef2 = doc(db, 'users', userId, 'campaign_queue', queueItemId);
      setDoc(qDocRef1, cleanRecord, { merge: true }).catch(() => {});
      setDoc(qDocRef2, cleanRecord, { merge: true }).catch(() => {});
    } catch (e) {
      console.warn('Firestore queue save:', e);
    }

    // Save to Server
    try {
      await apiFetch('/api/campaign-queue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(queueRecord),
      });
    } catch (e) {
      // ignore
    }

    // Save to LocalStorage and notify hook
    try {
      const stored = localStorage.getItem(scopedStorageKey('ais_job_outreach_campaign_queue'));
      const items = stored ? JSON.parse(stored) : [];
      if (!items.some((i: any) => i.id === queueRecord.id || i.company_email === queueRecord.company_email)) {
        items.unshift(queueRecord);
        localStorage.setItem(scopedStorageKey('ais_job_outreach_campaign_queue'), JSON.stringify(items));
        window.dispatchEvent(new Event('campaign_queue_updated'));
      }
    } catch (e) {
      // ignore
    }

    setAddedEmails((prev) => new Set(prev).add(company.email!.toLowerCase()));
    toast({ title: '✅ Aggiunta!', description: `${company.name} aggiunta alla coda della campagna.` });
  };

  const addAll = async () => {
    const validResults = results.filter((r) => r.email && !addedEmails.has(r.email.toLowerCase()));
    for (const company of validResults) {
      await addToQueue(company);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Search className="h-4 w-4 text-primary" />
          Ricerca Manuale & Aggiunta a Coda
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
          <Input
            placeholder="Settore / Parole chiave (es: verniciatura, metalli)"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="md:col-span-2"
          />
          <Input
            placeholder="Città (es: Bioggio, Manno, Lugano)"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
          />
        </div>

        <Button onClick={handleSearch} disabled={isSearching || !query.trim()} className="w-full">
          {isSearching ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Search className="h-4 w-4 mr-2" />}
          Cerca Aziende
        </Button>

        {results.length > 0 && (
          <div className="space-y-3 pt-2">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">Trovate {results.length} aziende</span>
              <Button size="sm" variant="outline" onClick={addAll}>
                <Plus className="h-3 w-3 mr-1" /> Aggiungi Tutte con Email
              </Button>
            </div>

            <ScrollArea className="h-[280px] rounded-md border p-2">
              <div className="space-y-2">
                {results.map((c, i) => {
                  const isAdded = c.email && addedEmails.has(c.email.toLowerCase());
                  return (
                    <div
                      key={i}
                      className="flex items-center justify-between p-2 rounded-lg border bg-card/50 hover:bg-muted/50 transition-colors text-sm"
                    >
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex items-center gap-2">
                          <Building2 className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                          <span className="font-medium truncate">{c.name}</span>
                          {c.sector && (
                            <Badge variant="outline" className="text-[10px] px-1 py-0">
                              {c.sector}
                            </Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-3 text-xs text-muted-foreground">
                          {c.city && (
                            <span className="flex items-center gap-1">
                              <MapPin className="h-3 w-3" /> {c.city}
                            </span>
                          )}
                          {c.email ? (
                            <span className="flex items-center gap-1 text-primary">
                              <Mail className="h-3 w-3" /> {c.email}
                            </span>
                          ) : (
                            <span className="text-muted-foreground italic">Nessuna email</span>
                          )}
                        </div>
                      </div>

                      {c.email && (
                        <Button
                          size="sm"
                          variant={isAdded ? 'ghost' : 'outline'}
                          disabled={!!isAdded}
                          onClick={() => addToQueue(c)}
                          className="shrink-0 ml-2"
                        >
                          {isAdded ? (
                            <CheckCircle2 className="h-4 w-4 text-green-500" />
                          ) : (
                            <Plus className="h-4 w-4" />
                          )}
                        </Button>
                      )}
                    </div>
                  );
                })}
              </div>
            </ScrollArea>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
