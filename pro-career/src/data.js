// ── Static world data: leagues, clubs, national teams, names, formations ─────
// 100% original / fictional-but-realistic content. No real-world licensed
// names, logos or assets are used anywhere in this game.

// ── national leagues ─────────────────────────────────────────────────────────
// 12 leagues × 16 clubs = 192 clubs. Cities are real places; the club names
// combine those cities with invented suffixes so nothing is a real trademark.
export const LEAGUES = [
  { id: 'ENG', name: 'Albion Premier League', short: 'APL', country: 'England', flag: '🏴󠁧󠁢󠁥󠁮󠁧󠁿', tier: 5, region: 'eu-w',
    cities: ['London', 'Manchester', 'Liverpool', 'Birmingham', 'Leeds', 'Newcastle', 'Sheffield', 'Bristol', 'Nottingham', 'Leicester', 'Southampton', 'Brighton', 'Wolverhampton', 'Everton Park', 'Sunderland', 'Norwich'] },
  { id: 'ESP', name: 'Liga Corona', short: 'LCO', country: 'Spain', flag: '🇪🇸', tier: 5, region: 'eu-w',
    cities: ['Madrid', 'Barcelona', 'Sevilla', 'Valencia', 'Bilbao', 'Málaga', 'Zaragoza', 'Vigo', 'Gijón', 'Granada', 'Valladolid', 'Palma', 'Alicante', 'Córdoba', 'San Sebastián', 'Murcia'] },
  { id: 'ITA', name: 'Serie Prima', short: 'SPR', country: 'Italy', flag: '🇮🇹', tier: 5, region: 'eu-w',
    cities: ['Milano', 'Roma', 'Torino', 'Napoli', 'Firenze', 'Bologna', 'Genova', 'Palermo', 'Bari', 'Verona', 'Cagliari', 'Udine', 'Parma', 'Bergamo', 'Lecce', 'Siena'] },
  { id: 'GER', name: 'Bundesklasse', short: 'BKL', country: 'Germany', flag: '🇩🇪', tier: 5, region: 'eu-w',
    cities: ['Berlin', 'München', 'Hamburg', 'Köln', 'Stuttgart', 'Dortmund', 'Leipzig', 'Bremen', 'Hannover', 'Nürnberg', 'Dresden', 'Bochum', 'Kiel', 'Augsburg', 'Freiburg', 'Mainz'] },
  { id: 'FRA', name: 'Championnat Élite', short: 'CEL', country: 'France', flag: '🇫🇷', tier: 5, region: 'eu-w',
    cities: ['Paris', 'Marseille', 'Lyon', 'Lille', 'Toulouse', 'Bordeaux', 'Nantes', 'Nice', 'Strasbourg', 'Rennes', 'Montpellier', 'Lens', 'Saint-Étienne', 'Reims', 'Metz', 'Brest'] },
  { id: 'POR', name: 'Liga Atlântica', short: 'LAT', country: 'Portugal', flag: '🇵🇹', tier: 4, region: 'eu-w',
    cities: ['Lisboa', 'Porto', 'Braga', 'Coimbra', 'Faro', 'Aveiro', 'Setúbal', 'Funchal', 'Guimarães', 'Leiria', 'Évora', 'Viseu', 'Beira', 'Portimão', 'Chaves', 'Açores'] },
  { id: 'NED', name: 'Eredivisie Oranje', short: 'EDO', country: 'Netherlands', flag: '🇳🇱', tier: 4, region: 'eu-w',
    cities: ['Amsterdam', 'Rotterdam', 'Eindhoven', 'Utrecht', 'Groningen', 'Arnhem', 'Breda', 'Nijmegen', 'Haarlem', 'Leeuwarden', 'Enschede', 'Delft', 'Alkmaar', 'Tilburg', 'Deventer', 'Zwolle'] },
  { id: 'TUR', name: 'Süper Anadolu', short: 'SAN', country: 'Türkiye', flag: '🇹🇷', tier: 4, region: 'mideast',
    cities: ['İstanbul', 'Ankara', 'İzmir', 'Bursa', 'Antalya', 'Adana', 'Trabzon', 'Konya', 'Gaziantep', 'Kayseri', 'Samsun', 'Denizli', 'Eskişehir', 'Malatya', 'Rize', 'Alanya'] },
  { id: 'MAR', name: 'Botola Atlas', short: 'BAT', country: 'Morocco', flag: '🇲🇦', tier: 3, region: 'afr',
    cities: ['Casablanca', 'Rabat', 'Fès', 'Marrakech', 'Tanger', 'Agadir', 'Oujda', 'Kénitra', 'Salé', 'Meknès', 'Tétouan', 'Safi', 'El Jadida', 'Beni Mellal', 'Nador', 'Laâyoune'] },
  { id: 'KSA', name: 'Saudi Golden League', short: 'SGL', country: 'Saudi Arabia', flag: '🇸🇦', tier: 3, region: 'mideast',
    cities: ['Riyadh', 'Jeddah', 'Mecca', 'Medina', 'Dammam', 'Taif', 'Tabuk', 'Abha', 'Buraidah', 'Khobar', 'Hail', 'Najran', 'Jubail', 'Yanbu', 'Al-Ahsa', 'Arar'] },
  { id: 'BRA', name: 'Brasileirão Dourado', short: 'BRD', country: 'Brazil', flag: '🇧🇷', tier: 4, region: 'latam',
    cities: ['Rio de Janeiro', 'São Paulo', 'Belo Horizonte', 'Porto Alegre', 'Salvador', 'Curitiba', 'Recife', 'Fortaleza', 'Goiânia', 'Manaus', 'Belém', 'Santos', 'Campinas', 'Natal', 'Cuiabá', 'Florianópolis'] },
  { id: 'USA', name: 'American Soccer League', short: 'ASL', country: 'USA', flag: '🇺🇸', tier: 3, region: 'northam',
    cities: ['New York', 'Los Angeles', 'Chicago', 'Seattle', 'Miami', 'Dallas', 'Atlanta', 'Portland', 'Denver', 'Houston', 'Boston', 'Nashville', 'Austin', 'Philadelphia', 'Phoenix', 'Minneapolis'] },
];

export const CLUB_SUFFIX = [
  'FC', 'United', 'City', 'Athletic', 'Sporting', 'Rovers', 'Town', 'Wanderers',
  'Stars', 'Kings', 'Eagles', 'Lions', 'Falcons', 'Olimpico', 'Atlético', 'Real',
  'Union', 'Wolves', 'Sharks', 'Titans',
];

// club colours (primary, secondary) — assigned per club from a palette
export const KIT_PALETTE = [
  ['#e0362f', '#ffffff'], ['#1e4fd8', '#ffffff'], ['#12a150', '#ffffff'], ['#111827', '#f5f5f5'],
  ['#f5c518', '#111827'], ['#7c3aed', '#ffffff'], ['#0ea5e9', '#082f49'], ['#e11d48', '#ffffff'],
  ['#f97316', '#111827'], ['#0f766e', '#ffffff'], ['#64748b', '#ffffff'], ['#a16207', '#ffffff'],
  ['#be123c', '#000000'], ['#2563eb', '#facc15'], ['#16a34a', '#fde68a'], ['#fafafa', '#111827'],
  ['#4c1d95', '#e9d5ff'], ['#831843', '#ffffff'], ['#065f46', '#fbbf24'], ['#1f2937', '#f97316'],
];

// ── national teams ───────────────────────────────────────────────────────────
export const NATIONS = [
  ['Morocco', 'MAR', '🇲🇦', 'CAF', 84], ['Senegal', 'SEN', '🇸🇳', 'CAF', 82], ['Egypt', 'EGY', '🇪🇬', 'CAF', 79],
  ['Nigeria', 'NGA', '🇳🇬', 'CAF', 81], ['Algeria', 'ALG', '🇩🇿', 'CAF', 79], ['Ivory Coast', 'CIV', '🇨🇮', 'CAF', 80],
  ['Tunisia', 'TUN', '🇹🇳', 'CAF', 77], ['Cameroon', 'CMR', '🇨🇲', 'CAF', 79], ['Ghana', 'GHA', '🇬🇭', 'CAF', 78],
  ['Mali', 'MLI', '🇲🇱', 'CAF', 76], ['South Africa', 'RSA', '🇿🇦', 'CAF', 75], ['Burkina Faso', 'BFA', '🇧🇫', 'CAF', 74],
  ['France', 'FRA', '🇫🇷', 'UEFA', 89], ['Spain', 'ESP', '🇪🇸', 'UEFA', 89], ['England', 'ENG', '🏴󠁧󠁢󠁥󠁮󠁧󠁿', 'UEFA', 88],
  ['Portugal', 'POR', '🇵🇹', 'UEFA', 88], ['Germany', 'GER', '🇩🇪', 'UEFA', 87], ['Italy', 'ITA', '🇮🇹', 'UEFA', 86],
  ['Netherlands', 'NED', '🇳🇱', 'UEFA', 86], ['Belgium', 'BEL', '🇧🇪', 'UEFA', 84], ['Croatia', 'CRO', '🇭🇷', 'UEFA', 84],
  ['Türkiye', 'TUR', '🇹🇷', 'UEFA', 80], ['Denmark', 'DEN', '🇩🇰', 'UEFA', 82], ['Switzerland', 'SUI', '🇨🇭', 'UEFA', 82],
  ['Brazil', 'BRA', '🇧🇷', 'CONMEBOL', 88], ['Argentina', 'ARG', '🇦🇷', 'CONMEBOL', 90], ['Uruguay', 'URU', '🇺🇾', 'CONMEBOL', 84],
  ['Colombia', 'COL', '🇨🇴', 'CONMEBOL', 84], ['Ecuador', 'ECU', '🇪🇨', 'CONMEBOL', 81], ['Chile', 'CHI', '🇨🇱', 'CONMEBOL', 79],
  ['Japan', 'JPN', '🇯🇵', 'AFC', 82], ['Korea Republic', 'KOR', '🇰🇷', 'AFC', 80], ['Saudi Arabia', 'KSA', '🇸🇦', 'AFC', 77],
  ['Australia', 'AUS', '🇦🇺', 'AFC', 78], ['Iran', 'IRN', '🇮🇷', 'AFC', 78], ['Qatar', 'QAT', '🇶🇦', 'AFC', 75],
  ['USA', 'USA', '🇺🇸', 'CONCACAF', 79], ['Mexico', 'MEX', '🇲🇽', 'CONCACAF', 81], ['Canada', 'CAN', '🇨🇦', 'CONCACAF', 78],
  ['Costa Rica', 'CRC', '🇨🇷', 'CONCACAF', 75], ['Jamaica', 'JAM', '🇯🇲', 'CONCACAF', 74],
];

// ── player names ─────────────────────────────────────────────────────────────
export const FIRST_NAMES = {
  'eu-w': ['Luca', 'Marco', 'Thomas', 'Julian', 'Hugo', 'Théo', 'Enzo', 'Mateo', 'Diego', 'Pablo', 'Sergio', 'Iván', 'Noah', 'Liam', 'Ethan', 'Ruben', 'João', 'Tiago', 'Bram', 'Sven', 'Jasper', 'Niels', 'Oliver', 'Harry', 'Jack', 'Callum', 'Finn', 'Nico', 'Andrés', 'Alvaro', 'Gianni', 'Dario', 'Fabio', 'Yannick', 'Florian', 'Kilian', 'Mathis', 'Alexis', 'Sandro', 'Mika'],
  'eu-e': ['Andrei', 'Marek', 'Tomasz', 'Luka', 'Matej', 'Kacper', 'Dimitri', 'Nikola', 'Stefan', 'Bogdan', 'Viktor', 'Pavel', 'Ivan', 'Sasha', 'Rafal', 'Milos', 'Kris', 'Emil', 'Artur', 'Denis'],
  afr: ['Youssef', 'Amine', 'Anas', 'Othmane', 'Karim', 'Zakaria', 'Bilal', 'Ilyas', 'Reda', 'Mehdi', 'Sadio', 'Cheikh', 'Kofi', 'Kwame', 'Emeka', 'Chidi', 'Sekou', 'Ibrahima', 'Moussa', 'Abdou', 'Tarek', 'Rachid', 'Sami', 'Hakim', 'Selim', 'Yassine', 'Omar', 'Nabil', 'Juma', 'Tendai', 'Ayoub', 'Adam'],
  latam: ['Matías', 'Julián', 'Facundo', 'Lautaro', 'Rodrigo', 'Thiago', 'Gabriel', 'Rafael', 'Lucas', 'Vinícius', 'Éverton', 'Bruno', 'Caio', 'Diego', 'Juan', 'Sebastián', 'Nicolás', 'Emiliano', 'Joaquín', 'Tomás'],
  mideast: ['Mohammed', 'Ahmed', 'Ali', 'Hassan', 'Hussein', 'Faisal', 'Sultan', 'Tariq', 'Zayd', 'Khalid', 'Yusuf', 'Ibrahim', 'Emre', 'Burak', 'Kerem', 'Arda', 'Cenk', 'Hakan', 'Ozan', 'Yiğit'],
  asia: ['Kenji', 'Sota', 'Yuto', 'Ren', 'Haruto', 'Min-Jun', 'Ji-Ho', 'Tae-Yang', 'Seung-Ho', 'Wei', 'Jun', 'Hao'],
  northam: ['Tyler', 'Brandon', 'Jordan', 'Mason', 'Cody', 'Dylan', 'Marcus', 'Xavier', 'Elijah', 'Andre', 'Kyle', 'Trevor'],
};

export const LAST_NAMES = {
  'eu-w': ['Rossi', 'Bianchi', 'Ferrari', 'García', 'Martínez', 'López', 'Sánchez', 'Müller', 'Schmidt', 'Weber', 'Dubois', 'Lefèvre', 'Moreau', 'Silva', 'Costa', 'Ferreira', 'Jansen', 'de Vries', 'Bakker', 'Smith', 'Walker', 'Hughes', 'Wright', 'Connor', 'Novak', 'Ricci', 'Bruno', 'Marino', 'Serrano', 'Romero', 'Vidal', 'Petit', 'Leroy', 'Girard', 'Rocha', 'Mendes', 'Almeida', 'Visser', 'Peters', 'Doyle'],
  'eu-e': ['Petrov', 'Ivanov', 'Kowalski', 'Nowak', 'Novák', 'Horvat', 'Marković', 'Popović', 'Vlasić', 'Zieliński', 'Kovács', 'Dumitru', 'Volkov', 'Sokolov', 'Baran', 'Havel', 'Kral', 'Jurić', 'Babić', 'Stankov'],
  afr: ['El Amrani', 'Bennani', 'Alaoui', 'Tazi', 'Idrissi', 'Chafik', 'Bouchaib', 'Ziani', 'Cherki', 'Berrada', 'Diallo', 'Traoré', 'Koné', 'Touré', 'Cissé', 'Ndiaye', 'Mbaye', 'Okafor', 'Adeyemi', 'Mwangi', 'Abubakar', 'Ben Salah', 'Chaabani', 'Haddad', 'Ghazi', 'Mansouri', 'Zerrouki', 'Bouzid', 'Amrabet', 'Sagna', 'Kamara', 'Fofana', 'Yeboah', 'Owusu', 'Mbeki', 'Dlamini'],
  latam: ['Álvarez', 'Fernández', 'Gómez', 'Rodríguez', 'Pereyra', 'Gutiérrez', 'Rojas', 'Vargas', 'Silveira', 'Nascimento', 'Souza', 'Oliveira', 'Barbosa', 'Cardoso', 'Molina', 'Ortega', 'Cabrera', 'Herrera', 'Peña', 'Salazar'],
  mideast: ['Al-Harbi', 'Al-Qahtani', 'Al-Otaibi', 'Al-Zahrani', 'Al-Dosari', 'Al-Shehri', 'Al-Ghamdi', 'Al-Mutairi', 'Al-Amri', 'Al-Yami', 'Demir', 'Yılmaz', 'Kaya', 'Çelik', 'Şahin', 'Aydın', 'Öztürk', 'Arslan', 'Doğan', 'Kılıç', 'Rashidi', 'Bagheri', 'Karimi', 'Hosseini'],
  asia: ['Tanaka', 'Suzuki', 'Takahashi', 'Watanabe', 'Ito', 'Kim', 'Lee', 'Park', 'Choi', 'Jung', 'Chen', 'Wang', 'Liu', 'Zhang'],
  northam: ['Johnson', 'Williams', 'Brown', 'Miller', 'Davis', 'Wilson', 'Moore', 'Taylor', 'Anderson', 'Thomas', 'Jackson', 'White', 'Harris', 'Martin', 'Thompson', 'Garcia'],
};

// nationality pool per league region (weights favour the local region)
export const REGION_NATIONS = {
  'eu-w': { UEFA: 1, CONMEBOL: 0.35, CAF: 0.28, CONCACAF: 0.08, AFC: 0.04 },
  'eu-e': { UEFA: 1, CONMEBOL: 0.2, CAF: 0.12, AFC: 0.05, CONCACAF: 0.03 },
  afr: { CAF: 1, UEFA: 0.22, CONMEBOL: 0.08, AFC: 0.05, CONCACAF: 0.03 },
  mideast: { AFC: 0.9, CAF: 0.6, UEFA: 0.4, CONMEBOL: 0.2, CONCACAF: 0.06 },
  latam: { CONMEBOL: 1, UEFA: 0.3, CONCACAF: 0.15, CAF: 0.1, AFC: 0.04 },
  northam: { CONCACAF: 1, CONMEBOL: 0.45, UEFA: 0.35, CAF: 0.2, AFC: 0.12 },
};

// ── formations ───────────────────────────────────────────────────────────────
// x: 0 (own goal line) → 1 (opponent goal line) ; y: 0 (left) → 1 (right)
export const FORMATIONS = {
  '4-3-3': { name: '4-3-3', slots: [
    { role: 'GK', x: 0.06, y: 0.50 }, { role: 'RB', x: 0.24, y: 0.82 }, { role: 'CB', x: 0.20, y: 0.62 },
    { role: 'CB', x: 0.20, y: 0.38 }, { role: 'LB', x: 0.24, y: 0.18 }, { role: 'DM', x: 0.40, y: 0.50 },
    { role: 'CM', x: 0.52, y: 0.70 }, { role: 'CM', x: 0.52, y: 0.30 }, { role: 'RW', x: 0.75, y: 0.84 },
    { role: 'ST', x: 0.82, y: 0.50 }, { role: 'LW', x: 0.75, y: 0.16 } ] },
  '4-4-2': { name: '4-4-2', slots: [
    { role: 'GK', x: 0.06, y: 0.50 }, { role: 'RB', x: 0.24, y: 0.84 }, { role: 'CB', x: 0.20, y: 0.62 },
    { role: 'CB', x: 0.20, y: 0.38 }, { role: 'LB', x: 0.24, y: 0.16 }, { role: 'RW', x: 0.52, y: 0.86 },
    { role: 'CM', x: 0.46, y: 0.62 }, { role: 'CM', x: 0.46, y: 0.38 }, { role: 'LW', x: 0.52, y: 0.14 },
    { role: 'ST', x: 0.80, y: 0.60 }, { role: 'ST', x: 0.80, y: 0.40 } ] },
  '4-2-3-1': { name: '4-2-3-1', slots: [
    { role: 'GK', x: 0.06, y: 0.50 }, { role: 'RB', x: 0.24, y: 0.84 }, { role: 'CB', x: 0.20, y: 0.62 },
    { role: 'CB', x: 0.20, y: 0.38 }, { role: 'LB', x: 0.24, y: 0.16 }, { role: 'DM', x: 0.40, y: 0.62 },
    { role: 'DM', x: 0.40, y: 0.38 }, { role: 'RW', x: 0.64, y: 0.84 }, { role: 'AM', x: 0.64, y: 0.50 },
    { role: 'LW', x: 0.64, y: 0.16 }, { role: 'ST', x: 0.84, y: 0.50 } ] },
  '3-5-2': { name: '3-5-2', slots: [
    { role: 'GK', x: 0.06, y: 0.50 }, { role: 'CB', x: 0.20, y: 0.72 }, { role: 'CB', x: 0.18, y: 0.50 },
    { role: 'CB', x: 0.20, y: 0.28 }, { role: 'RW', x: 0.50, y: 0.90 }, { role: 'CM', x: 0.48, y: 0.66 },
    { role: 'DM', x: 0.42, y: 0.50 }, { role: 'CM', x: 0.48, y: 0.34 }, { role: 'LW', x: 0.50, y: 0.10 },
    { role: 'ST', x: 0.80, y: 0.60 }, { role: 'ST', x: 0.80, y: 0.40 } ] },
  '5-3-2': { name: '5-3-2', slots: [
    { role: 'GK', x: 0.06, y: 0.50 }, { role: 'RB', x: 0.26, y: 0.90 }, { role: 'CB', x: 0.18, y: 0.70 },
    { role: 'CB', x: 0.15, y: 0.50 }, { role: 'CB', x: 0.18, y: 0.30 }, { role: 'LB', x: 0.26, y: 0.10 },
    { role: 'CM', x: 0.46, y: 0.68 }, { role: 'DM', x: 0.42, y: 0.50 }, { role: 'CM', x: 0.46, y: 0.32 },
    { role: 'ST', x: 0.78, y: 0.60 }, { role: 'ST', x: 0.78, y: 0.40 } ] },
  '4-4-1-1': { name: '4-4-1-1', slots: [
    { role: 'GK', x: 0.06, y: 0.50 }, { role: 'RB', x: 0.24, y: 0.84 }, { role: 'CB', x: 0.20, y: 0.62 },
    { role: 'CB', x: 0.20, y: 0.38 }, { role: 'LB', x: 0.24, y: 0.16 }, { role: 'RW', x: 0.50, y: 0.86 },
    { role: 'CM', x: 0.44, y: 0.62 }, { role: 'CM', x: 0.44, y: 0.38 }, { role: 'LW', x: 0.50, y: 0.14 },
    { role: 'AM', x: 0.68, y: 0.50 }, { role: 'ST', x: 0.84, y: 0.50 } ] },
};

export const POS_ORDER = ['GK', 'RB', 'CB', 'LB', 'DM', 'CM', 'AM', 'RW', 'LW', 'ST'];

// ── competitions ─────────────────────────────────────────────────────────────
export const CUP_NAME = (lg) => `${lg.country} National Cup`;
export const CONTINENTAL = [
  { id: 'UCL', name: 'Champions Continental Cup', conf: 'UEFA', field: 32 },
  { id: 'LIB', name: 'Copa Sudamericana Elite', conf: 'CONMEBOL', field: 24 },
  { id: 'CAFCL', name: 'African Champions Shield', conf: 'CAF', field: 24 },
  { id: 'ACL', name: 'Asian Champion Trophy', conf: 'AFC', field: 20 },
  { id: 'CCC', name: 'North American Championship', conf: 'CONCACAF', field: 16 },
];

export const WORLD_CUP = { id: 'WC', name: 'World Cup', field: 32 };

// ── growth / economy tuning ──────────────────────────────────────────────────
export const TUNE = {
  attrMin: 28, attrMax: 99,
  growthBase: 0.85,        // potential-driven growth per season at full minutes
  declineAge: 31,
  seasonWeeks: 34,         // league matchdays
  wageBase: 0.16,          // €k per week per overall point above 40
  valueBase: 0.09,         // €M per overall point above 40, ^2.4 curve
  agentFeeRate: 0.08,
  wcEverySeasons: 4,
  continentalEverySeasons: 1,
  awardTopN: 3,
};
