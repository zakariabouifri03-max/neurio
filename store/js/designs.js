/* ATLAS INK — original tee graphics, drawn as pure SVG.
   Every function receives a unique id (`u`) so gradients/clips never collide
   when several mockups are rendered on the same page. */

const CREAM = '#F3E8D3';
const INK = '#141210';
const ORANGE = '#E8501E';

/* four-point sparkle */
const spark = (x, y, s = 40, fill = CREAM, opacity = 1) => `
  <path d="M0 -40C6 -12 12 -6 40 0C12 6 6 12 0 40C-6 12 -12 6 -40 0C-12 -6 -6 -12 0 -40Z"
        fill="${fill}" opacity="${opacity}" transform="translate(${x} ${y}) scale(${s / 40})"/>`;

const diamond = (x, y, s, fill) =>
  `<path d="M${x} ${y - s}L${x + s} ${y}L${x} ${y + s}L${x - s} ${y}Z" fill="${fill}"/>`;

const svg = (inner, label) =>
  `<svg viewBox="0 0 1000 1200" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${label}" focusable="false">${inner}</svg>`;

export const DESIGNS = {
  /* ── 01 · SAHARA CLUB ─────────────────────────────────────────── */
  sahara: (u) => svg(`
    <defs>
      <linearGradient id="sa-sun-${u}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#F6AE4A"/><stop offset="1" stop-color="#DF4A1B"/>
      </linearGradient>
      <clipPath id="sa-clip-${u}"><circle cx="500" cy="500" r="278"/></clipPath>
    </defs>
    <text x="500" y="112" text-anchor="middle" font-family="'Space Mono',monospace" font-size="24"
          letter-spacing="9" fill="${CREAM}">ATLAS INK — SERIES Nº 01</text>
    <circle cx="500" cy="500" r="278" fill="url(#sa-sun-${u})"/>
    <g clip-path="url(#sa-clip-${u})">
      <rect x="210" y="536" width="580" height="24" fill="${CREAM}"/>
      <rect x="210" y="598" width="580" height="34" fill="${CREAM}"/>
      <rect x="210" y="674" width="580" height="46" fill="${CREAM}"/>
      <rect x="210" y="762" width="580" height="62" fill="${CREAM}"/>
    </g>
    <circle cx="500" cy="500" r="278" fill="none" stroke="${CREAM}" stroke-width="7"/>
    <path d="M222 710L360 492L462 628L590 438L778 710Z" fill="#2A1A10" stroke="${CREAM}"
          stroke-width="9" stroke-linejoin="round"/>
    <text x="500" y="884" text-anchor="middle" font-family="'Anton',Impact,sans-serif"
          font-size="178" letter-spacing="1" fill="${CREAM}" stroke="#2A1A10" stroke-width="3"
          paint-order="stroke">SAHARA</text>
    <text x="500" y="1004" text-anchor="middle" font-family="'Instrument Serif',Georgia,serif"
          font-style="italic" font-size="118" fill="${CREAM}" stroke="#2A1A10" stroke-width="2"
          paint-order="stroke">Club</text>
    ${spark(176, 908, 34, CREAM, .9)}
    ${spark(824, 908, 34, CREAM, .9)}
    <line x1="310" y1="1058" x2="690" y2="1058" stroke="${CREAM}" stroke-opacity=".55" stroke-width="2"/>
    <text x="500" y="1112" text-anchor="middle" font-family="'Space Mono',monospace" font-size="23"
          letter-spacing="8" fill="${CREAM}">NORTH AFRICA · EST. 1974</text>
  `, 'Sahara Club retro sunset tee design'),

  /* ── 02 · ATLAS ───────────────────────────────────────────────── */
  atlas: (u) => svg(`
    <defs>
      <clipPath id="at-clip-${u}"><circle cx="500" cy="356" r="196"/></clipPath>
    </defs>
    <text x="500" y="104" text-anchor="middle" font-family="'Space Mono',monospace" font-size="23"
          letter-spacing="8" fill="${CREAM}">MADE IN MOROCCO — 31.79° N</text>
    <circle cx="500" cy="356" r="200" fill="#E0481B"/>
    <g clip-path="url(#at-clip-${u})">
      <path d="M300 500L400 306L470 404L540 288L700 500" fill="none" stroke="${CREAM}"
            stroke-width="9" stroke-linejoin="round"/>
      <circle cx="500" cy="356" r="196" fill="none" stroke="${CREAM}" stroke-width="4" opacity=".5"/>
    </g>
    <text x="500" y="760" text-anchor="middle" font-family="'Cairo',sans-serif" font-weight="900"
          font-size="232" fill="${CREAM}" direction="rtl">أطلس</text>
    ${spark(822, 690, 40, ORANGE, .95)}
    <text x="500" y="886" text-anchor="middle" font-family="'Anton',Impact,sans-serif" font-size="104"
          letter-spacing="26" fill="${CREAM}">ATLAS</text>
    <path d="M270 966l48 -42 48 42 48 -42 48 42 48 -42 48 42 48 -42 48 42" fill="none" stroke="${ORANGE}"
          stroke-width="9" stroke-linejoin="round" stroke-linecap="round"/>
    <line x1="410" y1="1042" x2="590" y2="1042" stroke="${CREAM}" stroke-opacity=".4" stroke-width="2"/>
    <text x="500" y="1104" text-anchor="middle" font-family="'Space Mono',monospace" font-size="22"
          letter-spacing="7" fill="${CREAM}">AMAZIGH SOUL · PRINT READY</text>
  `, 'Atlas Arabic lettering tee design'),

  /* ── 03 · ATAY ────────────────────────────────────────────────── */
  atay: (u) => svg(`
    <defs>
      <clipPath id="atay-glass-${u}">
        <path d="M416 468L584 468L571 782C566 830 434 830 429 782Z"/>
      </clipPath>
    </defs>
    <text x="500" y="108" text-anchor="middle" font-family="'Space Mono',monospace" font-size="23"
          letter-spacing="7" fill="${CREAM}">MOROCCAN MINT TEA — CASABLANCA</text>
    <text x="500" y="336" text-anchor="middle" font-family="'Cairo',sans-serif" font-weight="900"
          font-size="238" fill="${CREAM}" direction="rtl">أتاي</text>
    ${spark(760, 300, 40, ORANGE)}
    <text x="500" y="398" text-anchor="middle" font-family="'Space Mono',monospace" font-size="22"
          letter-spacing="6" fill="${ORANGE}">ATAY B NANA3 · EXTRA MINT</text>
    <g opacity=".75" stroke="${CREAM}" stroke-width="6" fill="none" stroke-linecap="round">
      <path d="M452 438C430 406 468 384 450 352"/>
      <path d="M500 426C478 392 516 370 498 338"/>
      <path d="M548 438C526 406 564 384 546 352"/>
    </g>
    <g clip-path="url(#atay-glass-${u})">
      <rect x="400" y="556" width="200" height="286" fill="#C98A33"/>
      <path d="M400 558Q500 534 600 558" fill="none" stroke="#E9B84A" stroke-width="16"/>
      <path d="M420 648Q500 626 580 648" fill="none" stroke="#E9B84A" stroke-width="7" opacity=".9"/>
      <path d="M428 714Q500 694 572 714" fill="none" stroke="#E9B84A" stroke-width="7" opacity=".9"/>
      <path d="M416 516Q500 540 584 516" fill="none" stroke="${CREAM}" stroke-width="8" opacity=".8"/>
    </g>
    <path d="M416 468L584 468L571 782C566 830 434 830 429 782Z" fill="none" stroke="${CREAM}" stroke-width="10"/>
    <ellipse cx="500" cy="468" rx="84" ry="15" fill="none" stroke="${CREAM}" stroke-width="10"/>
    <g fill="#8FB37A" stroke="${CREAM}" stroke-width="4">
      <ellipse cx="592" cy="444" rx="46" ry="20" transform="rotate(-28 592 444)"/>
      <ellipse cx="628" cy="482" rx="38" ry="16" transform="rotate(12 628 482)"/>
      <ellipse cx="556" cy="424" rx="34" ry="15" transform="rotate(-58 556 424)"/>
    </g>
    <ellipse cx="500" cy="842" rx="172" ry="24" fill="none" stroke="${CREAM}" stroke-width="8"/>
    <path d="M352 862Q500 904 648 862" fill="none" stroke="${CREAM}" stroke-width="5" opacity=".55"/>
    <text x="500" y="1038" text-anchor="middle" font-family="'Cairo',sans-serif" font-weight="900"
          font-size="128" fill="${CREAM}" direction="rtl">بالنعناع</text>
    <line x1="330" y1="1082" x2="670" y2="1082" stroke="${CREAM}" stroke-opacity=".4" stroke-width="2"/>
    <text x="500" y="1136" text-anchor="middle" font-family="'Space Mono',monospace" font-size="22"
          letter-spacing="6" fill="${CREAM}">SERVED AT 3 PM · NO SHORTCUTS</text>
  `, 'Atay Moroccan mint tea tee design'),

  /* ── 04 · NO DAYS OFF ─────────────────────────────────────────── */
  nodays: (u) => svg(`
    <defs>
      <pattern id="nd-check-${u}" width="60" height="60" patternUnits="userSpaceOnUse">
        <rect width="30" height="30" fill="#D9F24A"/>
        <rect x="30" y="30" width="30" height="30" fill="#D9F24A"/>
      </pattern>
    </defs>
    <text x="80" y="118" font-family="'Space Mono',monospace" font-size="24" letter-spacing="8"
          fill="${CREAM}" opacity=".65">ATLAS INK / FW26 — SERIES Nº 04</text>
    ${spark(820, 230, 96, ORANGE)}
    <text x="76" y="418" font-family="'Anton',Impact,sans-serif" font-size="282"
          fill="#D9F24A">NO</text>
    <text x="76" y="710" font-family="'Anton',Impact,sans-serif" font-size="282"
          fill="#D9F24A">DAYS</text>
    <text x="76" y="1002" font-family="'Anton',Impact,sans-serif" font-size="282"
          fill="none" stroke="${CREAM}" stroke-width="7">OFF</text>
    <rect x="80" y="1044" width="840" height="60" fill="url(#nd-check-${u})"/>
    <text x="500" y="1152" text-anchor="middle" font-family="'Space Mono',monospace" font-size="25"
          letter-spacing="9" fill="${CREAM}">WORK. REPEAT. NO DAYS OFF.</text>
  `, 'No Days Off acid lime typographic tee design'),

  /* ── 05 · INNER PEACE ─────────────────────────────────────────── */
  innerpeace: (u) => {
    const rays = [];
    return svg(`
      <g transform="rotate(45 500 660)">
        <path d="M470 250L530 250L530 790L500 860L470 790Z" fill="#C9CDD4" stroke="${INK}" stroke-width="7"/>
        <rect x="385" y="330" width="230" height="32" rx="8" fill="${CREAM}" stroke="${INK}" stroke-width="6"/>
        <rect x="468" y="140" width="64" height="170" rx="16" fill="${ORANGE}" stroke="${INK}" stroke-width="6"/>
        <circle cx="500" cy="128" r="30" fill="${CREAM}" stroke="${INK}" stroke-width="6"/>
      </g>
      <circle cx="500" cy="680" r="300" fill="none" stroke="${CREAM}" stroke-width="2.5" stroke-dasharray="2 16"/>
      <circle cx="500" cy="680" r="250" fill="#F5C542" stroke="${INK}" stroke-width="8"/>
      <g stroke="${INK}" stroke-width="18" stroke-linecap="round">
        <path d="M398 612l44 44m0 -44l-44 44"/>
        <path d="M558 612l44 44m0 -44l-44 44"/>
        <path d="M386 756C424 802 468 806 500 764C532 722 576 722 614 772" fill="none"/>
      </g>
      <path id="ip-arc-${u}" d="M185 336A365 365 0 0 1 815 336" fill="none"/>
      <text font-family="'Anton',Impact,sans-serif" font-size="86" letter-spacing="12" fill="${CREAM}">
        <textPath href="#ip-arc-${u}" startOffset="50%" text-anchor="middle">INNER PEACE</textPath>
      </text>
      ${spark(152, 966, 40, CREAM, .85)}
      ${spark(852, 948, 30, ORANGE, .9)}
      <text x="500" y="1130" text-anchor="middle" font-family="'Space Mono',monospace" font-size="26"
            letter-spacing="12" fill="${CREAM}">OUTER CHAOS</text>
    `, 'Inner Peace smiley and sword tee design');
  },

  /* ── 06 · CASABLANCA ATHLETIC ─────────────────────────────────── */
  casablanca: (u) => svg(`
    <text x="500" y="102" text-anchor="middle" font-family="'Space Mono',monospace" font-size="23"
          letter-spacing="7" fill="${CREAM}" opacity=".8">UNIVERSITY OF THE STREETS — MOROCCO</text>
    <path id="ca-arc-${u}" d="M172 408A375 375 0 0 1 828 408" fill="none"/>
    <text font-family="'Anton',Impact,sans-serif" font-size="80" letter-spacing="9" fill="${CREAM}">
      <textPath href="#ca-arc-${u}" startOffset="50%" text-anchor="middle">CASABLANCA</textPath>
    </text>
    <line x1="140" y1="610" x2="860" y2="610" stroke="${CREAM}" stroke-width="3"/>
    <text x="500" y="760" text-anchor="middle" font-family="'Anton',Impact,sans-serif" font-size="170"
          letter-spacing="2" fill="${CREAM}">ATHLETIC</text>
    <text x="500" y="900" text-anchor="middle" font-family="'Anton',Impact,sans-serif" font-size="148"
          letter-spacing="4" fill="#D8452F">DEPT.</text>
    <line x1="140" y1="945" x2="860" y2="945" stroke="${CREAM}" stroke-width="3"/>
    <g fill="${CREAM}">
      ${spark(500, 1000, 34, CREAM)}
      ${spark(430, 1000, 20, ORANGE, .95)}
      ${spark(570, 1000, 20, ORANGE, .95)}
    </g>
    <text x="500" y="1082" text-anchor="middle" font-family="'Instrument Serif',Georgia,serif"
          font-style="italic" font-size="66" fill="${CREAM}">Est. 1956</text>
    <text x="500" y="1142" text-anchor="middle" font-family="'Space Mono',monospace" font-size="21"
          letter-spacing="7" fill="${CREAM}" opacity=".75">PRIDE OF THE ATLANTIC COAST</text>
  `, 'Casablanca Athletic varsity tee design'),

  /* ── 07 · AFTER HOURS ─────────────────────────────────────────── */
  afterhours: (u) => svg(`
    <defs>
      <linearGradient id="ah-chrome-${u}" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#FFFFFF"/>
        <stop offset=".28" stop-color="#D9DDE4"/>
        <stop offset=".52" stop-color="#7C8492"/>
        <stop offset=".72" stop-color="#EFF1F4"/>
        <stop offset="1" stop-color="#9AA1AC"/>
      </linearGradient>
    </defs>
    <text x="500" y="100" text-anchor="middle" font-family="'Space Mono',monospace" font-size="23"
          letter-spacing="8" fill="${CREAM}" opacity=".75">ATLAS INK — Y2K ARCHIVE / Nº 07</text>
    <g stroke="${INK}" stroke-width="7" stroke-linejoin="round">
      <path d="M500 520C430 480 350 300 240 280C140 262 105 380 175 470C235 548 380 590 500 520Z"
            fill="url(#ah-chrome-${u})"/>
      <path d="M500 520C570 480 650 300 760 280C860 262 895 380 825 470C765 548 620 590 500 520Z"
            fill="url(#ah-chrome-${u})"/>
      <path d="M500 548C440 574 340 632 292 730C262 790 332 836 406 806C470 780 494 672 500 594Z"
            fill="url(#ah-chrome-${u})"/>
      <path d="M500 548C560 574 660 632 708 730C738 790 668 836 594 806C530 780 506 672 500 594Z"
            fill="url(#ah-chrome-${u})"/>
      <ellipse cx="500" cy="492" rx="23" ry="128" fill="${ORANGE}"/>
      <path d="M490 372C470 330 440 300 402 286" fill="none" stroke-width="6" stroke-linecap="round"/>
      <path d="M510 372C530 330 560 300 598 286" fill="none" stroke-width="6" stroke-linecap="round"/>
      <circle cx="402" cy="286" r="11" fill="${CREAM}"/>
      <circle cx="598" cy="286" r="11" fill="${CREAM}"/>
    </g>
    <g fill="${CREAM}" opacity=".8">
      <circle cx="318" cy="392" r="17"/><circle cx="264" cy="448" r="9"/>
      <circle cx="682" cy="392" r="17"/><circle cx="736" cy="448" r="9"/>
      <circle cx="366" cy="746" r="8"/><circle cx="634" cy="746" r="8"/>
    </g>
    ${spark(150, 620, 30, CREAM, .8)}
    ${spark(846, 600, 42, ORANGE, .9)}
    ${spark(812, 818, 24, CREAM, .8)}
    <text x="500" y="918" text-anchor="middle" font-family="'Anton',Impact,sans-serif" font-size="168"
          letter-spacing="10" fill="url(#ah-chrome-${u})" stroke="${INK}" stroke-width="5"
          paint-order="stroke">AFTER</text>
    <text x="500" y="1080" text-anchor="middle" font-family="'Anton',Impact,sans-serif" font-size="168"
          letter-spacing="10" fill="url(#ah-chrome-${u})" stroke="${INK}" stroke-width="5"
          paint-order="stroke">HOURS</text>
    <text x="500" y="1148" text-anchor="middle" font-family="'Space Mono',monospace" font-size="21"
          letter-spacing="8" fill="${CREAM}" opacity=".7">NIGHT SHIFT — MMIII</text>
  `, 'After Hours Y2K chrome butterfly tee design'),

  /* ── 08 · GROW SLOW ───────────────────────────────────────────── */
  growslow: (u) => {
    let petals = '';
    for (let i = 0; i < 10; i++) {
      petals += `<ellipse cx="0" cy="-112" rx="45" ry="104" transform="rotate(${i * 36})"
        fill="#F7F2E6" stroke="#6B7555" stroke-width="6"/>`;
    }
    return svg(`
      <path id="gs-arc-${u}" d="M240 300A270 270 0 0 1 760 300" fill="none"/>
      <text font-family="'Space Mono',monospace" font-size="27" letter-spacing="11" fill="#6B7555">
        <textPath href="#gs-arc-${u}" startOffset="50%" text-anchor="middle">TAKE YOUR TIME · TAKE YOUR TIME</textPath>
      </text>
      <g transform="translate(500 588)">
        ${petals}
        <circle r="76" fill="${ORANGE}" stroke="#6B7555" stroke-width="6"/>
        <circle r="9" fill="#F7F2E6"/><circle cx="34" cy="-26" r="5" fill="#F7F2E6"/>
        <circle cx="-28" cy="30" r="5" fill="#F7F2E6"/>
      </g>
      ${spark(208, 700, 26, '#6B7555', .7)}
      ${spark(802, 760, 22, ORANGE, .9)}
      <text x="500" y="982" text-anchor="middle" font-family="'Instrument Serif',Georgia,serif"
            font-style="italic" font-size="184" fill="#6B7555">Grow</text>
      <text x="500" y="1136" text-anchor="middle" font-family="'Instrument Serif',Georgia,serif"
            font-style="italic" font-size="184" fill="#6B7555">slow<tspan fill="${ORANGE}">.</tspan></text>
      <text x="500" y="1180" text-anchor="middle" font-family="'Space Mono',monospace" font-size="19"
            letter-spacing="8" fill="#6B7555" opacity=".65">A SMALL REMINDER — Nº 08</text>
    `, 'Grow Slow minimal daisy tee design');
  },

  /* ── 09 · FORM 03 ─────────────────────────────────────────────── */
  form: (u) => svg(`
    <text x="500" y="112" text-anchor="middle" font-family="'Space Mono',monospace" font-size="23"
          letter-spacing="7" fill="${INK}">ATLAS INK — OBJECT SERIES / Nº 03</text>
    <line x1="128" y1="420" x2="128" y2="812" stroke="${INK}" stroke-width="4"/>
    <line x1="158" y1="420" x2="158" y2="812" stroke="${INK}" stroke-width="4"/>
    <path d="M320 812V500A180 180 0 0 1 680 500V812Z" fill="#C0552F"/>
    <circle cx="656" cy="736" r="134" fill="#E8D9BF" stroke="${INK}" stroke-width="5"/>
    <circle cx="336" cy="772" r="42" fill="${INK}"/>
    <rect x="724" y="382" width="44" height="44" fill="${ORANGE}"/>
    <text x="500" y="978" text-anchor="middle" font-family="'Inter',Helvetica,sans-serif" font-weight="700"
          font-size="148" letter-spacing="18" fill="${INK}">FORM</text>
    <text x="500" y="1048" text-anchor="middle" font-family="'Inter',Helvetica,sans-serif" font-weight="500"
          font-size="46" letter-spacing="14" fill="${INK}">FOLLOWS FEELING</text>
    <line x1="350" y1="1084" x2="650" y2="1084" stroke="${INK}" stroke-opacity=".35" stroke-width="2"/>
    <text x="500" y="1140" text-anchor="middle" font-family="'Space Mono',monospace" font-size="21"
          letter-spacing="6" fill="${INK}">GEOMETRY FOR WEARING</text>
  `, 'Form 03 Bauhaus minimal tee design'),

  /* ── 10 · DESERT RAVE ─────────────────────────────────────────── */
  desertrave: (u) => {
    const palette = ['#F08A3C', '#F5E6C8', '#E85D9E', '#8C5FC7'];
    let waves = '';
    for (let i = 0; i < 11; i++) {
      const y = 200 + i * 52;
      const c = palette[i % palette.length];
      waves += `<path d="M150 ${y}C280 ${y - 42} 390 ${y + 42} 500 ${y}S720 ${y - 42} 850 ${y}"
        fill="none" stroke="${c}" stroke-width="28" stroke-linecap="round"/>`;
    }
    return svg(`
      <defs><clipPath id="dr-clip-${u}"><circle cx="500" cy="470" r="296"/></clipPath></defs>
      <text x="500" y="100" text-anchor="middle" font-family="'Space Mono',monospace" font-size="23"
            letter-spacing="8" fill="${CREAM}" opacity=".75">DESERT RAVE — MARRAKECH SESSIONS</text>
      <circle cx="500" cy="470" r="296" fill="#2E1B45"/>
      <g clip-path="url(#dr-clip-${u})">${waves}</g>
      <circle cx="500" cy="470" r="296" fill="none" stroke="${CREAM}" stroke-width="7"/>
      ${spark(160, 300, 30, CREAM, .8)}
      ${spark(852, 630, 36, ORANGE, .9)}
      <text x="500" y="904" text-anchor="middle" font-family="'Anton',Impact,sans-serif" font-size="146"
            letter-spacing="6" fill="${CREAM}" stroke="#2E1B45" stroke-width="6" paint-order="stroke">DESERT</text>
      <text x="500" y="1062" text-anchor="middle" font-family="'Anton',Impact,sans-serif" font-size="178"
            letter-spacing="6" fill="#F08A3C" stroke="${CREAM}" stroke-width="4" paint-order="stroke">RAVE</text>
      <text x="500" y="1138" text-anchor="middle" font-family="'Space Mono',monospace" font-size="21"
            letter-spacing="7" fill="${CREAM}" opacity=".8">SUNSET TO SUNRISE</text>
    `, 'Desert Rave psychedelic sun tee design');
  },

  /* ── 11 · GOOD LUCK CLUB ──────────────────────────────────────── */
  goodluck: (u) => {
    let raysDark = '';
    let raysLight = '';
    for (let a = 0; a < 360; a += 22.5) {
      const rad = (a * Math.PI) / 180;
      const x1 = 500 + Math.cos(rad) * 338;
      const y1 = 612 + Math.sin(rad) * 338;
      const x2 = 500 + Math.cos(rad) * 386;
      const y2 = 612 + Math.sin(rad) * 386;
      raysDark += `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${INK}" stroke-width="15" stroke-linecap="round"/>`;
      raysLight += `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${CREAM}" stroke-width="7" stroke-linecap="round"/>`;
    }
    return svg(`
      <path id="gl-arc-${u}" d="M160 340A380 380 0 0 1 840 340" fill="none"/>
      <text font-family="'Anton',Impact,sans-serif" font-size="84" letter-spacing="6" fill="${CREAM}"
            stroke="${INK}" stroke-width="3" paint-order="stroke">
        <textPath href="#gl-arc-${u}" startOffset="50%" text-anchor="middle">GOOD LUCK CLUB</textPath>
      </text>
      ${raysDark}${raysLight}
      <path d="M180 612C320 422 680 422 820 612C680 802 320 802 180 612Z" fill="${CREAM}"
            stroke="${INK}" stroke-width="10"/>
      <circle cx="500" cy="612" r="120" fill="#1D3FA3" stroke="${INK}" stroke-width="7"/>
      <circle cx="500" cy="612" r="56" fill="${INK}"/>
      <circle cx="465" cy="575" r="18" fill="${CREAM}"/>
      <path d="M650 812C690 860 690 892 650 892C610 892 610 860 650 812Z" fill="#D8452F"
            stroke="${INK}" stroke-width="6"/>
      ${spark(238, 836, 28, '#D8452F', .95)}
      ${spark(768, 866, 22, CREAM, .8)}
      <text x="500" y="1022" text-anchor="middle" font-family="'Cairo',sans-serif" font-weight="900"
            font-size="72" fill="${ORANGE}" direction="rtl">ضد الحسد</text>
      <text x="500" y="1110" text-anchor="middle" font-family="'Space Mono',monospace" font-size="23"
            letter-spacing="8" fill="${CREAM}">BAD ENERGY NOT WELCOME</text>
    `, 'Good Luck Club evil eye tee design');
  },

  /* ── 12 · LOVE BITES ──────────────────────────────────────────── */
  lovebites: (u) => svg(`
    <text x="500" y="100" text-anchor="middle" font-family="'Space Mono',monospace" font-size="22"
          letter-spacing="8" fill="${CREAM}" opacity=".7">ATLAS INK — FLASH SHEET Nº 12</text>
    <text x="500" y="268" text-anchor="middle" font-family="'Anton',Impact,sans-serif" font-size="118"
          letter-spacing="4" fill="${CREAM}">LOVE <tspan fill="#D8452F">BITES</tspan></text>
    <circle cx="500" cy="330" r="24" fill="${CREAM}" stroke="${INK}" stroke-width="5"/>
    <rect x="466" y="348" width="68" height="148" rx="30" fill="#B93A2A" stroke="${CREAM}" stroke-width="6"/>
    <g stroke="${CREAM}" stroke-width="5" opacity=".8">
      <line x1="474" y1="382" x2="526" y2="368"/><line x1="474" y1="414" x2="526" y2="400"/>
      <line x1="474" y1="446" x2="526" y2="432"/>
    </g>
    <rect x="388" y="492" width="224" height="30" rx="15" fill="${CREAM}" stroke="${INK}" stroke-width="6"/>
    <circle cx="388" cy="507" r="12" fill="#D8452F"/><circle cx="612" cy="507" r="12" fill="#D8452F"/>
    <path d="M460 522L540 522L530 820L500 900L470 820Z" fill="${CREAM}" stroke="${INK}" stroke-width="8"/>
    <line x1="500" y1="540" x2="500" y2="812" stroke="${INK}" stroke-width="4" opacity=".45"/>
    <path d="M540 700C560 730 558 760 545 776C538 748 532 726 524 712Z" fill="#D8452F"/>
    <path d="M286 820C344 700 424 640 482 702C542 766 558 842 650 800C718 770 750 692 790 700"
          fill="none" stroke="${INK}" stroke-width="76" stroke-linecap="round"/>
    <path d="M286 820C344 700 424 640 482 702C542 766 558 842 650 800C718 770 750 692 790 700"
          fill="none" stroke="#7A8F5C" stroke-width="58" stroke-linecap="round"/>
    <g fill="${CREAM}" opacity=".85">
      <circle cx="340" cy="760" r="7"/><circle cx="414" cy="680" r="7"/><circle cx="492" cy="756" r="7"/>
      <circle cx="574" cy="820" r="7"/><circle cx="664" cy="810" r="7"/><circle cx="730" cy="750" r="7"/>
    </g>
    <ellipse cx="800" cy="692" rx="48" ry="34" transform="rotate(-12 800 692)" fill="#7A8F5C"
            stroke="${INK}" stroke-width="6"/>
    <circle cx="788" cy="682" r="7" fill="${CREAM}"/><circle cx="816" cy="680" r="7" fill="${CREAM}"/>
    <path d="M844 690C868 682 880 692 892 684M844 696C862 702 876 710 886 716" fill="none"
          stroke="#D8452F" stroke-width="6" stroke-linecap="round"/>
    ${spark(196, 480, 26, CREAM, .7)}
    ${spark(812, 476, 34, ORANGE, .9)}
    ${diamond(210, 900, 12, '#D8452F')}
    ${diamond(790, 900, 12, '#D8452F')}
    <text x="500" y="1060" text-anchor="middle" font-family="'Space Mono',monospace" font-size="38"
          letter-spacing="12" fill="${CREAM}">TRUST NO ONE</text>
    <text x="500" y="1128" text-anchor="middle" font-family="'Space Mono',monospace" font-size="20"
          letter-spacing="7" fill="${CREAM}" opacity=".6">TRADITIONAL FLASH — PRINT READY</text>
  `, 'Love Bites snake and dagger tattoo tee design'),

  /* ── FREE · WELCOME CARD ──────────────────────────────────────── */
  welcome: (u) => svg(`
    <text x="500" y="112" text-anchor="middle" font-family="'Space Mono',monospace" font-size="23"
          letter-spacing="7" fill="${INK}">ATLAS INK — FREE SAMPLE Nº 01</text>
    <g stroke="${ORANGE}" stroke-width="26" stroke-linecap="round">
      <line x1="500" y1="232" x2="500" y2="556"/>
      <line x1="500" y1="232" x2="500" y2="556" transform="rotate(45 500 394)"/>
      <line x1="500" y1="232" x2="500" y2="556" transform="rotate(90 500 394)"/>
      <line x1="500" y1="232" x2="500" y2="556" transform="rotate(135 500 394)"/>
    </g>
    ${spark(170, 420, 30, ORANGE, .85)}
    ${spark(832, 330, 22, INK, .65)}
    <text x="500" y="786" text-anchor="middle" font-family="'Anton',Impact,sans-serif" font-size="154"
          letter-spacing="2" fill="${INK}">WELCOME</text>
    <text x="500" y="898" text-anchor="middle" font-family="'Anton',Impact,sans-serif" font-size="86"
          letter-spacing="6" fill="${INK}">TO THE CLUB</text>
    <rect x="348" y="930" width="304" height="10" fill="${ORANGE}"/>
    <text x="500" y="1042" text-anchor="middle" font-family="'Space Mono',monospace" font-size="23"
          letter-spacing="6" fill="${INK}">SVG · PNG · DTF · EPS — FREE</text>
    <text x="500" y="1122" text-anchor="middle" font-family="'Space Mono',monospace" font-size="20"
          letter-spacing="6" fill="${INK}" opacity=".6">PRINT SOMETHING WORTH WEARING</text>
  `, 'Atlas Ink free welcome sample tee design')
};
