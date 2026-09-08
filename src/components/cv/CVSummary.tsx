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

function getPermessoGText(cvData: any): string {
  if (cvData?.statoPermesso && cvData.statoPermesso.trim()) {
    return cvData.statoPermesso;
  }
  if (cvData?.permessoG === 'In possesso' || cvData?.permessoG === true) {
    return 'In possesso di Permesso G (Frontalieri Svizzera)';
  }
  return 'Idoneo al rilascio immediato di Permesso G (Cittadino UE / Frontalieri Svizzera)';
}

function generateSintesiBreve(cvData: any): string {
  const anniEsperienza = cvData.esperienze?.length > 0 ? 
    `con ${cvData.esperienze.length + 3} anni di esperienza` : '';
  const permesso = getPermessoGText(cvData);
  
  return `[PRIORITÀ SVIZZERA - ${permesso.toUpperCase()}] • Professionista ${anniEsperienza} nel settore ${cvData.esperienze?.[0]?.azienda?.includes('Meccaniche') ? 'metalmeccanico' : 'industriale'}, con competenze chiave in ${cvData.competenze?.slice(0, 3).join(', ')}. Piena disponibilità immediata per assunzione in Canton Ticino, Grigioni e Svizzera.`;
}

function generateSintesiCompleta(cvData: any): string {
  const permesso = getPermessoGText(cvData);
  return `• **Permesso di Lavoro Svizzera (Prioritario)**: ${permesso} – Nessun ostacolo burocratico all'assunzione da parte di aziende svizzere (Canton Ticino / Grigioni / Svizzera interna).

• **Profilo professionale**: ${cvData.profilo || 'Professionista qualificato con esperienza consolidata'}

• **Esperienza lavorativa**: ${cvData.esperienze?.length || 0} ruoli ricoperti, ultimo incarico come ${cvData.esperienze?.[0]?.ruolo || 'Specialista'} presso ${cvData.esperienze?.[0]?.azienda || 'Azienda'}

• **Competenze chiave**: ${(cvData.competenze || []).join(', ')}

• **Formazione**: ${cvData.istruzione?.[0]?.titolo || 'Diploma / Laurea'} - ${cvData.istruzione?.[0]?.istituto || 'Istituto'}

• **Lingue**: ${(cvData.lingue || []).map((l: any) => typeof l === 'string' ? l : `${l.lingua || ''}${l.livello ? ` (${l.livello})` : ''}`).filter(Boolean).join(', ') || 'Italiano (Madrelingua)'}

• **Disponibilità & Mobilità**: Immediata, residente a ${cvData.citta || 'zona frontaliera'} con disponibilità agli spostamenti verso la Svizzera`;
}

export function CVSummary() {
  const { cvData, setCvData, setSintesiBreve, setSintesiCompleta, sintesiBreve, sintesiCompleta, setCurrentStep } = useCVContext();
  const { saveProfile, isSaving } = useUserProfile();
  const { toast } = useToast();
  const [editedData, setEditedData] = useState(cvData);
  const [newCompetenza, setNewCompetenza] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);

  useEffect(() => {
    if (cvData && !sintesiBreve) {
      setSintesiBreve(generateSintesiBreve(cvData));
      setSintesiCompleta(generateSintesiCompleta(cvData));
    }
  }, [cvData, sintesiBreve, setSintesiBreve, setSintesiCompleta]);

  useEffect(() => {
    setEditedData(cvData);
  }, [cvData]);

  if (!cvData || !editedData) {
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
    await new Promise(resolve => setTimeout(resolve, 1000));
    setSintesiBreve(generateSintesiBreve(editedData));
    setSintesiCompleta(generateSintesiCompleta(editedData));
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
    
    setCvData(editedData);
    
    // Save to database
    const result = await saveProfile(editedData, sintesiBreve, sintesiCompleta);
    
    if (result.success) {
      toast({
        title: 'Profilo salvato',
        description: 'I dati del CV sono stati salvati nel tuo account.',
      });
    }
    
    setCurrentStep(2);
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

      <Tabs defaultValue="dati" className="w-full">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="dati">Dati Personali</TabsTrigger>
          <TabsTrigger value="sintesi">Sintesi Generate</TabsTrigger>
        </TabsList>

        <TabsContent value="dati" className="space-y-4 mt-4">
          {/* Card Prioritaria Permesso G Svizzera */}
          <Card className="border-emerald-500/40 bg-emerald-50/50 dark:bg-emerald-950/20 shadow-sm">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <CardTitle className="text-base md:text-lg flex items-center gap-2 text-emerald-800 dark:text-emerald-300">
                  <span className="text-xl">🇨🇭</span>
                  <span>Permesso G (Frontalieri Svizzera)</span>
                  <Badge variant="default" className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold">
                    Priorità 1
                  </Badge>
                </CardTitle>
                <span className="text-xs font-medium text-emerald-700 dark:text-emerald-400 bg-emerald-100 dark:bg-emerald-900/50 px-2.5 py-0.5 rounded-full">
                  Inserito in cima alla sintesi
                </span>
              </div>
            </CardHeader>
            <CardContent className="space-y-3 pt-1">
              <p className="text-xs text-muted-foreground">
                Questa informazione è collocata in prima posizione sia nella sintesi breve sia in quella completa per rassicurare immediatamente le aziende svizzere sulla facilità di assunzione.
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-foreground">Stato Permesso G</label>
                  <select
                    value={editedData.permessoG === 'In possesso' || editedData.permessoG === true ? 'In possesso' : 'Idoneo'}
                    onChange={(e) => {
                      const val = e.target.value;
                      const statoStr = val === 'In possesso' 
                        ? 'In possesso di Permesso G (Frontalieri Svizzera)' 
                        : 'Idoneo al rilascio immediato di Permesso G (Cittadino UE / Frontalieri Svizzera)';
                      const updated = {
                        ...editedData,
                        permessoG: val,
                        statoPermesso: statoStr
                      };
                      setEditedData(updated);
                      setSintesiBreve(generateSintesiBreve(updated));
                      setSintesiCompleta(generateSintesiCompleta(updated));
                    }}
                    className="mt-1 w-full flex h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  >
                    <option value="In possesso">In possesso di Permesso G (Frontalieri Svizzera)</option>
                    <option value="Idoneo">Idoneo al rilascio immediato (Cittadino UE / Frontaliere)</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs font-medium text-foreground">Dettaglio / Dicitura Sintesi</label>
                  <Input
                    value={editedData.statoPermesso || getPermessoGText(editedData)}
                    onChange={(e) => {
                      const updated = { ...editedData, statoPermesso: e.target.value };
                      setEditedData(updated);
                      setSintesiBreve(generateSintesiBreve(updated));
                      setSintesiCompleta(generateSintesiCompleta(updated));
                    }}
                    className="mt-1"
                    placeholder="Es. In possesso di Permesso G valido"
                  />
                </div>
              </div>
            </CardContent>
          </Card>

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
                  value={editedData.nome}
                  onChange={e => setEditedData({ ...editedData, nome: e.target.value })}
                  className="mt-1"
                />
              </div>
              <div>
                <label className="text-sm font-medium text-foreground">Cognome</label>
                <Input
                  value={editedData.cognome}
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
                  value={editedData.email}
                  onChange={e => setEditedData({ ...editedData, email: e.target.value })}
                  className="mt-1"
                />
              </div>
              <div>
                <label className="text-sm font-medium text-foreground flex items-center gap-2">
                  <Phone className="h-4 w-4" /> Telefono
                </label>
                <Input
                  value={editedData.telefono}
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
                  value={editedData.cap}
                  onChange={e => setEditedData({ ...editedData, cap: e.target.value })}
                  className="mt-1"
                />
              </div>
            </CardContent>
          </Card>

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
                  <p className="text-sm text-muted">{exp.descrizione}</p>
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
                  </div>
                  <Badge variant="outline">{edu.anno}</Badge>
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
        </TabsContent>

        <TabsContent value="sintesi" className="space-y-4 mt-4">
          {/* Badge Informativo Priorità Permesso G */}
          <div className="flex items-center gap-2 p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-lg text-emerald-800 dark:text-emerald-300 text-xs md:text-sm font-medium">
            <span className="text-base">🇨🇭</span>
            <span>
              <strong>Permesso G Prioritario:</strong> L&apos;idoneità o possesso del Permesso G (Frontalieri Svizzera) è inserita come prima informazione per attirare le aziende in Svizzera (Ticino, Grigioni).
            </span>
          </div>

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
