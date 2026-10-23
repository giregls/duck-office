// ENDESGA 32 (lospec.com/palette-list/endesga-32) — every pixel of the office
// comes from these 32 colours — plus the duck "breeds" (one per project).
(function (DO) {
  const C = {
    black: '#181425', navy: '#262b44', slate: '#3a4466', steel: '#5a6988', grey: '#8b9bb4', silver: '#c0cbdc', white: '#ffffff',
    outline: '#3e2731', mahogany: '#733e39', brown: '#b86f50', tan: '#c28569', wood: '#e4a672', sand: '#e8b796', cream: '#ead4aa',
    wine: '#a22633', rust: '#be4a2f', red: '#e43b44', hot: '#ff0044', amber: '#d77643', orange: '#f77622', gold: '#feae34', yellow: '#fee761',
    pine: '#193c3e', forest: '#265c42', green: '#3e8948', lime: '#63c74d',
    deep: '#124e89', blue: '#0099db', cyan: '#2ce8f5',
    plum: '#68386c', magenta: '#b55088', pink: '#f6757a',
  };

  // [light, base, shade] for head and body.
  const BREEDS = [
    { name: 'canard de bain', head: [C.white, C.yellow, C.gold], body: [C.white, C.yellow, C.gold] },
    { name: 'colvert', head: [C.lime, C.green, C.forest], body: [C.white, C.silver, C.grey] },
    { name: 'pekin', head: [C.white, C.white, C.silver], body: [C.white, C.white, C.silver] },
    { name: 'brun', head: [C.wood, C.brown, C.mahogany], body: [C.wood, C.brown, C.mahogany] },
    { name: 'bleu', head: [C.cyan, C.blue, C.deep], body: [C.cyan, C.blue, C.deep] },
    { name: 'rose', head: [C.sand, C.pink, C.magenta], body: [C.sand, C.pink, C.magenta], cheek: C.red },
    { name: 'ardoise', head: [C.grey, C.steel, C.slate], body: [C.grey, C.steel, C.slate] },
    { name: 'menthe', head: [C.lime, C.green, C.forest], body: [C.lime, C.green, C.forest] },
  ];

  function hexToRgb(hex) {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  // Stable 32-bit string hash (FNV-1a) used for colours, hats and seeded randomness.
  function hash(str) {
    let h = 0x811c9dc5;
    const s = String(str);
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
  }

  // Small deterministic PRNG (mulberry32).
  function rng(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  DO.C = C;
  DO.BREEDS = BREEDS;
  DO.hexToRgb = hexToRgb;
  DO.hash = hash;
  DO.rng = rng;
})(globalThis.DO = globalThis.DO || {});
