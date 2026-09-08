import * as React from 'react';
import { useState, useRef, useEffect } from 'react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { MapPin } from 'lucide-react';

export interface CityData {
  name: string;
  region: string;
  country: string;
}

export interface LocationSelection {
  type: 'city' | 'region';
  displayName: string;
  searchQuery: string; // Cosa mandare all'AI
  cities?: string[]; // Se regione, lista città
}

// Funzione per ottenere tutte le città di una regione
export function getCitiesInRegion(region: string): string[] {
  return CITIES_DATA
    .filter(c => c.region.toLowerCase() === region.toLowerCase())
    .map(c => c.name);
}

// Funzione per costruire la query di ricerca
export function buildLocationQuery(selection: LocationSelection): string {
  if (selection.type === 'region' && selection.cities && selection.cities.length > 0) {
    return `Regione ${selection.displayName} (tutte le città: ${selection.cities.slice(0, 5).join(', ')}${selection.cities.length > 5 ? ' e altre...' : ''})`;
  }
  return selection.displayName;
}

// Lista città con regione/cantone
const CITIES_DATA: CityData[] = [
  // Svizzera - Canton Ticino
  { name: 'Lugano', region: 'Ticino', country: 'CH' },
  { name: 'Paradiso', region: 'Ticino', country: 'CH' },
  { name: 'Massagno', region: 'Ticino', country: 'CH' },
  { name: 'Viganello', region: 'Ticino', country: 'CH' },
  { name: 'Pregassona', region: 'Ticino', country: 'CH' },
  { name: 'Breganzona', region: 'Ticino', country: 'CH' },
  { name: 'Grancia', region: 'Ticino', country: 'CH' },
  { name: 'Manno', region: 'Ticino', country: 'CH' },
  { name: 'Bioggio', region: 'Ticino', country: 'CH' },
  { name: 'Lamone', region: 'Ticino', country: 'CH' },
  { name: 'Cadempino', region: 'Ticino', country: 'CH' },
  { name: 'Vezia', region: 'Ticino', country: 'CH' },
  { name: 'Savosa', region: 'Ticino', country: 'CH' },
  { name: 'Porza', region: 'Ticino', country: 'CH' },
  { name: 'Comano', region: 'Ticino', country: 'CH' },
  { name: 'Canobbio', region: 'Ticino', country: 'CH' },
  { name: 'Cadro', region: 'Ticino', country: 'CH' },
  { name: 'Sonvico', region: 'Ticino', country: 'CH' },
  { name: 'Muzzano', region: 'Ticino', country: 'CH' },
  { name: 'Sorengo', region: 'Ticino', country: 'CH' },
  { name: 'Pambio-Noranco', region: 'Ticino', country: 'CH' },
  { name: 'Pazzallo', region: 'Ticino', country: 'CH' },
  { name: 'Barbengo', region: 'Ticino', country: 'CH' },
  { name: 'Carabbia', region: 'Ticino', country: 'CH' },
  { name: 'Figino', region: 'Ticino', country: 'CH' },
  { name: 'Noranco', region: 'Ticino', country: 'CH' },
  { name: 'Agno', region: 'Ticino', country: 'CH' },
  { name: 'Magliaso', region: 'Ticino', country: 'CH' },
  { name: 'Caslano', region: 'Ticino', country: 'CH' },
  { name: 'Ponte Tresa', region: 'Ticino', country: 'CH' },
  { name: 'Melide', region: 'Ticino', country: 'CH' },
  { name: 'Bissone', region: 'Ticino', country: 'CH' },
  { name: 'Campione d\'Italia', region: 'Ticino', country: 'CH' },
  { name: 'Morcote', region: 'Ticino', country: 'CH' },
  { name: 'Capolago', region: 'Ticino', country: 'CH' },
  { name: 'Riva San Vitale', region: 'Ticino', country: 'CH' },
  { name: 'Bellinzona', region: 'Ticino', country: 'CH' },
  { name: 'Locarno', region: 'Ticino', country: 'CH' },
  { name: 'Mendrisio', region: 'Ticino', country: 'CH' },
  { name: 'Chiasso', region: 'Ticino', country: 'CH' },
  { name: 'Biasca', region: 'Ticino', country: 'CH' },
  { name: 'Giubiasco', region: 'Ticino', country: 'CH' },
  { name: 'Gordola', region: 'Ticino', country: 'CH' },
  { name: 'Ascona', region: 'Ticino', country: 'CH' },
  { name: 'Minusio', region: 'Ticino', country: 'CH' },
  { name: 'Muralto', region: 'Ticino', country: 'CH' },
  { name: 'Stabio', region: 'Ticino', country: 'CH' },
  { name: 'Vacallo', region: 'Ticino', country: 'CH' },
  { name: 'Morbio Inferiore', region: 'Ticino', country: 'CH' },
  { name: 'Balerna', region: 'Ticino', country: 'CH' },
  { name: 'Coldrerio', region: 'Ticino', country: 'CH' },
  { name: 'Novazzano', region: 'Ticino', country: 'CH' },
  { name: 'Ligornetto', region: 'Ticino', country: 'CH' },
  { name: 'Arbedo-Castione', region: 'Ticino', country: 'CH' },
  { name: 'Cadenazzo', region: 'Ticino', country: 'CH' },
  { name: 'Magadino', region: 'Ticino', country: 'CH' },
  { name: 'Tenero', region: 'Ticino', country: 'CH' },
  { name: 'Brissago', region: 'Ticino', country: 'CH' },
  { name: 'Losone', region: 'Ticino', country: 'CH' },
  { name: 'Orselina', region: 'Ticino', country: 'CH' },
  { name: 'Rivera', region: 'Ticino', country: 'CH' },
  { name: 'Taverne', region: 'Ticino', country: 'CH' },
  { name: 'Torricella-Taverne', region: 'Ticino', country: 'CH' },
  { name: 'Bedano', region: 'Ticino', country: 'CH' },
  { name: 'Gravesano', region: 'Ticino', country: 'CH' },
  { name: 'Mezzovico-Vira', region: 'Ticino', country: 'CH' },
  { name: 'Monteceneri', region: 'Ticino', country: 'CH' },
  
  // Svizzera - Altri cantoni
  { name: 'Zurigo', region: 'Zurigo', country: 'CH' },
  { name: 'Ginevra', region: 'Ginevra', country: 'CH' },
  { name: 'Basilea', region: 'Basilea', country: 'CH' },
  { name: 'Berna', region: 'Berna', country: 'CH' },
  { name: 'Losanna', region: 'Vaud', country: 'CH' },
  { name: 'Winterthur', region: 'Zurigo', country: 'CH' },
  { name: 'San Gallo', region: 'San Gallo', country: 'CH' },
  { name: 'Lucerna', region: 'Lucerna', country: 'CH' },
  { name: 'Friburgo', region: 'Friburgo', country: 'CH' },
  { name: 'Neuchâtel', region: 'Neuchâtel', country: 'CH' },
  { name: 'Thun', region: 'Berna', country: 'CH' },
  { name: 'Sion', region: 'Vallese', country: 'CH' },
  { name: 'Montreux', region: 'Vaud', country: 'CH' },
  { name: 'Vevey', region: 'Vaud', country: 'CH' },
  { name: 'Nyon', region: 'Vaud', country: 'CH' },
  { name: 'Morges', region: 'Vaud', country: 'CH' },
  { name: 'Yverdon-les-Bains', region: 'Vaud', country: 'CH' },
  
  // Italia - Lombardia
  { name: 'Milano', region: 'Lombardia', country: 'IT' },
  { name: 'Como', region: 'Lombardia', country: 'IT' },
  { name: 'Varese', region: 'Lombardia', country: 'IT' },
  { name: 'Lecco', region: 'Lombardia', country: 'IT' },
  { name: 'Bergamo', region: 'Lombardia', country: 'IT' },
  { name: 'Brescia', region: 'Lombardia', country: 'IT' },
  { name: 'Monza', region: 'Lombardia', country: 'IT' },
  { name: 'Pavia', region: 'Lombardia', country: 'IT' },
  { name: 'Cremona', region: 'Lombardia', country: 'IT' },
  { name: 'Mantova', region: 'Lombardia', country: 'IT' },
  { name: 'Lodi', region: 'Lombardia', country: 'IT' },
  { name: 'Sondrio', region: 'Lombardia', country: 'IT' },
  { name: 'Busto Arsizio', region: 'Lombardia', country: 'IT' },
  { name: 'Gallarate', region: 'Lombardia', country: 'IT' },
  { name: 'Saronno', region: 'Lombardia', country: 'IT' },
  { name: 'Legnano', region: 'Lombardia', country: 'IT' },
  { name: 'Rho', region: 'Lombardia', country: 'IT' },
  { name: 'Sesto San Giovanni', region: 'Lombardia', country: 'IT' },
  { name: 'Cinisello Balsamo', region: 'Lombardia', country: 'IT' },
  { name: 'Cologno Monzese', region: 'Lombardia', country: 'IT' },
  { name: 'Desio', region: 'Lombardia', country: 'IT' },
  { name: 'Cantù', region: 'Lombardia', country: 'IT' },
  { name: 'Erba', region: 'Lombardia', country: 'IT' },
  { name: 'Mariano Comense', region: 'Lombardia', country: 'IT' },
  { name: 'Seregno', region: 'Lombardia', country: 'IT' },
  { name: 'Lissone', region: 'Lombardia', country: 'IT' },
  { name: 'Meda', region: 'Lombardia', country: 'IT' },
  { name: 'Cesano Maderno', region: 'Lombardia', country: 'IT' },
  { name: 'Limbiate', region: 'Lombardia', country: 'IT' },
  { name: 'Paderno Dugnano', region: 'Lombardia', country: 'IT' },
  { name: 'Novate Milanese', region: 'Lombardia', country: 'IT' },
  { name: 'Cusano Milanino', region: 'Lombardia', country: 'IT' },
  { name: 'Cernusco sul Naviglio', region: 'Lombardia', country: 'IT' },
  { name: 'Pioltello', region: 'Lombardia', country: 'IT' },
  { name: 'Segrate', region: 'Lombardia', country: 'IT' },
  { name: 'Vimodrone', region: 'Lombardia', country: 'IT' },
  { name: "Cassano d'Adda", region: 'Lombardia', country: 'IT' },
  { name: 'Melzo', region: 'Lombardia', country: 'IT' },
  { name: 'Gorgonzola', region: 'Lombardia', country: 'IT' },
  { name: 'Vimercate', region: 'Lombardia', country: 'IT' },
  { name: 'Arcore', region: 'Lombardia', country: 'IT' },
  { name: 'Villasanta', region: 'Lombardia', country: 'IT' },
  { name: 'Biassono', region: 'Lombardia', country: 'IT' },
  { name: 'Vedano al Lambro', region: 'Lombardia', country: 'IT' },
  { name: 'Macherio', region: 'Lombardia', country: 'IT' },
  { name: 'Sovico', region: 'Lombardia', country: 'IT' },
  
  // Italia - Piemonte
  { name: 'Torino', region: 'Piemonte', country: 'IT' },
  { name: 'Novara', region: 'Piemonte', country: 'IT' },
  { name: 'Alessandria', region: 'Piemonte', country: 'IT' },
  { name: 'Asti', region: 'Piemonte', country: 'IT' },
  { name: 'Cuneo', region: 'Piemonte', country: 'IT' },
  { name: 'Vercelli', region: 'Piemonte', country: 'IT' },
  { name: 'Biella', region: 'Piemonte', country: 'IT' },
  { name: 'Verbania', region: 'Piemonte', country: 'IT' },
  { name: 'Domodossola', region: 'Piemonte', country: 'IT' },
  { name: 'Arona', region: 'Piemonte', country: 'IT' },
  { name: 'Borgomanero', region: 'Piemonte', country: 'IT' },
  { name: 'Omegna', region: 'Piemonte', country: 'IT' },
  { name: 'Stresa', region: 'Piemonte', country: 'IT' },
  { name: 'Baveno', region: 'Piemonte', country: 'IT' },
  { name: 'Pallanza', region: 'Piemonte', country: 'IT' },
  { name: 'Intra', region: 'Piemonte', country: 'IT' },
  { name: 'Gravellona Toce', region: 'Piemonte', country: 'IT' },
  
  // Italia - Valle d'Aosta
  { name: 'Aosta', region: "Valle d'Aosta", country: 'IT' },
  { name: 'Courmayeur', region: "Valle d'Aosta", country: 'IT' },
  { name: 'Saint-Vincent', region: "Valle d'Aosta", country: 'IT' },
  { name: 'Châtillon', region: "Valle d'Aosta", country: 'IT' },
  
  // Italia - Veneto
  { name: 'Venezia', region: 'Veneto', country: 'IT' },
  { name: 'Verona', region: 'Veneto', country: 'IT' },
  { name: 'Padova', region: 'Veneto', country: 'IT' },
  { name: 'Vicenza', region: 'Veneto', country: 'IT' },
  { name: 'Treviso', region: 'Veneto', country: 'IT' },
  { name: 'Rovigo', region: 'Veneto', country: 'IT' },
  { name: 'Belluno', region: 'Veneto', country: 'IT' },
  
  // Italia - Emilia-Romagna
  { name: 'Bologna', region: 'Emilia-Romagna', country: 'IT' },
  { name: 'Parma', region: 'Emilia-Romagna', country: 'IT' },
  { name: 'Modena', region: 'Emilia-Romagna', country: 'IT' },
  { name: 'Reggio Emilia', region: 'Emilia-Romagna', country: 'IT' },
  { name: 'Ravenna', region: 'Emilia-Romagna', country: 'IT' },
  { name: 'Rimini', region: 'Emilia-Romagna', country: 'IT' },
  { name: 'Ferrara', region: 'Emilia-Romagna', country: 'IT' },
  { name: 'Forlì', region: 'Emilia-Romagna', country: 'IT' },
  { name: 'Cesena', region: 'Emilia-Romagna', country: 'IT' },
  { name: 'Piacenza', region: 'Emilia-Romagna', country: 'IT' },
  
  // Italia - Toscana
  { name: 'Firenze', region: 'Toscana', country: 'IT' },
  { name: 'Pisa', region: 'Toscana', country: 'IT' },
  { name: 'Livorno', region: 'Toscana', country: 'IT' },
  { name: 'Siena', region: 'Toscana', country: 'IT' },
  { name: 'Lucca', region: 'Toscana', country: 'IT' },
  { name: 'Arezzo', region: 'Toscana', country: 'IT' },
  { name: 'Prato', region: 'Toscana', country: 'IT' },
  { name: 'Pistoia', region: 'Toscana', country: 'IT' },
  { name: 'Grosseto', region: 'Toscana', country: 'IT' },
  { name: 'Massa', region: 'Toscana', country: 'IT' },
  { name: 'Carrara', region: 'Toscana', country: 'IT' },
  
  // Italia - Lazio
  { name: 'Roma', region: 'Lazio', country: 'IT' },
  { name: 'Latina', region: 'Lazio', country: 'IT' },
  { name: 'Frosinone', region: 'Lazio', country: 'IT' },
  { name: 'Viterbo', region: 'Lazio', country: 'IT' },
  { name: 'Rieti', region: 'Lazio', country: 'IT' },
  
  // Italia - Campania
  { name: 'Napoli', region: 'Campania', country: 'IT' },
  { name: 'Salerno', region: 'Campania', country: 'IT' },
  { name: 'Caserta', region: 'Campania', country: 'IT' },
  { name: 'Avellino', region: 'Campania', country: 'IT' },
  { name: 'Benevento', region: 'Campania', country: 'IT' },
  
  // Italia - Puglia
  { name: 'Bari', region: 'Puglia', country: 'IT' },
  { name: 'Lecce', region: 'Puglia', country: 'IT' },
  { name: 'Taranto', region: 'Puglia', country: 'IT' },
  { name: 'Foggia', region: 'Puglia', country: 'IT' },
  { name: 'Brindisi', region: 'Puglia', country: 'IT' },
  { name: 'Barletta', region: 'Puglia', country: 'IT' },
  
  // Italia - Sicilia
  { name: 'Palermo', region: 'Sicilia', country: 'IT' },
  { name: 'Catania', region: 'Sicilia', country: 'IT' },
  { name: 'Messina', region: 'Sicilia', country: 'IT' },
  { name: 'Siracusa', region: 'Sicilia', country: 'IT' },
  { name: 'Ragusa', region: 'Sicilia', country: 'IT' },
  { name: 'Trapani', region: 'Sicilia', country: 'IT' },
  
  // Italia - Sardegna
  { name: 'Cagliari', region: 'Sardegna', country: 'IT' },
  { name: 'Sassari', region: 'Sardegna', country: 'IT' },
  { name: 'Nuoro', region: 'Sardegna', country: 'IT' },
  { name: 'Oristano', region: 'Sardegna', country: 'IT' },
  { name: 'Olbia', region: 'Sardegna', country: 'IT' },
  { name: 'Alghero', region: 'Sardegna', country: 'IT' },
  
  // Italia - Liguria
  { name: 'Genova', region: 'Liguria', country: 'IT' },
  { name: 'La Spezia', region: 'Liguria', country: 'IT' },
  { name: 'Savona', region: 'Liguria', country: 'IT' },
  { name: 'Imperia', region: 'Liguria', country: 'IT' },
  
  // Italia - Friuli Venezia Giulia
  { name: 'Trieste', region: 'Friuli Venezia Giulia', country: 'IT' },
  { name: 'Udine', region: 'Friuli Venezia Giulia', country: 'IT' },
  { name: 'Pordenone', region: 'Friuli Venezia Giulia', country: 'IT' },
  { name: 'Gorizia', region: 'Friuli Venezia Giulia', country: 'IT' },
  
  // Italia - Trentino-Alto Adige
  { name: 'Trento', region: 'Trentino-Alto Adige', country: 'IT' },
  { name: 'Bolzano', region: 'Trentino-Alto Adige', country: 'IT' },
  { name: 'Merano', region: 'Trentino-Alto Adige', country: 'IT' },
  { name: 'Rovereto', region: 'Trentino-Alto Adige', country: 'IT' },
  
  // Italia - Marche
  { name: 'Ancona', region: 'Marche', country: 'IT' },
  { name: 'Pesaro', region: 'Marche', country: 'IT' },
  { name: 'Fano', region: 'Marche', country: 'IT' },
  { name: 'Urbino', region: 'Marche', country: 'IT' },
  
  // Italia - Umbria
  { name: 'Perugia', region: 'Umbria', country: 'IT' },
  { name: 'Terni', region: 'Umbria', country: 'IT' },
  { name: 'Foligno', region: 'Umbria', country: 'IT' },
  { name: 'Spoleto', region: 'Umbria', country: 'IT' },
  
  // Italia - Abruzzo
  { name: "L'Aquila", region: 'Abruzzo', country: 'IT' },
  { name: 'Pescara', region: 'Abruzzo', country: 'IT' },
  { name: 'Chieti', region: 'Abruzzo', country: 'IT' },
  { name: 'Teramo', region: 'Abruzzo', country: 'IT' },
  
  // Italia - Molise
  { name: 'Campobasso', region: 'Molise', country: 'IT' },
  { name: 'Isernia', region: 'Molise', country: 'IT' },
  
  // Italia - Basilicata
  { name: 'Potenza', region: 'Basilicata', country: 'IT' },
  { name: 'Matera', region: 'Basilicata', country: 'IT' },
  
  // Italia - Calabria
  { name: 'Catanzaro', region: 'Calabria', country: 'IT' },
  { name: 'Reggio Calabria', region: 'Calabria', country: 'IT' },
  { name: 'Cosenza', region: 'Calabria', country: 'IT' },
  { name: 'Crotone', region: 'Calabria', country: 'IT' },
];

// Ottieni lista regioni uniche
const REGIONS = [...new Set(CITIES_DATA.map(c => c.region))];

interface AutocompleteItem {
  type: 'city' | 'region';
  city?: CityData;
  region?: string;
  country?: string;
  citiesCount?: number;
}

interface CityAutocompleteProps {
  value: string;
  onChange: (value: string) => void;
  onLocationSelect?: (selection: LocationSelection) => void;
  placeholder?: string;
  className?: string;
}

export function CityAutocomplete({ value, onChange, onLocationSelect, placeholder = 'Cerca città o regione...', className }: CityAutocompleteProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [filteredItems, setFilteredItems] = useState<AutocompleteItem[]>([]);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const filterItems = (searchTerm: string): AutocompleteItem[] => {
    const term = searchTerm.toLowerCase();
    const items: AutocompleteItem[] = [];
    
    // Prima cerca regioni che matchano
    const matchingRegions = REGIONS.filter(region => 
      region.toLowerCase().startsWith(term) || region.toLowerCase().includes(term)
    );
    
    matchingRegions.forEach(region => {
      const citiesInRegion = CITIES_DATA.filter(c => c.region === region);
      const country = citiesInRegion[0]?.country || 'IT';
      items.push({
        type: 'region',
        region,
        country,
        citiesCount: citiesInRegion.length
      });
    });
    
    // Poi aggiungi città che matchano
    const startsWithFilter = CITIES_DATA.filter(city =>
      city.name.toLowerCase().startsWith(term)
    );
    const containsFilter = CITIES_DATA.filter(city =>
      city.name.toLowerCase().includes(term) &&
      !city.name.toLowerCase().startsWith(term)
    );
    
    [...startsWithFilter, ...containsFilter].forEach(city => {
      items.push({ type: 'city', city });
    });
    
    return items.slice(0, 12);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const inputValue = e.target.value;
    onChange(inputValue);

    if (inputValue.length >= 1) {
      const filtered = filterItems(inputValue);
      setFilteredItems(filtered);
      setIsOpen(filtered.length > 0);
      setHighlightedIndex(-1);
    } else {
      setFilteredItems([]);
      setIsOpen(false);
    }
  };

  const handleSelect = (item: AutocompleteItem) => {
    if (item.type === 'region' && item.region) {
      const cities = getCitiesInRegion(item.region);
      const displayName = `${item.region} (tutta la regione)`;
      onChange(displayName);
      
      if (onLocationSelect) {
        onLocationSelect({
          type: 'region',
          displayName: item.region,
          searchQuery: `Tutta la regione/cantone ${item.region}`,
          cities
        });
      }
    } else if (item.type === 'city' && item.city) {
      onChange(item.city.name);
      
      if (onLocationSelect) {
        onLocationSelect({
          type: 'city',
          displayName: item.city.name,
          searchQuery: item.city.name
        });
      }
    }
    
    setIsOpen(false);
    setFilteredItems([]);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!isOpen) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightedIndex(prev => 
        prev < filteredItems.length - 1 ? prev + 1 : prev
      );
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightedIndex(prev => prev > 0 ? prev - 1 : prev);
    } else if (e.key === 'Enter' && highlightedIndex >= 0) {
      e.preventDefault();
      handleSelect(filteredItems[highlightedIndex]);
    } else if (e.key === 'Escape') {
      setIsOpen(false);
    }
  };

  return (
    <div ref={wrapperRef} className={cn('relative', className)}>
      <Input
        ref={inputRef}
        value={value}
        onChange={handleInputChange}
        onKeyDown={handleKeyDown}
        onFocus={() => {
          if (value.length >= 1) {
            const filtered = filterItems(value);
            if (filtered.length > 0) {
              setFilteredItems(filtered);
              setIsOpen(true);
            }
          }
        }}
        placeholder={placeholder}
        autoComplete="off"
      />
      
      {isOpen && filteredItems.length > 0 && (
        <div className="absolute z-50 w-full mt-1 bg-popover border border-border rounded-md shadow-lg max-h-60 overflow-auto">
          {filteredItems.map((item, index) => (
            <div
              key={item.type === 'region' ? `region-${item.region}` : `city-${item.city?.name}-${item.city?.region}`}
              onClick={() => handleSelect(item)}
              className={cn(
                'flex items-center gap-2 px-3 py-2 cursor-pointer text-popover-foreground',
                'hover:bg-accent hover:text-accent-foreground',
                index === highlightedIndex && 'bg-accent text-accent-foreground'
              )}
            >
              <MapPin className="h-4 w-4 text-muted-foreground flex-shrink-0" />
              {item.type === 'region' ? (
                <div className="flex flex-col">
                  <span className="font-medium">{item.region} <span className="text-primary">(tutta la regione)</span></span>
                  <span className="text-xs text-muted-foreground">
                    {item.citiesCount} città • {item.country === 'CH' ? 'Svizzera' : 'Italia'}
                  </span>
                </div>
              ) : (
                <div className="flex flex-col">
                  <span className="font-medium">{item.city?.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {item.city?.region}, {item.city?.country === 'CH' ? 'Svizzera' : 'Italia'}
                  </span>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
