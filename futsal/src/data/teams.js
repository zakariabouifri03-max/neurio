// Original fictional teams. Colours, logos, kit patterns and attribute biases
// are all invented for Neurio Futsal — no real club or league branding.

export const TEAM_DEFS = [
  {
    id: 'madrid-lions', name: 'Madrid Lions', short: 'MAD', logo: 'lion',
    strength: 7, style: 'possession', formation: 'diamond',
    bias: { passing: 7, ballControl: 6, reaction: 2 },
    home: { shirt: '#F5C518', trim: '#1B1B1B', shorts: '#1B1B1B', socks: '#F5C518', pattern: 'solid' },
    away: { shirt: '#FFF6D6', trim: '#F5C518', shorts: '#F5C518', socks: '#FFF6D6', pattern: 'solid' },
  },
  {
    id: 'tokyo-falcons', name: 'Tokyo Falcons', short: 'TKY', logo: 'falcon',
    strength: 7, style: 'counter', formation: 'wedge',
    bias: { speed: 7, acceleration: 6, stamina: 2 },
    home: { shirt: '#1D3557', trim: '#F1FAEE', shorts: '#F1FAEE', socks: '#1D3557', pattern: 'solid' },
    away: { shirt: '#F1FAEE', trim: '#1D3557', shorts: '#1D3557', socks: '#F1FAEE', pattern: 'solid' },
  },
  {
    id: 'casablanca-stars', name: 'Casablanca Stars', short: 'CSB', logo: 'star',
    strength: 6, style: 'balanced', formation: 'box',
    bias: { dribbling: 7, shooting: 4, ballControl: 3 },
    home: { shirt: '#0B7A4B', trim: '#FFD166', shorts: '#0B7A4B', socks: '#FFD166', pattern: 'solid' },
    away: { shirt: '#FFD166', trim: '#0B7A4B', shorts: '#FFD166', socks: '#0B7A4B', pattern: 'hoops' },
  },
  {
    id: 'london-kings', name: 'London Kings', short: 'LDN', logo: 'crown',
    strength: 7, style: 'press', formation: 'box',
    bias: { defending: 7, strength: 6, stamina: 2 },
    home: { shirt: '#7B2CBF', trim: '#F8F9FA', shorts: '#F8F9FA', socks: '#7B2CBF', pattern: 'hoops' },
    away: { shirt: '#F8F9FA', trim: '#7B2CBF', shorts: '#7B2CBF', socks: '#F8F9FA', pattern: 'solid' },
  },
  {
    id: 'paris-wolves', name: 'Paris Wolves', short: 'PAR', logo: 'wolf',
    strength: 6, style: 'press', formation: 'diamond',
    bias: { defending: 5, stamina: 6, speed: 2 },
    home: { shirt: '#2B2D42', trim: '#EF233C', shorts: '#2B2D42', socks: '#EF233C', pattern: 'solid' },
    away: { shirt: '#EF233C', trim: '#2B2D42', shorts: '#2B2D42', socks: '#EF233C', pattern: 'solid' },
  },
  {
    id: 'rio-titans', name: 'Rio Titans', short: 'RIO', logo: 'titan',
    strength: 6, style: 'possession', formation: 'diamond',
    bias: { shooting: 7, strength: 4, dribbling: 2 },
    home: { shirt: '#FF7F11', trim: '#0B132B', shorts: '#0B132B', socks: '#FF7F11', pattern: 'solid' },
    away: { shirt: '#0B132B', trim: '#FF7F11', shorts: '#FF7F11', socks: '#0B132B', pattern: 'solid' },
  },
  {
    id: 'seoul-tigers', name: 'Seoul Tigers', short: 'SEO', logo: 'tiger',
    strength: 6, style: 'counter', formation: 'box',
    bias: { reaction: 7, acceleration: 6, dribbling: 1 },
    home: { shirt: '#161616', trim: '#FF9F1C', shorts: '#161616', socks: '#FF9F1C', pattern: 'hoops' },
    away: { shirt: '#FF9F1C', trim: '#161616', shorts: '#161616', socks: '#FF9F1C', pattern: 'solid' },
  },
  {
    id: 'new-york-united', name: 'New York United', short: 'NYU', logo: 'orb',
    strength: 6, style: 'balanced', formation: 'wedge',
    bias: { passing: 3, shooting: 3, defending: 3 },
    home: { shirt: '#0077B6', trim: '#CAF0F8', shorts: '#CAF0F8', socks: '#0077B6', pattern: 'solid' },
    away: { shirt: '#CAF0F8', trim: '#0077B6', shorts: '#0077B6', socks: '#CAF0F8', pattern: 'solid' },
  },
];

export const FORMATIONS = {
  // Slots: a = along the attacking axis (-1 own goal … +1 opponent goal), z = across the pitch (-1..1).
  // The four outfield slots are followed by the role label used for stats / HUD.
  box: [
    { a: -0.55, z: -0.5, role: 'DEF' },
    { a: -0.55, z: 0.5, role: 'DEF' },
    { a: 0.2, z: -0.45, role: 'FWD' },
    { a: 0.2, z: 0.45, role: 'FWD' },
  ],
  diamond: [
    { a: -0.6, z: 0, role: 'DEF' },
    { a: -0.05, z: -0.55, role: 'MID' },
    { a: -0.05, z: 0.55, role: 'MID' },
    { a: 0.45, z: 0, role: 'FWD' },
  ],
  wedge: [
    { a: -0.62, z: 0, role: 'DEF' },
    { a: 0.0, z: 0, role: 'MID' },
    { a: 0.32, z: -0.6, role: 'FWD' },
    { a: 0.32, z: 0.6, role: 'FWD' },
  ],
};

export const NAME_FIRST = [
  'Adrian', 'Bruno', 'Caio', 'Dario', 'Elio', 'Felix', 'Gael', 'Hugo', 'Ivo', 'Jonas', 'Kenji',
  'Leo', 'Milo', 'Nico', 'Omar', 'Quinn', 'Rafi', 'Sami', 'Tariq', 'Uri', 'Victor', 'Wes', 'Yusuf',
  'Zane', 'Kai', 'Ren', 'Haru', 'Min-jun', 'Teo', 'Ilan', 'Soren', 'Ravi', 'Dami', 'Luka',
];

export const NAME_LAST = [
  'Varek', 'Moreau', 'Hallin', 'Okafor', 'Brandt', 'Santoro', 'Lindqvist', 'Mendes', 'Kowal',
  'Rahimi', 'Okoye', 'Duarte', 'Keller', 'Ishida', 'Quelle', 'Ostrin', 'Velden', 'Ibarra',
  'Marast', 'Tessaly', 'Halvik', 'Quarin', 'Sendre', 'Oratz', 'Brenno', 'Ferrante', 'Haddad',
  'Dimitri', 'Calder', 'Ardent', 'Vance', 'Solenne',
];

export const SHIRT_NUMBERS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 14, 17, 18, 19, 21, 23, 27, 77];
