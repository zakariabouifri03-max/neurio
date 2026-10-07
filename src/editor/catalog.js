export const ASPECTS = {
  '16:9': { width: 1920, height: 1080, label: 'Landscape' },
  '9:16': { width: 1080, height: 1920, label: 'Portrait' },
  '1:1': { width: 1080, height: 1080, label: 'Square' },
  '4:5': { width: 1080, height: 1350, label: 'Feed' },
};

export const TRACK_COLORS = {
  video: '#8d7fe5', overlay: '#b078da', image: '#c17bd1', text: '#d9945e', audio: '#49bd92',
};

export const EFFECTS = [
  { id: 'vhs', name: 'VHS Memory', category: 'Retro', icon: '▦', description: 'Soft tape color, scanlines and a little analog drift.' },
  { id: 'film', name: '35mm Film', category: 'Film', icon: '◉', description: 'Warm film tone with lifted blacks and soft grain.' },
  { id: 'cinema', name: 'Cinema', category: 'Cinematic', icon: '▰', description: 'Muted highlights and deeper, cinematic contrast.' },
  { id: 'glitch', name: 'RGB Glitch', category: 'Digital', icon: '⌁', description: 'Chromatic color offsets and a subtle digital split.' },
  { id: 'dream', name: 'Soft Focus', category: 'Dream', icon: '✧', description: 'A gentle diffusion glow around bright areas.' },
  { id: 'mono', name: 'Silver Mono', category: 'Film', icon: '◐', description: 'Monochrome image with a restrained contrast curve.' },
  { id: 'warm', name: 'Golden Hour', category: 'Color', icon: '☼', description: 'Warm white balance with softly rich color.' },
  { id: 'cool', name: 'After Hours', category: 'Color', icon: '☾', description: 'Cool, shadowy color for evening scenes.' },
  { id: 'fade', name: 'Matte Fade', category: 'Film', icon: '◌', description: 'A slightly faded print with gentle desaturation.' },
  { id: 'blur', name: 'Motion Soft', category: 'Lens', icon: '≈', description: 'Subtle optical softness; adjust the amount.' },
  { id: 'vignette', name: 'Lens Vignette', category: 'Lens', icon: '◎', description: 'Darkened corners focus attention toward the center.' },
  { id: 'neon', name: 'Neon Nights', category: 'Creative', icon: '✳', description: 'Cool shadows and luminous color for night footage.' },
  { id: 'grain', name: 'Fine Grain', category: 'Film', icon: '⠿', description: 'Fine-grain texture overlay, generated locally.' },
  { id: 'sepia', name: 'Sepia Print', category: 'Retro', icon: '◍', description: 'A classic warm monochrome print.' },
  { id: 'fade-white', name: 'Flash Frame', category: 'Creative', icon: '✦', description: 'A crisp, high-key look with bright highlights.' },
  { id: 'invert', name: 'Negative', category: 'Creative', icon: '◑', description: 'Invert colors for a bold graphic treatment.' },
];

export const TRANSITIONS = [
  { id: 'fade', name: 'Fade', group: 'Classic', icon: '◐' },
  { id: 'dissolve', name: 'Dissolve', group: 'Classic', icon: '▧' },
  { id: 'push-left', name: 'Push left', group: 'Camera', icon: '⇥' },
  { id: 'push-right', name: 'Push right', group: 'Camera', icon: '⇤' },
  { id: 'zoom', name: 'Zoom in', group: 'Camera', icon: '⊕' },
  { id: 'blur', name: 'Blur blend', group: 'Smooth', icon: '≈' },
  { id: 'flash', name: 'Flash', group: 'Creative', icon: '✦' },
  { id: 'glitch', name: 'Digital cut', group: 'Creative', icon: '⌁' },
  { id: 'wipe', name: 'Soft wipe', group: 'Classic', icon: '◧' },
  { id: 'spin', name: 'Spin', group: 'Motion', icon: '⟳' },
];

export const TEXT_PRESETS = [
  { id: 'title', name: 'Clean title', tag: 'TITLE', style: { fontSize: 76, color: '#ffffff', weight: 800, align: 'center', shadow: true, background: false, animation: 'fade' } },
  { id: 'lower-third', name: 'Lower third', tag: 'CAPTION', style: { fontSize: 40, color: '#ffffff', weight: 700, align: 'left', shadow: true, background: true, animation: 'slide' } },
  { id: 'bold-caption', name: 'Bold captions', tag: 'SOCIAL', style: { fontSize: 52, color: '#ffffff', weight: 800, align: 'center', shadow: true, outline: true, animation: 'pop' } },
  { id: 'minimal', name: 'Minimal type', tag: 'MINIMAL', style: { fontSize: 46, color: '#f0eee8', weight: 500, align: 'center', shadow: false, animation: 'fade' } },
  { id: 'outline', name: 'Outline headline', tag: 'EDITORIAL', style: { fontSize: 80, color: '#ffffff', weight: 800, align: 'center', outline: true, shadow: false, animation: 'pop' } },
  { id: 'neon', name: 'Neon title', tag: 'GLOW', style: { fontSize: 70, color: '#b9a2ff', weight: 800, align: 'center', shadow: true, glow: true, animation: 'fade' } },
  { id: 'typewriter', name: 'Typewriter', tag: 'ANIMATED', style: { fontSize: 45, color: '#f1e7d7', weight: 600, align: 'left', shadow: false, animation: 'typewriter' } },
  { id: 'quote', name: 'Quote card', tag: 'QUOTE', style: { fontSize: 43, color: '#fff3dc', weight: 600, align: 'center', shadow: true, background: true, animation: 'fade' } },
];

export const TEMPLATES = [
  { id: 'reel-intro', name: 'The Daily Reel', category: 'Reels', duration: '12 sec', tone: 'QUICK CUTS', marker: '01', style: 'bold-caption', effect: 'cinema', title: 'A little moment\nworth keeping', caption: 'A DAY IN THE LIFE' },
  { id: 'travel-film', name: 'Postcard / No. 04', category: 'Travel', duration: '18 sec', tone: 'CINEMATIC', marker: '04', style: 'minimal', effect: 'film', title: 'Somewhere\nnew', caption: 'NOTES FROM THE ROAD' },
  { id: 'fit-check', name: 'Fit check', category: 'Fashion', duration: '9 sec', tone: 'BEAT CUT', marker: '02', style: 'outline', effect: 'warm', title: 'THE LOOK\nTODAY', caption: 'LOOK 01 · SPRING' },
  { id: 'product-story', name: 'Made for more', category: 'Business', duration: '15 sec', tone: 'PRODUCT', marker: '03', style: 'title', effect: 'cinema', title: 'Made for\nmore.', caption: 'DESIGNED WITH INTENTION' },
  { id: 'game-highlight', name: 'Clutch moment', category: 'Gaming', duration: '10 sec', tone: 'HIGHLIGHTS', marker: '07', style: 'neon', effect: 'neon', title: 'ONE MORE\nROUND', caption: 'WAIT FOR IT…' },
  { id: 'wedding-note', name: 'The in-between', category: 'Wedding', duration: '20 sec', tone: 'MEMORY', marker: '05', style: 'quote', effect: 'film', title: 'The best days\nfeel like this.', caption: 'A DAY TO REMEMBER' },
  { id: 'short-intro', name: 'Frame / Title', category: 'YouTube Shorts', duration: '6 sec', tone: 'INTRO', marker: '06', style: 'typewriter', effect: 'vhs', title: 'LET’S GET\nINTO IT', caption: 'NEW VIDEO' },
  { id: 'weekend-recap', name: 'Weekend, lately', category: 'Lifestyle', duration: '14 sec', tone: 'RECAP', marker: '08', style: 'lower-third', effect: 'warm', title: 'Weekend,\nlately.', caption: 'LITTLE THINGS · BIG FEELING' },
];

export const STICKERS = ['✨','♡','✦','➜','→','↗','✓','!','?','★','✿','☼','☁','⚡','🔥','💬','📍','🎧','🫶','💫','🍒','🪩','🎬','👀','↘','⊙','✌️','🌀','✺','☾'];

export const MUSIC = [
  { id:'mood-calm', name:'Soft Focus', category:'Lo-fi', bpm:82, color:'#8d85c9', key:1, description:'Warm keys · relaxed groove', style:'lofi' },
  { id:'mood-night', name:'Night Drive', category:'Electronic', bpm:116, color:'#7577c8', key:2, description:'Analog synth · steady pulse', style:'synth' },
  { id:'mood-sun', name:'Golden Hour', category:'Vlog', bpm:94, color:'#d69a67', key:3, description:'Acoustic mood · bright and easy', style:'acoustic' },
  { id:'mood-ambient', name:'Wide Open', category:'Ambient', bpm:68, color:'#5ca99f', key:4, description:'Airy pads · slow movement', style:'ambient' },
  { id:'mood-drive', name:'Full Send', category:'Fitness', bpm:128, color:'#ca7289', key:5, description:'Driving rhythm · high energy', style:'drive' },
  { id:'mood-dream', name:'Afterglow', category:'Emotional', bpm:74, color:'#b286b5', key:6, description:'Soft piano tone · reflective', style:'piano' },
  { id:'mood-cinematic', name:'Open Sky', category:'Cinematic', bpm:88, color:'#668dbd', key:7, description:'Wide strings · gentle lift', style:'cinematic' },
  { id:'mood-trap', name:'Low Key', category:'Trap', bpm:140, color:'#a478c6', key:8, description:'Sub pulse · half-time rhythm', style:'trap' },
  { id:'mood-pop', name:'New Day', category:'Pop', bpm:110, color:'#ce8b71', key:9, description:'Bright plucks · upbeat', style:'pop' },
  { id:'mood-dark', name:'No Signal', category:'Horror', bpm:62, color:'#667078', key:10, description:'Dark drones · minimal texture', style:'dark' },
  { id:'mood-game', name:'Checkpoint', category:'Gaming', bpm:124, color:'#65a18c', key:11, description:'8-bit inspired · bright pulse', style:'game' },
  { id:'mood-sport', name:'Momentum', category:'Sports', bpm:132, color:'#ce8451', key:12, description:'Percussive drive · confident', style:'drive' },
];

export const SFX = [
  { id:'sfx-whoosh', name:'Clean whoosh', category:'Whoosh', icon:'↗', style:'whoosh', duration:1.1 },
  { id:'sfx-pop', name:'Soft pop', category:'Pop', icon:'●', style:'pop', duration:.28 },
  { id:'sfx-click', name:'Interface click', category:'UI', icon:'⌁', style:'click', duration:.12 },
  { id:'sfx-swipe', name:'Swipe up', category:'Swipe', icon:'⇡', style:'swipe', duration:.7 },
  { id:'sfx-impact', name:'Low impact', category:'Impact', icon:'▾', style:'impact', duration:.8 },
  { id:'sfx-bass', name:'Sub hit', category:'Bass', icon:'◉', style:'bass', duration:.65 },
  { id:'sfx-glitch', name:'Digital glitch', category:'Glitch', icon:'▦', style:'glitch', duration:.55 },
  { id:'sfx-notify', name:'Bright notification', category:'Notification', icon:'♢', style:'notify', duration:.5 },
  { id:'sfx-camera', name:'Camera shutter', category:'Camera', icon:'▣', style:'camera', duration:.32 },
  { id:'sfx-game', name:'Pixel pickup', category:'Gaming', icon:'✳', style:'game', duration:.45 },
  { id:'sfx-laugh', name:'Cartoon blip', category:'Funny', icon:'↝', style:'funny', duration:.38 },
  { id:'sfx-horror', name:'Dark pulse', category:'Horror', icon:'◌', style:'horror', duration:1.2 },
  { id:'sfx-chime', name:'Glass chime', category:'Cinematic', icon:'✧', style:'chime', duration:1.4 },
  { id:'sfx-spark', name:'Sparkle rise', category:'Transition', icon:'✦', style:'sparkle', duration:.8 },
  { id:'sfx-crowd', name:'Crowd swell', category:'Crowd', icon:'◉', style:'crowd', duration:1.6 },
  { id:'sfx-bird', name:'Morning birds', category:'Nature', icon:'♬', style:'birds', duration:1.4 },
  { id:'sfx-engine', name:'Engine rev', category:'Vehicle', icon:'⌁', style:'engine', duration:1.3 },
  { id:'sfx-stadium', name:'Stadium hit', category:'Sports', icon:'⚑', style:'stadium', duration:1.1 },
];

export const AI_SERVICES = [
  { name: 'Speech-to-text captions', detail: 'Needs a transcription provider / on-device speech model' },
  { name: 'Background & object removal', detail: 'Needs a segmentation / inpainting model' },
  { name: 'Face & subject detection', detail: 'Needs a vision model' },
  { name: 'Stabilization & upscaling', detail: 'Needs a video processing backend' },
  { name: 'Voice enhancement', detail: 'Needs an audio enhancement model' },
];
