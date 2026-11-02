// Algon-flavoured name generator. Algon is the main language of Kremantin; these
// syllables are original and only aim for a consistent "feel".

const ON = ['al', 'el', 'ar', 'ver', 'cal', 'dra', 'fen', 'gal', 'hal', 'is', 'kal', 'lor', 'mar', 'nor', 'or', 'quel', 'ral', 'sar', 'tal', 'ul', 'var', 'yr', 'zen', 'bel', 'cor', 'dun', 'eld', 'fal', 'gor', 'kre', 'lys', 'mor', 'ras', 'sil', 'thar', 'ucl', 'vel', 'wen', 'ael', 'bran', 'cael', 'dor', 'esk', 'fyr', 'hest', 'ith', 'jor', 'kest', 'tro', 'ko', 'rav', 'ber', 'ostr', 'myr', 'ser', 'tam', 'ny', 'aur'];
const MID = ['a', 'e', 'i', 'o', 'u', 'ae', 'ia', 'an', 'en', 'in', 'or', 'ar', 'el', 'is', 'ys', 'ri', 'ra', 'la', 'ne', 've', 'li', 'do', 'sa', 'th', 'ka'];
const END = ['ra', 'ria', 'dor', 'thal', 'vane', 'mir', 'rin', 'os', 'eth', 'ath', 'ys', 'iel', 'oth', 'an', 'ek', 'ul', 'ir', 'esh', 'or', 'ia', 'und', 'wyn', 'ast', 'ost', 'ven', 'ell', 'tin', 'mont', 'gard', 'is', 'ade', 'aire', 'helm', 'ford', 'stead', 'mere'];

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

export class NameGen {
  constructor(rng, custom = []) {
    this.rng = rng; this.used = new Set(); this.custom = custom.filter(Boolean).map((s) => s.trim()).filter(Boolean);
  }
  /** A bare Algon word, 2-3 syllables. */
  word() {
    const r = this.rng;
    for (let tries = 0; tries < 40; tries++) {
      let w = r.pick(ON);
      if (r.chance(0.55)) w += r.pick(MID);
      w += r.pick(END);
      w = w.replace(/(.)\1\1/g, '$1$1').replace(/([aeiouy])\1/g, '$1');
      if (r.chance(0.07)) w = cap(r.pick(ON)) + '-' + cap(r.pick(ON) + r.pick(END));
      w = cap(w);
      if (w.length >= 4 && w.length <= 12 && !this.used.has(w)) { this.used.add(w); return w; }
    }
    return cap(r.pick(ON) + r.pick(END)) + r.int(2, 9);
  }
  /** Name for a feature kind (settlement or marker). */
  forKind(kind) {
    const r = this.rng;
    if (['city', 'town', 'village'].includes(kind) && this.custom.length) return this.custom.shift();
    const w = this.word();
    switch (kind) {
      case 'fortress': return r.pick([`Fort ${w}`, `${w} Keep`, `${w} Bastion`, `${w} Watch`]);
      case 'temple': return r.pick([`Sanctum of ${w}`, `${w} Cathedral`, `Chapel of St. ${w}`, `${w} Abbey`]);
      case 'dungeon': return r.pick([`${w} Depths`, `Vault of ${w}`, `The ${w} Labyrinth`, `${w} Hollow`]);
      case 'ruins': return `Ruins of ${w}`;
      case 'breach': return r.pick([`${w} Rift`, `Breach of ${w}`, `The ${w} Maw`]);
      case 'lumenari': return r.pick([`${w} Shardfield`, `Glimmerstone of ${w}`, `${w} Cracked Vigil`]);
      case 'crimson': return `Order Laboratory (${w})`;
      case 'relic': return r.pick([`${w} Relic Cache`, `Lost Magic Site of ${w}`]);
      case 'monster': return `${w} Beast Lair`;
      case 'knights': return `Church Knight Garrison of ${w}`;
      case 'summoning': return 'Summoning Chamber';
      case 'military': return `${w} Encampment`;
      case 'village': return r.chance(0.25) ? `${w} ${r.pick(['Cross', 'Mill', 'Hollow', 'Green'])}` : w;
      default: return w;
    }
  }
  sea() { const w = this.word(); return this.rng.pick([`Sea of ${w}`, `${w} Ocean`, `The ${w} Deep`, `${w} Gulf`]); }
  state() { const w = this.word(); return this.rng.pick([`Kingdom of ${w}`, `${w} Dominion`, `Principality of ${w}`, `${w} Clans`, `Free Holds of ${w}`, `${w} Theocracy`]); }
}
