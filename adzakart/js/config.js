/* ------------------------------------------------------------------
   adzakART storefront — editable settings
   Change the price, links and copy here. No build step required.
------------------------------------------------------------------- */
window.ADZAK_CONFIG = {
  studio: {
    name: "adzakART",
    owner: "Mohammed Bouifri",
    place: "Sefrou, Morocco",
    since: 2026,
    messageUrl:
      "https://www.etsy.com/messages/new?with_id=1130303999&referring_id=61867927&referring_type=shop&recipient_id=1130303999",
    shopUrl: "https://www.etsy.com/shop/adzakART",
    instagram: "", // add a URL to show the link in the footer
  },

  // The single price for every design, in USD.
  // IMPORTANT: checkout happens on Etsy, so set every Etsy listing to this
  // price too — otherwise Etsy charges its own listing price.
  price: 2,
  currency: "USD",

  // What every buyer receives. Edit freely — this text appears on product
  // pages, in the FAQ and in the "what you get" panel.
  specs: [
    { label: "Format", value: "1 × PNG" },
    { label: "Background", value: "Transparent" },
    { label: "Resolution", value: "High-res, 300 DPI" },
    { label: "Delivery", value: "Instant download" },
  ],

  license: {
    summary: "Personal & small-business commercial use",
    allowed: [
      "Print on t-shirts, sweatshirts, totes, mugs, tumblers, stickers and paper goods that you make and sell.",
      "Use in print-on-demand shops and at local markets.",
      "Resize, crop and recolour the artwork for your own products.",
    ],
    notAllowed: [
      "Reselling, sharing or giving away the PNG file itself.",
      "Claiming the artwork as your own or registering it as a trademark.",
      "Using the artwork in mass-produced wholesale runs or in NFT collections.",
    ],
  },

  // Homepage hero collage (4 listing IDs).
  hero: {
    main: "4558369974",
    top: "4523705786",
    bottom: "4592250659",
  },

  // Four editorial collection tiles on the homepage.
  tiles: [
    { category: "halloween", id: "4548466137", line: "Ghosts, ghouls & good trouble" },
    { category: "fall", id: "4592914998", line: "Pumpkins, plaid & thankfulness" },
    { category: "patriotic", id: "4528650152", line: "Stars, stripes & a little sarcasm" },
    { category: "mexico", id: "4531101820", line: "Heritage, fútbol & orgullo" },
  ],

  // Hand-picked designs for "Studio picks".
  staffPicks: [
    "4558369974",
    "4523481819",
    "4592914998",
    "4559739504",
    "4592250659",
    "4558341570",
    "4548466137",
    "4531101820",
    "4523705786",
    "4558355282",
    "4548734138",
    "4528650152",
  ],

  collectionCopy: {
    halloween: "Ghosts with bows, cows in costume, and pumpkins with a little attitude.",
    fall: "Thanksgiving tablescapes, leopard leaves and everything pumpkin-spiced.",
    christmas: "Cozy cocoa, merry type and a flamingo in a Santa hat.",
    patriotic: "Fourth of July, 1776 energy and red-white-and-blue humour.",
    mexico: "El orgullo Mexicano — jerseys, eagles and very serious fútbol fans.",
    sports: "Game day graphics for football moms, softball girls and soccer fanatics.",
    western: "Howdy with a wink: cowboy ghosts, western boots and cow-print charm.",
    school: "Teacher tees, first-day photos and classroom-friendly clipart.",
    animals: "Dachshunds, highland cows, geese and cats with main-character energy.",
    everyday: "Funny, useful, slightly unhinged designs for ordinary days.",
  },

  reviews: [
    {
      name: "Michelle",
      date: "September 2026",
      stars: 5,
      quote: "The file was easy to use and print on a shirt for my niece.",
      designId: "4517049811",
    },
    {
      name: "Adonay",
      date: "July 2026",
      stars: 5,
      quote: "Perfect for what I needed and great quality image.",
      reply: "Thank you so much for the review ❤️",
      designId: "4523705786",
    },
    {
      name: "Kamber",
      date: "April 2026",
      stars: 5,
      quote: "Quick responses and very helpful! Love my custom design!",
    },
    {
      name: "Etsy buyer",
      date: "August 2026",
      stars: 5,
      quote: "Cute little autumn dachshunds. Thank you!",
      designId: "4531113155",
    },
    {
      name: "Yvette",
      date: "March 2026",
      stars: 5,
      quote: "Came out perfect for my project.",
    },
  ],

  faq: [
    {
      q: "What exactly do I get?",
      a: "Your design as a high-resolution PNG with a clean transparent background — or the full set of PNGs if you choose a bundle. Nothing is shipped: this is a digital download, available the moment your order is confirmed.",
    },
    {
      q: "Is the background really transparent?",
      a: "Yes. The design arrives on its own — no white box, no page background, no watermark. That means you can drop it straight onto a t-shirt, tumbler, tote or sticker in Canva, Cricut Design Space, Photoshop or Procreate. If a design deliberately includes a printed shape (a badge, a frame, a poster), that shape is part of the artwork.",
    },
    {
      q: "Can I sell products made with the design?",
      a: "Yes. Every purchase includes a personal and small-business commercial licence: print it on physical products you make and sell. You may not resell, share or redistribute the PNG file itself, and you may not register the artwork as your own trademark. See the full licence for the plain-English version.",
    },
    {
      q: "How does delivery work?",
      a: "Checkout is completed securely on Etsy. As soon as your payment clears, the PNG lands in your Etsy purchases and in your email — no waiting for a human, no shipping fees.",
    },
    {
      q: "Will the colours match my screen?",
      a: "Screens, printers and fabrics all interpret colour a little differently. The file is prepared for print, but the final result depends on your printer, ink and material. For the closest match, print a small test first.",
    },
    {
      q: "Can I request a custom design?",
      a: "Absolutely. Message the studio with your idea, wording and vibe. Custom work is quoted individually and usually turned around within a few days.",
    },
    {
      q: "What is your refund policy?",
      a: "Because files are delivered instantly, digital purchases are final. If something is wrong with your download, message the studio and we will make it right — a replacement file or a fix, quickly.",
    },
  ],
};
