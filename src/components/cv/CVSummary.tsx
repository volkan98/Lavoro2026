import { useState, useEffect } from 'react';
import { useCVContext } from '@/contexts/CVContext';
import { useUserProfile } from '@/hooks/useUserProfile';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { CityAutocomplete } from '@/components/ui/city-autocomplete';
import { 
  User, 
  MapPin, 
  Phone, 
  Mail, 
  Briefcase, 
  GraduationCap, 
  Languages, 
  Star,
  ArrowLeft,
  ArrowRight,
  RefreshCw,
  Plus,
  X,
  Save,
  Loader2
} from 'lucide-react';

import { summarizeCv, hasCvData, isPlaceholder } from '@/lib/cvNormalizer';

export function CVSummary() {
  const { cvData, setCvData, setSintesiBreve, setSintesiCompleta, sintesiBreve, sintesiCompleta, setCurrentStep } = useCVContext();
  const { saveProfile, isSaving, isLoading, syncError } = useUserProfile();
  const { toast } = useToast();
  const editedData = cvData;
  const setEditedData = setCvData;
  const [newCompetenza, setNewCompetenza] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);


  if (isLoading) return <p role="status">Recupero dei dati del CV…</p>;

  if (!hasCvData(cvData) || !editedData) {
    return (
      <div className="text-center py-12">
        <p className="text-muted">Nessun CV caricato. Torna al primo step.</p>
        <Button onClick={() => setCurrentStep(0)} className="mt-4">
          <ArrowLeft className="h-4 w-4 mr-2" />
          Carica CV
        </Button>
      </div>
    );
  }

  const handleRegenerate = async () => {
    setIsGenerating(true);
    const summaries = summarizeCv(editedData);
    setSintesiBreve(summaries.sintesiBreve);
    setSintesiCompleta(summaries.sintesiCompleta);
    if (!editedData.profilo && summaries.profilo) {
      setEditedData({
        ...editedData,
        profilo: summaries.profilo,
      });
    }
    setIsGenerating(false);
  };

  const handleAddCompetenza = () => {
    if (newCompetenza.trim() && editedData) {
      setEditedData({
        ...editedData,
        competenze: [...(editedData.competenze || []), newCompetenza.trim()]
      });
      setNewCompetenza('');
    }
  };

  const handleRemoveCompetenza = (index: number) => {
    if (editedData) {
      setEditedData({
        ...editedData,
        competenze: (editedData.competenze || []).filter((_, i) => i !== index)
      });
    }
  };

  const handleNext = async () => {
    if (!editedData) return;
    
    // Ensure placeholder strings are converted to empty string before saving
    const toSave = { ...editedData };
    for (const key of Object.keys(toSave) as (keyof typeof toSave)[]) {
      if (typeof toSave[key] === 'string' && isPlaceholder(toSave[key] as string)) {
        (toSave as any)[key] = '';
      }
    }

    setCvData(toSave);
    
    // Save to database
    const result = await saveProfile(toSave, sintesiBreve, sintesiCompleta);
    
    if (result.success) {
      toast({
        title: 'Profilo salvato',
        description: 'I dati del CV sono stati salvati nel tuo account.',
      });
    }
    
    if (result.success) setCurrentStep(2);
    else toast({ title: 'Salvataggio non riuscito', description: result.error, variant: 'destructive' });
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="text-center space-y-2">
        <h2 className="text-2xl md:text-3xl font-bold text-foreground">
          Sintesi del CV
        </h2>
        <p className="text-muted">
          Verifica i dati estratti e modifica se necessario
        </p>
      </div>

      {syncError && <p role="alert" className="text-destructive">{syncError}</p>}
      <Tabs defaultValue="dati" className="w-full">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="dati">Dati Personali</TabsTrigger>
          <TabsTrigger value="sintesi">Sintesi Generate</TabsTrigger>
        </TabsList>

        <TabsContent value="dati" className="space-y-4 mt-4">
          <Card><CardHeader><CardTitle>Permesso G</CardTitle></CardHeader><CardContent>
            <label className="text-sm">Stato dichiarato nel CV</label>
            <Input aria-label="Permesso G" placeholder="Non presente nel CV"
              value={typeof editedData.permessoG === 'boolean' ? (editedData.permessoG ? 'In possesso' : 'Non in possesso') : editedData.permessoG || ''}
              onChange={e => setEditedData({ ...editedData, permessoG: e.target.value })} />
            <Input aria-label="Dettaglio permesso" placeholder="Non presente nel CV" value={editedData.statoPermesso || ''}
              onChange={e => setEditedData({ ...editedData, statoPermesso: e.target.value })} />
          </CardContent></Card>

          {/* Info Personali */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-lg flex items-center gap-2">
                <User className="h-5 w-5 text-primary" />
                Informazioni Personali
              </CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium text-foreground">Nome</label>
                <Input
                  aria-label="nome" placeholder="Non presente nel CV" value={editedData.nome || ""}
                  onChange={e => setEditedData({ ...editedData, nome: e.target.value })}
                  className="mt-1"
                />
              </div>
              <div>
                <label className="text-sm font-medium text-foreground">Cognome</label>
                <Input
                  aria-label="cognome" placeholder="Non presente nel CV" value={editedData.cognome || ""}
                  onChange={e => setEditedData({ ...editedData, cognome: e.target.value })}
                  className="mt-1"
                />
              </div>
              <div>
                <label className="text-sm font-medium text-foreground flex items-center gap-2">
                  <Mail className="h-4 w-4" /> Email
                </label>
                <Input
                  type="email"
                  aria-label="email" placeholder="Non presente nel CV" value={editedData.email || ""}
                  onChange={e => setEditedData({ ...editedData, email: e.target.value })}
                  className="mt-1"
                />
              </div>
              <div>
                <label className="text-sm font-medium text-foreground flex items-center gap-2">
                  <Phone className="h-4 w-4" /> Telefono
                </label>
                <Input
                  aria-label="telefono" placeholder="Non presente nel CV" value={editedData.telefono || ""}
                  onChange={e => setEditedData({ ...editedData, telefono: e.target.value })}
                  className="mt-1"
                />
              </div>
              <div>
                <label className="text-sm font-medium text-foreground flex items-center gap-2">
                  <MapPin className="h-4 w-4" /> Città
                </label>
                <CityAutocomplete
                  value={editedData.citta}
                  onChange={(value) => setEditedData({ ...editedData, citta: value })}
                  placeholder="Cerca città (es. Lugano)..."
                  className="mt-1"
                />
              </div>
              <div>
                <label className="text-sm font-medium text-foreground">CAP</label>
                <Input
                  aria-label="cap" placeholder="Non presente nel CV" value={editedData.cap || ""}
                  onChange={e => setEditedData({ ...editedData, cap: e.target.value })}
                  className="mt-1"
                />
              </div>
            </CardContent>
          </Card>

          <Card><CardHeader><CardTitle>Altri dati personali</CardTitle></CardHeader><CardContent className="grid gap-4 md:grid-cols-3">
            {([['indirizzo', 'Indirizzo'], ['dataNascita', 'Data di nascita'], ['patente', 'Patente']] as const).map(([field, label]) => <label key={field}>{label}
              <Input aria-label={label} placeholder="Non presente nel CV" value={editedData[field] || ''} onChange={e => setEditedData({ ...editedData, [field]: e.target.value })} />
            </label>)}
          </CardContent></Card>

          {/* Profilo */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-lg flex items-center gap-2">
                <Star className="h-5 w-5 text-primary" />
                Profilo Professionale
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Textarea
                value={editedData.profilo}
                onChange={e => setEditedData({ ...editedData, profilo: e.target.value })}
                rows={3}
              />
            </CardContent>
          </Card>

          {/* Competenze */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-lg flex items-center gap-2">
                <Briefcase className="h-5 w-5 text-primary" />
                Competenze
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap gap-2">
                {(editedData.competenze || []).map((comp, index) => (
                  <Badge key={index} variant="secondary" className="flex items-center gap-1 py-1 px-3">
                    {comp}
                    <button onClick={() => handleRemoveCompetenza(index)}>
                      <X className="h-3 w-3 ml-1 hover:text-destructive" />
                    </button>
                  </Badge>
                ))}
              </div>
              <div className="flex gap-2">
                <Input
                  placeholder="Aggiungi competenza..."
                  value={newCompetenza}
                  onChange={e => setNewCompetenza(e.target.value)}
                  onKeyPress={e => e.key === 'Enter' && handleAddCompetenza()}
                />
                <Button variant="outline" size="icon" onClick={handleAddCompetenza}>
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Esperienze */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-lg flex items-center gap-2">
                <Briefcase className="h-5 w-5 text-primary" />
                Esperienze Lavorative
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {(editedData.esperienze || []).map((exp, index) => (
                <div key={exp.id || index} className="p-4 bg-accent/50 rounded-lg space-y-2">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="font-semibold text-foreground">{exp.ruolo}</p>
                      <p className="text-sm text-muted">{exp.azienda}</p>
                    </div>
                    <Badge variant="outline">
                      {exp.dataInizio} - {exp.dataFine}
                    </Badge>
                  </div>
                  <p className="text-sm text-muted whitespace-pre-wrap">{exp.descrizione}</p>
                </div>
              ))}
              {(!editedData.esperienze || editedData.esperienze.length === 0) && (
                <p className="text-sm text-muted-foreground italic">Nessuna esperienza inserita.</p>
              )}
            </CardContent>
          </Card>

          {/* Istruzione */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-lg flex items-center gap-2">
                <GraduationCap className="h-5 w-5 text-primary" />
                Istruzione
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {(editedData.istruzione || []).map((edu, index) => (
                <div key={edu.id || index} className="flex items-center justify-between p-3 bg-accent/50 rounded-lg">
                  <div>
                    <p className="font-medium text-foreground">{edu.titolo}</p>
                    <p className="text-sm text-muted">{edu.istituto}</p>
                    {edu.descrizione && <p className="text-sm whitespace-pre-wrap">{edu.descrizione}</p>}
                  </div>
                  <Badge variant="outline">{[edu.dataInizio, edu.dataFine].filter(Boolean).join(" – ") || edu.anno || "Date non presenti"}</Badge>
                </div>
              ))}
              {(!editedData.istruzione || editedData.istruzione.length === 0) && (
                <p className="text-sm text-muted-foreground italic">Nessun titolo di studio inserito.</p>
              )}
            </CardContent>
          </Card>

          {/* Lingue */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-lg flex items-center gap-2">
                <Languages className="h-5 w-5 text-primary" />
                Lingue
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-2">
                {(editedData.lingue || []).map((lang, index) => (
                  <Badge key={lang.id || index} variant="secondary">
                    {typeof lang === 'string' ? lang : `${lang.lingua || ''}${lang.livello ? `: ${lang.livello}` : ''}`}
                  </Badge>
                ))}
              </div>
              {(!editedData.lingue || editedData.lingue.length === 0) && (
                <p className="text-sm text-muted-foreground italic">Nessuna lingua specificata.</p>
              )}
            </CardContent>
          </Card>
          <Card><CardHeader><CardTitle>Certificazioni e altre informazioni</CardTitle></CardHeader><CardContent className="space-y-2">
            {(editedData.certificazioni || []).map((item, i) => <p key={`cert-${i}`}>{item}</p>)}
            {(editedData.altreInformazioni || []).map((item, i) => <p key={`other-${i}`}>{item}</p>)}
            {!editedData.certificazioni?.length && !editedData.altreInformazioni?.length && <p>Non presenti nel CV.</p>}
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="sintesi" className="space-y-4 mt-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-lg">Sintesi Breve</CardTitle>
              <p className="text-sm text-muted">3-5 righe per presentazione rapida</p>
            </CardHeader>
            <CardContent>
              <Textarea
                value={sintesiBreve}
                onChange={e => setSintesiBreve(e.target.value)}
                rows={3}
                className="mb-3"
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-lg">Sintesi Completa</CardTitle>
              <p className="text-sm text-muted">Bullet points dettagliati</p>
            </CardHeader>
            <CardContent>
              <Textarea
                value={sintesiCompleta}
                onChange={e => setSintesiCompleta(e.target.value)}
                rows={10}
                className="mb-3 font-mono text-sm"
              />
              <Button 
                variant="outline" 
                onClick={handleRegenerate}
                disabled={isGenerating}
              >
                <RefreshCw className={`h-4 w-4 mr-2 ${isGenerating ? 'animate-spin' : ''}`} />
                Rigenera Sintesi
              </Button>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Navigation */}
      <div className="flex justify-between pt-4">
        <Button variant="outline" onClick={() => setCurrentStep(0)}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Indietro
        </Button>
        <Button onClick={handleNext} disabled={isSaving}>
          {isSaving ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Salvataggio...
            </>
          ) : (
            <>
              <Save className="h-4 w-4 mr-2" />
              Salva e Trova Aziende
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
