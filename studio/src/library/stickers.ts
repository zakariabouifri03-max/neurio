/** Built-in sticker/graphic library (emoji + vector shapes, 100% generated — no licensed assets). */
export type StickerCategory = 'Emojis' | 'Reactions' | 'Arrows' | 'Shapes' | 'Social' | 'Gaming' | 'Memes' | 'Decorative' | 'Animated';

export interface StickerDef {
  id: string;
  name: string;
  category: StickerCategory;
  kind: 'emoji' | 'svg';
  char?: string;
  /** SVG in a 0..100 viewBox */
  svg?: string;
  animation?: string | null;
  tags?: string[];
}

export const STICKER_ANIMATIONS: { id: string; name: string }[] = [
  { id: 'none', name: 'None' },
  { id: 'bounce', name: 'Bounce' },
  { id: 'pulse', name: 'Pulse' },
  { id: 'spin', name: 'Spin' },
  { id: 'shake', name: 'Shake' },
  { id: 'float', name: 'Float' },
  { id: 'wiggle', name: 'Wiggle' },
  { id: 'pop', name: 'Pop In' },
  { id: 'heartbeat', name: 'Heartbeat' },
  { id: 'swing', name: 'Swing' },
];

const emoji = (category: StickerCategory, list: [string, string][], animation: string | null = null): StickerDef[] =>
  list.map(([char, name]) => ({ id: `e_${char.codePointAt(0)!.toString(16)}${animation ? '_' + animation : ''}`, name, category, kind: 'emoji', char, animation }));

const svg = (category: StickerCategory, id: string, name: string, body: string, tags: string[] = []): StickerDef => ({ id, name, category, kind: 'svg', svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">${body}</svg>`, tags });

export const STICKERS: StickerDef[] = [
  ...emoji('Emojis', [
    ['😀', 'Grinning'], ['😂', 'Joy'], ['🤣', 'ROFL'], ['😍', 'Heart eyes'], ['🥰', 'Smiling hearts'], ['😎', 'Cool'], ['🤩', 'Star struck'], ['🥳', 'Party'], ['😭', 'Crying'], ['😡', 'Angry'], ['🤯', 'Mind blown'], ['😱', 'Scream'], ['🤔', 'Thinking'], ['🙄', 'Eye roll'], ['😴', 'Sleep'], ['🤑', 'Money face'], ['🤡', 'Clown'], ['💀', 'Skull'], ['👻', 'Ghost'], ['👽', 'Alien'], ['🤖', 'Robot'], ['💩', 'Poop'], ['🔥', 'Fire'], ['✨', 'Sparkles'], ['💯', '100'], ['❤️', 'Heart'], ['💔', 'Broken heart'], ['💖', 'Sparkling heart'], ['👍', 'Thumbs up'], ['👎', 'Thumbs down'], ['👏', 'Clap'], ['🙌', 'Raised hands'], ['🙏', 'Pray'], ['💪', 'Muscle'], ['👀', 'Eyes'], ['🧠', 'Brain'], ['🎉', 'Party popper'], ['🎊', 'Confetti'], ['🎁', 'Gift'], ['🎂', 'Cake'], ['🏆', 'Trophy'], ['🥇', 'Gold medal'], ['⚽', 'Soccer'], ['🏀', 'Basketball'], ['🎮', 'Gamepad'], ['🎵', 'Music'], ['🎤', 'Microphone'], ['📸', 'Camera'], ['💰', 'Money bag'], ['💎', 'Gem'], ['🚀', 'Rocket'], ['⭐', 'Star'], ['🌈', 'Rainbow'], ['☀️', 'Sun'], ['🌙', 'Moon'], ['⚡', 'Lightning'], ['❄️', 'Snowflake'], ['🎃', 'Pumpkin'], ['🎄', 'Christmas tree'], ['🎅', 'Santa'], ['🦃', 'Turkey'], ['🐶', 'Dog'], ['🐱', 'Cat'], ['🦄', 'Unicorn'], ['🍕', 'Pizza'], ['🍔', 'Burger'], ['☕', 'Coffee'], ['🍺', 'Beer'], ['✈️', 'Plane'], ['🏖️', 'Beach'], ['🗺️', 'Map'], ['📍', 'Pin'], ['⏰', 'Alarm'], ['💡', 'Idea'], ['🔔', 'Bell'], ['📢', 'Megaphone'], ['⚠️', 'Warning'], ['✅', 'Check'], ['❌', 'Cross'], ['❓', 'Question'], ['❗', 'Exclamation'],
  ]),
  ...emoji('Reactions', [
    ['😂', 'LOL'], ['😮', 'Wow'], ['🥺', 'Pleading'], ['😤', 'Triumph'], ['🤬', 'Cursing'], ['🥶', 'Cold'], ['🥵', 'Hot'], ['🤢', 'Nauseated'], ['😏', 'Smirk'], ['🤭', 'Giggle'], ['🫡', 'Salute'], ['🤌', 'Pinched'], ['👉', 'Point right'], ['👈', 'Point left'], ['👇', 'Point down'], ['☝️', 'Point up'], ['🫶', 'Heart hands'], ['✌️', 'Peace'], ['🤞', 'Fingers crossed'], ['🫵', 'You'],
  ], 'pop'),
  ...emoji('Animated', [
    ['🔥', 'Fire pulse'], ['❤️', 'Heartbeat'], ['⭐', 'Star spin'], ['👀', 'Eyes shake'], ['😂', 'LOL bounce'], ['🎉', 'Party wiggle'], ['💸', 'Money float'], ['🚀', 'Rocket float'], ['💯', '100 pop'], ['👍', 'Like bounce'], ['🔔', 'Bell swing'], ['⚡', 'Zap shake'],
  ], 'bounce').map((s, i) => ({ ...s, id: s.id + '_a' + i, animation: ['pulse', 'heartbeat', 'spin', 'shake', 'bounce', 'wiggle', 'float', 'float', 'pop', 'bounce', 'swing', 'shake'][i] })),
  // Arrows
  svg('Arrows', 'arrow_right', 'Arrow right', `<path d="M10 40h50V22l30 28-30 28V60H10z" fill="#ff3b5c"/>`, ['arrow']),
  svg('Arrows', 'arrow_left', 'Arrow left', `<path d="M90 40H40V22L10 50l30 28V60h50z" fill="#ff3b5c"/>`, ['arrow']),
  svg('Arrows', 'arrow_up', 'Arrow up', `<path d="M40 90V40H22l28-30 28 30H60v50z" fill="#ff3b5c"/>`, ['arrow']),
  svg('Arrows', 'arrow_down', 'Arrow down', `<path d="M40 10v50H22l28 30 28-30H60V10z" fill="#ff3b5c"/>`, ['arrow']),
  svg('Arrows', 'arrow_curved', 'Curved arrow', `<path d="M15 80C15 40 40 20 75 20" fill="none" stroke="#ffd60a" stroke-width="10" stroke-linecap="round"/><path d="M60 8l22 12-14 22z" fill="#ffd60a"/>`, ['arrow']),
  svg('Arrows', 'arrow_sketch', 'Sketch arrow', `<path d="M12 70c20-30 40-40 70-45" fill="none" stroke="#fff" stroke-width="6" stroke-linecap="round" stroke-dasharray="1 0"/><path d="M70 12l18 12-20 10" fill="none" stroke="#fff" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>`, ['arrow']),
  svg('Arrows', 'arrow_double', 'Double arrow', `<path d="M5 50l25-20v12h40V30l25 20-25 20V58H30v12z" fill="#38bdf8"/>`, ['arrow']),
  svg('Arrows', 'arrow_circle', 'Circle arrow', `<circle cx="50" cy="50" r="40" fill="#22c55e"/><path d="M30 50h30V36l18 14-18 14V50" fill="#fff"/>`, ['arrow']),
  svg('Arrows', 'arrow_chevron', 'Chevrons', `<path d="M20 20l25 30-25 30M50 20l25 30-25 30" fill="none" stroke="#fff" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"/>`, ['arrow']),
  svg('Arrows', 'pointer_hand', 'Pointer', `<path d="M40 90V50H25c-6 0-6-10 0-10h15V20c0-8 12-8 12 0v20h18c8 0 8 12 0 12h-5c6 0 6 10 0 10h-3c5 0 5 10 0 10H52v8z" fill="#fff" stroke="#000" stroke-width="3"/>`, ['hand']),
  // Shapes
  svg('Shapes', 'circle', 'Circle', `<circle cx="50" cy="50" r="45" fill="#ffffff"/>`),
  svg('Shapes', 'ring', 'Ring', `<circle cx="50" cy="50" r="40" fill="none" stroke="#ffffff" stroke-width="10"/>`),
  svg('Shapes', 'square', 'Square', `<rect x="8" y="8" width="84" height="84" rx="4" fill="#ffffff"/>`),
  svg('Shapes', 'rounded', 'Rounded square', `<rect x="8" y="8" width="84" height="84" rx="20" fill="#ffffff"/>`),
  svg('Shapes', 'frame', 'Frame', `<rect x="8" y="8" width="84" height="84" rx="8" fill="none" stroke="#ffffff" stroke-width="8"/>`),
  svg('Shapes', 'triangle', 'Triangle', `<path d="M50 8l44 80H6z" fill="#ffffff"/>`),
  svg('Shapes', 'star', 'Star', `<path d="M50 5l13 28 31 4-23 21 6 31-27-15-27 15 6-31L5 37l31-4z" fill="#ffd60a"/>`),
  svg('Shapes', 'heart', 'Heart', `<path d="M50 88S10 60 10 34a20 20 0 0140-8 20 20 0 0140 8c0 26-40 54-40 54z" fill="#ff3b5c"/>`),
  svg('Shapes', 'hexagon', 'Hexagon', `<path d="M50 5l39 22.5v45L50 95 11 72.5v-45z" fill="#a855f7"/>`),
  svg('Shapes', 'diamond', 'Diamond', `<path d="M50 5l45 45-45 45L5 50z" fill="#38bdf8"/>`),
  svg('Shapes', 'burst', 'Burst', `<path d="M50 2l9 18 19-7-4 20 20 4-14 15 14 15-20 4 4 20-19-7-9 18-9-18-19 7 4-20-20-4 14-15L6 37l20-4-4-20 19 7z" fill="#f97316"/>`),
  svg('Shapes', 'speech', 'Speech bubble', `<path d="M10 15h80a6 6 0 016 6v44a6 6 0 01-6 6H45L25 90V71H10a6 6 0 01-6-6V21a6 6 0 016-6z" fill="#ffffff"/>`),
  svg('Shapes', 'thought', 'Thought bubble', `<ellipse cx="55" cy="40" rx="40" ry="28" fill="#fff"/><circle cx="25" cy="75" r="8" fill="#fff"/><circle cx="12" cy="88" r="5" fill="#fff"/>`),
  svg('Shapes', 'line', 'Line', `<rect x="5" y="46" width="90" height="8" rx="4" fill="#fff"/>`),
  svg('Shapes', 'dashed', 'Dashed line', `<path d="M5 50h90" stroke="#fff" stroke-width="8" stroke-dasharray="12 8" stroke-linecap="round"/>`),
  svg('Shapes', 'blob', 'Blob', `<path d="M30 15c20-15 50-5 58 20s-8 50-30 55S10 80 8 55 10 30 30 15z" fill="#ec4899"/>`),
  svg('Shapes', 'ribbon', 'Ribbon', `<path d="M5 35h90v30H5z" fill="#ef4444"/><path d="M5 35l-5 15 5 15z M95 35l5 15-5 15z" fill="#991b1b"/>`),
  svg('Shapes', 'badge', 'Badge', `<circle cx="50" cy="50" r="42" fill="#fbbf24"/><circle cx="50" cy="50" r="34" fill="none" stroke="#fff" stroke-width="3" stroke-dasharray="4 4"/>`),
  // Social
  svg('Social', 'like_btn', 'Like button', `<rect x="5" y="25" width="90" height="50" rx="25" fill="#ff3b5c"/><path d="M38 60V45l8-14c3 0 5 2 5 5v8h12c3 0 5 3 4 6l-3 10c0 2-2 3-4 3H38z" fill="#fff"/><text x="68" y="56" font-size="14" font-family="Arial" font-weight="bold" fill="#fff">LIKE</text>`, ['like', 'youtube']),
  svg('Social', 'subscribe', 'Subscribe', `<rect x="2" y="30" width="96" height="40" rx="8" fill="#ff0000"/><text x="50" y="56" text-anchor="middle" font-size="16" font-family="Arial" font-weight="bold" fill="#fff">SUBSCRIBE</text>`, ['youtube']),
  svg('Social', 'bell', 'Notification bell', `<path d="M50 10c-14 0-24 11-24 25v18l-8 12h64l-8-12V35c0-14-10-25-24-25z" fill="#fff"/><circle cx="50" cy="80" r="8" fill="#fff"/>`, ['youtube']),
  svg('Social', 'follow', 'Follow', `<rect x="5" y="30" width="90" height="40" rx="20" fill="#0095f6"/><text x="50" y="56" text-anchor="middle" font-size="16" font-family="Arial" font-weight="bold" fill="#fff">+ FOLLOW</text>`, ['instagram']),
  svg('Social', 'heart_ig', 'Like heart', `<path d="M50 88S10 60 10 34a20 20 0 0140-8 20 20 0 0140 8c0 26-40 54-40 54z" fill="none" stroke="#fff" stroke-width="7"/>`, ['instagram']),
  svg('Social', 'comment', 'Comment', `<path d="M50 10C25 10 8 26 8 46c0 10 5 19 13 25l-3 17 17-9c5 1 10 2 15 2 25 0 42-16 42-35S75 10 50 10z" fill="none" stroke="#fff" stroke-width="7"/>`, ['instagram']),
  svg('Social', 'share', 'Share', `<path d="M10 55l80-40-25 75-15-30z" fill="none" stroke="#fff" stroke-width="7" stroke-linejoin="round"/>`, ['instagram', 'tiktok']),
  svg('Social', 'tiktok_like', 'TikTok heart', `<circle cx="50" cy="50" r="40" fill="rgba(0,0,0,0.5)"/><path d="M50 72S28 56 28 42a11 11 0 0122-4 11 11 0 0122 4c0 14-22 30-22 30z" fill="#ff3b5c"/>`, ['tiktok']),
  svg('Social', 'tiktok_comment', 'TikTok comment', `<circle cx="50" cy="50" r="40" fill="rgba(0,0,0,0.5)"/><ellipse cx="50" cy="48" rx="22" ry="17" fill="#fff"/><path d="M38 60l-4 10 14-6z" fill="#fff"/>`, ['tiktok']),
  svg('Social', 'tiktok_share', 'TikTok share', `<circle cx="50" cy="50" r="40" fill="rgba(0,0,0,0.5)"/><path d="M55 32l20 16-20 16V54c-14 0-22 5-28 14 2-16 10-26 28-28z" fill="#fff"/>`, ['tiktok']),
  svg('Social', 'play_btn', 'Play button', `<circle cx="50" cy="50" r="44" fill="#ff0000"/><path d="M40 30l28 20-28 20z" fill="#fff"/>`, ['youtube']),
  svg('Social', 'live', 'LIVE badge', `<rect x="10" y="35" width="80" height="30" rx="6" fill="#ef4444"/><circle cx="25" cy="50" r="5" fill="#fff"/><text x="60" y="56" text-anchor="middle" font-size="16" font-family="Arial" font-weight="bold" fill="#fff">LIVE</text>`),
  svg('Social', 'new', 'NEW badge', `<path d="M50 5l10 12 15-4 2 15 15 4-8 13 8 13-15 4-2 15-15-4-10 12-10-12-15 4-2-15-15-4 8-13-8-13 15-4 2-15 15 4z" fill="#facc15"/><text x="50" y="56" text-anchor="middle" font-size="18" font-family="Arial" font-weight="900" fill="#000">NEW</text>`),
  svg('Social', 'sale', 'SALE tag', `<path d="M10 50L45 15h45v45L55 95z" fill="#ef4444"/><circle cx="78" cy="27" r="6" fill="#fff"/><text x="48" y="62" text-anchor="middle" font-size="16" font-family="Arial" font-weight="900" fill="#fff" transform="rotate(-45 48 58)">SALE</text>`),
  svg('Social', 'location', 'Location pin', `<path d="M50 95S20 60 20 38a30 30 0 0160 0c0 22-30 57-30 57z" fill="#ef4444"/><circle cx="50" cy="38" r="12" fill="#fff"/>`),
  // Gaming
  svg('Gaming', 'health_bar', 'Health bar', `<rect x="5" y="40" width="90" height="20" rx="4" fill="#222" stroke="#fff" stroke-width="2"/><rect x="7" y="42" width="60" height="16" rx="2" fill="#22c55e"/>`),
  svg('Gaming', 'xp_bar', 'XP bar', `<rect x="5" y="40" width="90" height="20" rx="10" fill="#222" stroke="#a855f7" stroke-width="2"/><rect x="7" y="42" width="45" height="16" rx="8" fill="#a855f7"/>`),
  svg('Gaming', 'crosshair', 'Crosshair', `<circle cx="50" cy="50" r="30" fill="none" stroke="#22c55e" stroke-width="4"/><path d="M50 5v25M50 70v25M5 50h25M70 50h25" stroke="#22c55e" stroke-width="4"/><circle cx="50" cy="50" r="3" fill="#22c55e"/>`),
  svg('Gaming', 'gg', 'GG', `<text x="50" y="68" text-anchor="middle" font-size="60" font-family="Impact, Arial Black, sans-serif" font-weight="900" fill="#facc15" stroke="#000" stroke-width="3">GG</text>`),
  svg('Gaming', 'ko', 'K.O.', `<text x="50" y="68" text-anchor="middle" font-size="52" font-family="Impact, Arial Black, sans-serif" font-weight="900" fill="#ef4444" stroke="#fff" stroke-width="3">K.O.</text>`),
  svg('Gaming', 'level_up', 'Level up', `<rect x="5" y="30" width="90" height="40" rx="6" fill="#111" stroke="#facc15" stroke-width="3"/><text x="50" y="57" text-anchor="middle" font-size="18" font-family="Arial" font-weight="900" fill="#facc15">LEVEL UP!</text>`),
  svg('Gaming', 'coin', 'Coin', `<circle cx="50" cy="50" r="42" fill="#facc15" stroke="#ca8a04" stroke-width="6"/><text x="50" y="66" text-anchor="middle" font-size="44" font-family="Arial" font-weight="900" fill="#ca8a04">$</text>`),
  svg('Gaming', 'pixel_heart', 'Pixel heart', `<path d="M20 20h20v10h20V20h20v20h10v20H80v10H70v10H60v10H40V80H30V70H20V60H10V40h10z" fill="#ef4444"/>`),
  svg('Gaming', 'controller', 'Controller', `<path d="M25 35h50c15 0 20 15 18 30s-10 15-18 5l-5-8H30l-5 8c-8 10-16 10-18-5s3-30 18-30z" fill="#fff"/><circle cx="68" cy="48" r="4" fill="#ef4444"/><circle cx="76" cy="42" r="4" fill="#22c55e"/><path d="M28 42v12M22 48h12" stroke="#000" stroke-width="3"/>`),
  svg('Gaming', 'winner', 'Winner', `<path d="M50 8l10 20 22 3-16 15 4 22-20-11-20 11 4-22L18 31l22-3z" fill="#facc15"/><text x="50" y="92" text-anchor="middle" font-size="18" font-family="Arial" font-weight="900" fill="#fff">WINNER</text>`),
  // Memes
  svg('Memes', 'bruh', 'BRUH', `<text x="50" y="66" text-anchor="middle" font-size="40" font-family="Impact, Arial Black, sans-serif" fill="#fff" stroke="#000" stroke-width="3">BRUH</text>`),
  svg('Memes', 'lol', 'LOL', `<text x="50" y="66" text-anchor="middle" font-size="48" font-family="Impact, Arial Black, sans-serif" fill="#facc15" stroke="#000" stroke-width="3">LOL</text>`),
  svg('Memes', 'omg', 'OMG', `<text x="50" y="66" text-anchor="middle" font-size="46" font-family="Impact, Arial Black, sans-serif" fill="#ff3b5c" stroke="#fff" stroke-width="3">OMG!</text>`),
  svg('Memes', 'wow', 'WOW', `<path d="M50 2l9 18 19-7-4 20 20 4-14 15 14 15-20 4 4 20-19-7-9 18-9-18-19 7 4-20-20-4 14-15L6 37l20-4-4-20 19 7z" fill="#38bdf8"/><text x="50" y="60" text-anchor="middle" font-size="28" font-family="Impact, Arial Black, sans-serif" fill="#fff">WOW</text>`),
  svg('Memes', 'sus', 'SUS', `<text x="50" y="66" text-anchor="middle" font-size="48" font-family="Impact, Arial Black, sans-serif" fill="#ef4444" stroke="#000" stroke-width="3">SUS</text>`),
  svg('Memes', 'nope', 'NOPE', `<rect x="5" y="30" width="90" height="40" rx="8" fill="#ef4444"/><text x="50" y="58" text-anchor="middle" font-size="26" font-family="Impact, Arial Black, sans-serif" fill="#fff">NOPE</text>`),
  svg('Memes', 'yes', 'YES!', `<rect x="5" y="30" width="90" height="40" rx="8" fill="#22c55e"/><text x="50" y="58" text-anchor="middle" font-size="26" font-family="Impact, Arial Black, sans-serif" fill="#fff">YES!</text>`),
  svg('Memes', 'pov', 'POV', `<rect x="10" y="30" width="80" height="40" rx="4" fill="#fff"/><text x="50" y="58" text-anchor="middle" font-size="24" font-family="Arial" font-weight="900" fill="#000">POV:</text>`),
  svg('Memes', 'wait', 'WAIT WHAT', `<text x="50" y="45" text-anchor="middle" font-size="24" font-family="Impact, Arial Black, sans-serif" fill="#fff" stroke="#000" stroke-width="2">WAIT</text><text x="50" y="80" text-anchor="middle" font-size="28" font-family="Impact, Arial Black, sans-serif" fill="#facc15" stroke="#000" stroke-width="2">WHAT?</text>`),
  svg('Memes', 'censored', 'Censored', `<rect x="2" y="35" width="96" height="30" fill="#000"/><text x="50" y="56" text-anchor="middle" font-size="14" font-family="Arial" font-weight="900" fill="#fff" letter-spacing="2">CENSORED</text>`),
  // Decorative
  svg('Decorative', 'sparkle', 'Sparkle', `<path d="M50 5c3 25 20 42 45 45-25 3-42 20-45 45-3-25-20-42-45-45 25-3 42-20 45-45z" fill="#fff"/>`),
  svg('Decorative', 'sparkle_group', 'Sparkles', `<path d="M35 10c2 15 12 25 27 27-15 2-25 12-27 27-2-15-12-25-27-27 15-2 25-12 27-27z" fill="#fff"/><path d="M75 55c1 8 6 13 14 14-8 1-13 6-14 14-1-8-6-13-14-14 8-1 13-6 14-14z" fill="#fff"/><path d="M70 10c1 5 4 8 9 9-5 1-8 4-9 9-1-5-4-8-9-9 5-1 8-4 9-9z" fill="#fff"/>`),
  svg('Decorative', 'confetti', 'Confetti', `<rect x="10" y="20" width="8" height="14" fill="#ff3b5c" transform="rotate(20 14 27)"/><rect x="40" y="10" width="8" height="14" fill="#facc15" transform="rotate(-30 44 17)"/><rect x="70" y="25" width="8" height="14" fill="#38bdf8" transform="rotate(45 74 32)"/><circle cx="25" cy="60" r="5" fill="#22c55e"/><circle cx="60" cy="50" r="5" fill="#a855f7"/><rect x="80" y="65" width="8" height="14" fill="#f97316" transform="rotate(10 84 72)"/><circle cx="45" cy="80" r="5" fill="#ff3b5c"/><rect x="15" y="80" width="8" height="14" fill="#38bdf8" transform="rotate(-20 19 87)"/>`),
  svg('Decorative', 'underline_brush', 'Brush stroke', `<path d="M5 55c20-10 40-8 60-4s25 6 30 2-5 10-30 9S20 70 5 65z" fill="#facc15"/>`),
  svg('Decorative', 'highlight_box', 'Highlight', `<rect x="5" y="30" width="90" height="40" fill="#facc15" opacity="0.85" transform="rotate(-2 50 50)"/>`),
  svg('Decorative', 'circle_scribble', 'Circle scribble', `<path d="M50 15c25-3 42 12 40 32s-20 36-42 36S8 70 10 48 30 17 50 15z" fill="none" stroke="#ff3b5c" stroke-width="5" stroke-linecap="round"/><path d="M48 20c22 0 36 14 34 30" fill="none" stroke="#ff3b5c" stroke-width="4" stroke-linecap="round"/>`),
  svg('Decorative', 'crown', 'Crown', `<path d="M10 75L5 30l25 18 20-33 20 33 25-18-5 45z" fill="#facc15"/><rect x="10" y="75" width="80" height="12" fill="#ca8a04"/>`),
  svg('Decorative', 'laurel', 'Laurel', `<path d="M50 90c-25-5-40-30-35-60 10 5 18 15 20 30 5-15 10-25 15-30M50 90c25-5 40-30 35-60-10 5-18 15-20 30-5-15-10-25-15-30" fill="none" stroke="#facc15" stroke-width="5" stroke-linecap="round"/>`),
  svg('Decorative', 'quote', 'Quote marks', `<text x="50" y="80" text-anchor="middle" font-size="110" font-family="Georgia, serif" fill="#fff">“</text>`),
  svg('Decorative', 'film_strip', 'Film strip', `<rect x="5" y="20" width="90" height="60" fill="#111"/><g fill="#fff"><rect x="10" y="24" width="8" height="8"/><rect x="26" y="24" width="8" height="8"/><rect x="42" y="24" width="8" height="8"/><rect x="58" y="24" width="8" height="8"/><rect x="74" y="24" width="8" height="8"/><rect x="10" y="68" width="8" height="8"/><rect x="26" y="68" width="8" height="8"/><rect x="42" y="68" width="8" height="8"/><rect x="58" y="68" width="8" height="8"/><rect x="74" y="68" width="8" height="8"/></g>`),
  svg('Decorative', 'rec', 'REC indicator', `<circle cx="20" cy="50" r="10" fill="#ef4444"/><text x="40" y="58" font-size="24" font-family="Arial" font-weight="bold" fill="#fff">REC</text>`),
  svg('Decorative', 'viewfinder', 'Viewfinder', `<path d="M5 30V5h25M70 5h25v25M95 70v25H70M30 95H5V70" fill="none" stroke="#fff" stroke-width="6" stroke-linecap="round"/>`),
  svg('Decorative', 'bokeh', 'Bokeh', `<circle cx="25" cy="30" r="15" fill="#fff" opacity="0.5"/><circle cx="65" cy="25" r="10" fill="#fff" opacity="0.4"/><circle cx="75" cy="65" r="18" fill="#fff" opacity="0.35"/><circle cx="35" cy="70" r="9" fill="#fff" opacity="0.5"/>`),
];

export const STICKER_CATEGORIES: StickerCategory[] = ['Emojis', 'Reactions', 'Animated', 'Arrows', 'Shapes', 'Social', 'Gaming', 'Memes', 'Decorative'];
const byId = new Map(STICKERS.map((s) => [s.id, s]));
export const getSticker = (id: string) => byId.get(id);
