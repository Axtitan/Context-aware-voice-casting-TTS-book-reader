/**
 * Character registry construction.
 * Whole-book pass: candidate person names -> alias merging -> evidence-backed attributes.
 * Attributes are only recorded when the text explicitly supports them (evidence quote stored).
 */
import type { Block } from "@/lib/ingestion/extract";
import type { CharacterEvidence } from "@/db/schema";

export type CharacterProfile = {
  key: string;
  name: string;
  aliases: string[];
  gender: "male" | "female" | null;
  genderConfidence: number;
  age: string | null;
  nationality: string | null;
  accent: string | null;
  physicalDescriptions: string[];
  vocalDescriptions: string[];
  personality: string[];
  evidence: CharacterEvidence[];
  importance: "major" | "supporting" | "minor";
  mentionCount: number;
  lineCount: number;
  characterConfidence: number;
  firstBlock: number;
};

export const SPEECH_VERBS =
  "said|says|asked|asks|replied|replies|answered|answers|whispered|whispers|shouted|shouts|yelled|yells|screamed|screams|cried|cries|muttered|mutters|murmured|murmurs|exclaimed|exclaims|called|calls|added|adds|continued|continues|began|begins|told|tells|demanded|demands|snapped|snaps|growled|growls|hissed|hisses|laughed|laughs|sighed|sighs|breathed|gasped|gasps|groaned|moaned|sobbed|stammered|stuttered|repeated|repeats|insisted|insists|observed|remarked|remarks|returned|rejoined|interrupted|interrupts|agreed|agrees|protested|protests|suggested|suggests|announced|announces|declared|declares|pleaded|pleads|begged|begs|urged|warned|warns|ordered|orders|commanded|barked|drawled|sneered|scoffed|snorted|chuckled|giggled|grinned|smiled|nodded|shrugged|frowned|inquired|inquires|wondered|mused|thought|thinks|whimpered|roared|bellowed|boomed|purred|croaked|rasped|wheezed|retorted|conceded|admitted|admits|confessed|explained|explains|offered|offers|ventured|prompted|pressed|teased|joked|lied|promised|swore|spat|blurted|breathed|whispered|went on|put in|cut in|broke in|chimed in|spoke up|spoke";
export const SPEECH_VERB_RE = new RegExp(`\\b(${SPEECH_VERBS})\\b`, "i");

const HONORIFICS = "Mr|Mrs|Ms|Miss|Mx|Dr|Doctor|Professor|Prof|Sir|Dame|Lord|Lady|Lady|Captain|Capt|Colonel|Col|Major|General|Sergeant|Lieutenant|Admiral|Commander|Officer|Detective|Inspector|Constable|Sheriff|Judge|Father|Brother|Sister|Mother|Reverend|Rev|Bishop|King|Queen|Prince|Princess|Duke|Duchess|Count|Countess|Baron|Baroness|Earl|Master|Madam|Madame|Mademoiselle|Monsieur|Señor|Señora|Herr|Frau|Aunt|Uncle|Grandma|Grandpa|Granny|Nurse|Cousin|Old|Young|Saint|St";
const HONORIFIC_RE = new RegExp(`^(${HONORIFICS})\\.?$`);
const PARTICLES = new Set(["de", "van", "von", "da", "del", "della", "di", "la", "le", "du", "of", "the", "bin", "ibn", "al", "el", "mac", "o'"]);

const STOP = new Set(
  `i you he she it we they me him her us them my your his its our their mine yours hers ours theirs a an the and but or nor for so yet if then else when while where why how what which who whom whose this that these those there here is are was were be been being have has had do does did will would shall should can could may might must not no yes oh ah well now just only even also very too so such as at by in on of to from with without into onto upon over under about above below between among through during before after since until till against along around across behind beyond beside besides despite except toward towards within within out up down off away back again once twice never always often sometimes soon still already yet ever never perhaps maybe indeed however therefore thus hence meanwhile instead rather quite almost nearly hardly scarcely mostly chiefly mainly certainly surely probably suddenly finally lately recently aged poor dear dearest all illustration ladyship lordship majesty highness grace honour honor god heaven hell christ lord jesus sir madam ma'am miss mister mr mrs ms dear darling dad mum mom papa mama father mother sunday monday tuesday wednesday thursday friday saturday january february march april may june july august september october november december spring summer autumn winter fall north south east west chapter book part prologue epilogue english french german american british russian italian spanish london paris england france europe america africa asia india china japan rome new york street road river lake mount mountain sea ocean hall house church school college university hospital castle palace inn tavern court army navy state city town village country nation world earth sun moon star day night morning evening afternoon week month year time thank thanks please hello goodbye good bad great little big old young dead alive right left true false yes no come go get let look see say tell know think want like need give take make put keep hold bring send find call turn leave stop start run walk sit stand wait watch hear listen read write speak talk ask answer help try work play live die love hate feel seem become remain appear happen mean matter believe remember forget understand hope wish fear wonder suppose imagine decide agree refuse allow expect miss mind care count`.split(/\s+/),
);

const DIMINUTIVES: Record<string, string[]> = {
  alexander: ["alex", "sasha", "xander", "lex"], elizabeth: ["liz", "lizzy", "lizzie", "beth", "eliza", "betsy", "bess", "betty", "libby"], william: ["will", "bill", "billy", "willy", "liam"],
  robert: ["rob", "bob", "bobby", "robbie", "bert"], richard: ["rick", "dick", "richie", "ricky"], edward: ["ed", "eddie", "ned", "ted", "teddy"], catherine: ["kate", "katie", "cathy", "kitty", "cat"],
  katherine: ["kate", "katie", "kathy", "kitty", "kat"], margaret: ["meg", "maggie", "peggy", "marge", "daisy", "greta"], james: ["jim", "jimmy", "jamie"], john: ["jack", "johnny", "jon"],
  charles: ["charlie", "chuck", "chas"], thomas: ["tom", "tommy"], michael: ["mike", "mikey", "mick"], joseph: ["joe", "joey"], samuel: ["sam", "sammy"], samantha: ["sam", "sammy"],
  benjamin: ["ben", "benny", "benji"], daniel: ["dan", "danny"], anthony: ["tony"], christopher: ["chris", "kit"], nicholas: ["nick", "nicky"], matthew: ["matt", "matty"],
  jonathan: ["jon", "jonny"], andrew: ["andy", "drew"], henry: ["hal", "harry", "hank"], frederick: ["fred", "freddie", "freddy"], theodore: ["ted", "teddy", "theo"], patricia: ["pat", "patty", "trish"],
  jennifer: ["jen", "jenny"], rebecca: ["becky", "becca"], susan: ["sue", "susie"], victoria: ["vicky", "tori"], josephine: ["jo", "josie"], eleanor: ["ellie", "nell", "nora"],
  dorothy: ["dot", "dolly"], abigail: ["abby"], jessica: ["jess", "jessie"], mikhail: ["misha"], nikolai: ["kolya"], dmitri: ["mitya"], ivan: ["vanya"], natalia: ["natasha"], anastasia: ["nastya"],
  fitzwilliam: [], nathaniel: ["nate", "nat"], zachary: ["zach", "zack"], gabriel: ["gabe"], isabella: ["bella", "izzy"], gregory: ["greg"], harold: ["harry", "hal"], leonard: ["leo", "len", "lenny"],
  timothy: ["tim", "timmy"], vincent: ["vince", "vinny"], walter: ["walt", "wally"], albert: ["al", "bert", "bertie"], arthur: ["art", "artie"], ronald: ["ron", "ronnie"], donald: ["don", "donny"],
  peter: ["pete"], stephen: ["steve", "stevie"], steven: ["steve", "stevie"], philip: ["phil", "pip"], lawrence: ["larry"], raymond: ["ray"], douglas: ["doug"], franklin: ["frank", "frankie"],
};

const DEMONYMS =
  "American|British|English|Scottish|Scots|Irish|Welsh|French|German|Russian|Italian|Spanish|Portuguese|Dutch|Belgian|Swiss|Austrian|Polish|Czech|Hungarian|Greek|Turkish|Swedish|Norwegian|Danish|Finnish|Icelandic|Nigerian|Ghanaian|Kenyan|Ethiopian|Egyptian|Moroccan|South African|Indian|Pakistani|Bangladeshi|Chinese|Japanese|Korean|Vietnamese|Thai|Filipino|Indonesian|Malaysian|Australian|New Zealand|Canadian|Mexican|Brazilian|Argentine|Argentinian|Chilean|Colombian|Peruvian|Cuban|Jamaican|Israeli|Iranian|Persian|Iraqi|Arab|Arabian|Lebanese|Syrian|Saudi|Afghan|Texan|Southern|Yorkshire|Cockney|Bostonian|Californian|Scandinavian|Slavic|Latin|Asian|African|European|Yankee|Georgian|Ukrainian|Romanian|Bulgarian|Serbian|Croatian";
const ACCENT_RE = new RegExp(`\\b(${DEMONYMS}|foreign|thick|heavy|slight|faint|soft|northern|southern|western|eastern|west country|midwestern|highland|lowland|upper-class|posh|working-class)\\s+(accent|brogue|lilt|drawl|twang|burr)\\b`, "i");
const NATIONALITY_RE = new RegExp(`\\b(?:was|is|were|being|been|be|as)\\s+(?:a|an|the)?\\s*(?:young|old|elderly|tall|short|little|big|wealthy|poor|handsome|pretty|quiet)?\\s*(${DEMONYMS})(?:\\s+(?:man|woman|girl|boy|gentleman|lady|soldier|officer|sailor|doctor|nobleman|merchant|prince|princess|king|queen|émigré|immigrant|by birth))?\\b`, "i");
const NATIONALITY_APPOS_RE = new RegExp(`,\\s*(?:a|an|the)\\s+(?:young|old|elderly)?\\s*(${DEMONYMS})\\s+(?:man|woman|girl|boy|gentleman|lady|soldier|officer|sailor|doctor|nobleman|merchant)`, "i");

const VOICE_ADJ = "deep|gravelly|gravel|rough|husky|hoarse|raspy|rasping|low|soft|gentle|quiet|high|shrill|squeaky|thin|reedy|rich|warm|cold|harsh|booming|thunderous|loud|melodious|melodic|musical|silky|smooth|velvety|nasal|whispery|breathy|trembling|quavering|steady|firm|stern|sharp|crisp|clipped|drawling|lilting|sing-song|monotone|flat|bright|clear|honeyed|sweet|sonorous|resonant|gruff|growling|throaty|croaky|wheezy|piping|tinny|faint|feeble|weak|powerful|commanding|authoritative|calm|measured|slow|rapid|quick|hurried|halting|mellow|light|childish|girlish|boyish|youthful|aged|cracked|weary|tired|cheerful|solemn|grave|mournful|sad";
const VOICE_RE = new RegExp(`\\b((?:${VOICE_ADJ})(?:,?\\s+(?:and\\s+)?(?:${VOICE_ADJ}))*)\\s+(?:\\w+\\s+)?(voice|tone|tones|baritone|tenor|bass|soprano|alto|contralto|whisper|laugh)\\b`, "i");
const VOICE_POST_RE = new RegExp(`\\b(voice|tone)\\s+(?:was|is|had|became|grew|sounded)\\s+(?:a\\s+|an\\s+|so\\s+|very\\s+|rather\\s+)?((?:${VOICE_ADJ})(?:\\s+and\\s+(?:${VOICE_ADJ}))?)\\b`, "i");
const SPEECH_STYLE_VERBS: Record<string, string> = { drawled: "drawling", boomed: "booming", whispered: "soft-spoken", rasped: "raspy", growled: "gruff", croaked: "croaky", bellowed: "loud", murmured: "soft-spoken", squeaked: "high-pitched", purred: "silky", barked: "sharp" };

const PHYSICAL_RE =
  /\b(tall|short|thin|slender|slim|lean|stout|plump|fat|portly|heavy-set|burly|broad-shouldered|muscular|wiry|frail|gaunt|bony|stooped|hunched|pale|tanned|dark-skinned|fair-skinned|freckled|wrinkled|bearded|clean-shaven|bald|balding|grey-haired|gray-haired|white-haired|silver-haired|red-haired|dark-haired|fair-haired|blonde?|brunette|curly-haired|(?:red|dark|black|brown|blond|blonde|golden|grey|gray|white|silver|auburn|chestnut|sandy|raven|ginger|fair|curly|straight|long|short|cropped|unkempt|thinning)\s+(?:hair|beard|curls|locks|moustache|mustache|whiskers)|(?:blue|green|grey|gray|brown|dark|black|hazel|pale|piercing|bright|sharp|kind|cold|watery|bloodshot|sunken|almond|deep-set)\s+eyes|scar(?:red)?|limp(?:ed|ing)?|spectacles|glasses|monocle|hooked nose|aquiline|handsome|beautiful|pretty|plain|ugly|homely|weather-beaten|ruddy|sallow|rosy-cheeked|elegant|dishevelled|disheveled|one-eyed|one-armed|crippled|hunchback)\b/i;

const PERSONALITY_RE =
  /\b(kind|kindly|cruel|proud|haughty|arrogant|humble|modest|shy|timid|bold|brave|courageous|cowardly|fierce|gentle|stern|severe|strict|clever|cunning|sly|wise|foolish|silly|witty|sarcastic|cheerful|jolly|merry|gloomy|melancholy|sullen|moody|nervous|anxious|calm|serene|patient|impatient|hot-tempered|quick-tempered|irritable|grumpy|generous|greedy|selfish|loyal|treacherous|honest|dishonest|cold|warm-hearted|affectionate|tender|ambitious|lazy|diligent|stubborn|obstinate|gentle|polite|rude|vulgar|charming|charismatic|reserved|quiet|talkative|garrulous|curious|inquisitive|sensible|romantic|practical|pious|devout|cynical|optimistic|pessimistic|vain|good-natured|ill-tempered|amiable|disagreeable|eccentric|mysterious|secretive|frank|earnest|solemn|playful|mischievous|reckless|cautious|prudent|impulsive|fearless|ruthless|merciless|gracious|dignified|noble|wicked|villainous|innocent|naive|cheeky|sardonic|melodramatic|imperious|domineering|meek|obsequious|sycophantic|pompous)\b/i;

const AGE_PATTERNS: [RegExp, string][] = [
  [/\b(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)[- ]years?[- ]old\b|\baged (\d{1,2})\b|\bage of (\d{1,2})\b|\b(\d{1,2}) years of age\b|\b(?:a|the) (?:boy|girl|child|man|woman|lad|lass) of (\d{1,2}|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty)\b/i, "__num__"],
  [/\b(?:little|small|young) (?:boy|girl|child|lad|lass|kid)\b|\bchild(?:ren)? of (?:five|six|seven|eight|nine|ten|eleven|twelve)\b|\b(?:a|the) (?:boy|girl|child|toddler|infant|baby|schoolboy|schoolgirl)\b/i, "child"],
  [/\b(?:teenager|teenage|adolescent|youth|lad|lass|schoolboy|schoolgirl|boy of (?:thirteen|fourteen|fifteen|sixteen|seventeen)|girl of (?:thirteen|fourteen|fifteen|sixteen|seventeen))\b/i, "teen"],
  [/\b(?:young (?:man|woman|lady|gentleman|officer|wife|mother|fellow)|in (?:his|her) (?:early |late |mid-?)?(?:twenties|early thirties)|youthful|not yet thirty|barely twenty|(?:a|the) young(?:er)? \w+)\b/i, "young adult"],
  [/\b(?:middle-aged|in (?:his|her) (?:early |late |mid-?)?(?:thirties|forties|fifties)|a man of (?:forty|fifty)|a woman of (?:forty|fifty)|prime of life)\b/i, "adult"],
  [/\b(?:old (?:man|woman|lady|gentleman|fellow|soldier|sailor|servant|nurse|maid)|elderly|aged|ancient|grey-haired|gray-haired|white-haired|in (?:his|her) (?:sixties|seventies|eighties|nineties)|wrinkled|grandfather|grandmother|venerable|decrepit|octogenarian|old age)\b/i, "older adult"],
];

const AGE_WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };

const GENDERED: Record<string, "male" | "female"> = {
  man: "male", boy: "male", gentleman: "male", father: "male", husband: "male", son: "male", brother: "male", uncle: "male", nephew: "male", king: "male", prince: "male", lord: "male", sir: "male", mr: "male", duke: "male", earl: "male", baron: "male", count: "male", monsieur: "male", herr: "male", señor: "male", lad: "male", fellow: "male", grandfather: "male", widower: "male", master: "male", captain: "male", priest: "male", monk: "male", bachelor: "male", groom: "male", mister: "male", papa: "male", dad: "male", sire: "male",
  woman: "female", girl: "female", lady: "female", mother: "female", wife: "female", daughter: "female", sister: "female", aunt: "female", niece: "female", queen: "female", princess: "female", mrs: "female", miss: "female", ms: "female", madam: "female", madame: "female", mademoiselle: "female", duchess: "female", countess: "female", baroness: "female", frau: "female", señora: "female", lass: "female", maiden: "female", grandmother: "female", widow: "female", mistress: "female", nun: "female", bride: "female", dame: "female", mama: "female", mum: "female", mom: "female", maid: "female", governess: "female", nurse: "female",
};

export function splitSentences(text: string): string[] {
  const parts = text.replace(/(?<!\b(?:Mr|Mrs|Ms|Dr|St|Prof|Capt|Col|Lt|Sgt|Gen|Rev|Jr|Sr|Mt|Hon|Messrs|Mme|Mlle|vs|etc|[A-Z]))([.!?…]["”’']?)\s+(?=["“‘(]?[A-Z0-9])/g, "$1\u0001").split("\u0001");
  return parts.map((s) => s.trim()).filter(Boolean);
}

/** Detect whether the book uses “double” or ‘single’ quotes for dialogue. */
export function detectQuoteStyle(blocks: Block[]): "double" | "single" {
  let d = 0;
  let s = 0;
  for (const b of blocks.slice(0, 600)) {
    d += (b.text.match(/[“"]/g) ?? []).length;
    s += (b.text.match(/(^|\s)[‘']\w/g) ?? []).length;
  }
  return s > d * 1.5 ? "single" : "double";
}

export function stripDialogue(text: string, style: "double" | "single"): string {
  return style === "single" ? text.replace(/(^|\s)[‘'][^’']*[’']/g, " ") : text.replace(/[“"][^”"]*[”"]/g, " ");
}

// ------------------------------------------------------------- name candidates
type Mention = { name: string; block: number; sentence: string; posInSentence: number; sentenceStart: boolean; inQuote: boolean };

function tokenizeNames(sentence: string, block: number, inQuote: boolean, out: Mention[]) {
  // Match sequences: optional honorific + capitalized words (with particles)
  const re = /(?:\b(?:Mr|Mrs|Ms|Miss|Mx|Dr|Prof|Capt|Col|Rev|St|Lt|Sgt|Gen)\.\s+)?(?:\b[A-Z][a-z’']+(?:[-'’][A-Z]?[a-z]+)*\b)(?:\s+(?:(?:de|van|von|da|del|della|di|la|le|du|bin|ibn|al|el)\s+)?[A-Z][a-z’']+(?:[-'’][A-Z]?[a-z]+)*\b){0,3}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sentence))) {
    const raw = m[0].trim().replace(/[’']s?$/, "").replace(/(\w)[’']s\b/g, "$1");
    const idx = m.index;
    const sentenceStart = idx === 0 || /^[“"‘'(\s]*$/.test(sentence.slice(0, idx));
    // Trim particles/stopwords from ends
    const words = raw.split(/\s+/);
    while (words.length && (STOP.has(words[words.length - 1].toLowerCase().replace(/[.,]/g, "")) || PARTICLES.has(words[words.length - 1].toLowerCase()))) words.pop();
    while (words.length && STOP.has(words[0].toLowerCase().replace(/\./g, "")) && !HONORIFIC_RE.test(words[0].replace(/\./g, ""))) words.shift();
    if (!words.length) continue;
    const name = words.join(" ");
    if (name.length < 2 || /^[A-Z]$/.test(name)) continue;
    if (words.length === 1 && HONORIFIC_RE.test(words[0].replace(/\./g, ""))) continue;
    out.push({ name, block, sentence, posInSentence: idx, sentenceStart, inQuote });
  }
}

function normalizeName(n: string): string {
  return n.replace(/\b(Mr|Mrs|Ms|Dr|Prof|Capt|Col|Rev|St|Lt|Sgt|Gen)\b\.?/g, "$1").replace(/\s+/g, " ").trim();
}
function nameParts(n: string): { title: string | null; given: string[]; surname: string | null } {
  const w = n.split(" ");
  let title: string | null = null;
  if (HONORIFIC_RE.test(w[0].replace(".", ""))) title = w.shift()!.replace(".", "");
  const rest = w.filter((x) => !PARTICLES.has(x.toLowerCase()));
  if (!rest.length) return { title, given: [], surname: null };
  if (rest.length === 1) return title ? { title, given: [], surname: rest[0] } : { title, given: [rest[0]], surname: null };
  return { title, given: rest.slice(0, -1), surname: rest[rest.length - 1] };
}
function titleGender(t: string | null): "male" | "female" | null {
  if (!t) return null;
  return GENDERED[t.toLowerCase()] ?? null;
}

type Entity = {
  key: string;
  forms: Map<string, number>;
  mentions: Mention[];
  given: string | null;
  surname: string | null;
  title: string | null;
  titleGenders: Set<"male" | "female">;
};

/**
 * Build the character registry from story blocks. `quoteStyle` lets us separate narration from dialogue.
 */
export function extractCharacters(blocks: Block[], startBlock: number, endBlock: number, quoteStyle: "double" | "single"): CharacterProfile[] {
  const mentions: Mention[] = [];
  for (let i = startBlock; i < endBlock; i++) {
    const b = blocks[i];
    if (b.type === "heading") continue;
    const narration = stripDialogue(b.text, quoteStyle);
    for (const s of splitSentences(narration)) tokenizeNames(s, i, false, mentions);
    const quotes = quoteStyle === "single" ? b.text.match(/(^|\s)[‘'][^’']*[’']/g) : b.text.match(/[“"][^”"]*[”"]/g);
    for (const q of quotes ?? []) for (const s of splitSentences(q.replace(/^[\s“"‘']+|[”"’']+$/g, ""))) tokenizeNames(s, i, true, mentions);
  }

  // Count surface forms; require mid-sentence or honorific/speech-verb evidence for single capitalised words
  const formCount = new Map<string, number>();
  const midCount = new Map<string, number>();
  const personSignal = new Map<string, number>();
  const genderHint = new Map<string, { m: number; f: number }>();
  for (const m of mentions) {
    const n = normalizeName(m.name);
    if (!m.inQuote) {
      const tail = m.sentence.slice(m.posInSentence + m.name.length, m.posInSentence + m.name.length + 100);
      const h = genderHint.get(n) ?? { m: 0, f: 0 };
      if (/\b(he|his|himself)\b/i.test(tail) && !/\b(she|herself)\b/i.test(tail)) h.m++;
      if (/\b(she|herself)\b/i.test(tail) && !/\b(he|his|himself)\b/i.test(tail)) h.f++;
      genderHint.set(n, h);
    }
    formCount.set(n, (formCount.get(n) ?? 0) + 1);
    if (!m.sentenceStart || m.inQuote) midCount.set(n, (midCount.get(n) ?? 0) + 1);
    const after = m.sentence.slice(m.posInSentence + m.name.length, m.posInSentence + m.name.length + 40);
    const before = m.sentence.slice(Math.max(0, m.posInSentence - 40), m.posInSentence);
    let sig = 0;
    if (new RegExp(`^[,\\s]*(${SPEECH_VERBS})\\b`, "i").test(after)) sig += 2;
    if (new RegExp(`\\b(${SPEECH_VERBS})[,\\s]*$`, "i").test(before)) sig += 2;
    if (/^['’]s\b/.test(after)) sig += 0.5;
    if (/^\s*(he|she|his|her|him|himself|herself|who)\b/i.test(after) || /\b(he|she)\s*$/i.test(before)) sig += 0.5;
    if (/\b(in|at|to|from|near|of|through|across|toward|towards|into|over)\s*$/i.test(before) && !/\b(said|to)\s*$/i.test(before)) sig -= 1; // place-like
    if (m.inQuote && (/^[,!?.]/.test(after) || /,\s*$/.test(before))) sig += 1; // vocative
    if (nameParts(n).title) sig += 1.5;
    personSignal.set(n, (personSignal.get(n) ?? 0) + sig);
  }

  const forms = [...formCount.keys()].filter((n) => {
    const cnt = formCount.get(n)!;
    const mid = midCount.get(n) ?? 0;
    const sig = personSignal.get(n) ?? 0;
    const parts = nameParts(n);
    if (parts.given.length === 1 && !parts.surname && STOP.has(parts.given[0].toLowerCase())) return false;
    const isFull = parts.given.length >= 1 && !!parts.surname;
    if (cnt < 2 && sig < 2 && !(isFull && sig >= 0)) return false;
    if (mid === 0 && sig < 1 && !parts.title && !isFull) return false; // only ever sentence-initial => probably a common word
    if (sig < -1 && cnt < 8) return false; // looks like a place
    return true;
  });

  // ---------- alias merging
  const entities: Entity[] = [];
  const byForm = new Map<string, Entity>();
  const sorted = forms.sort((a, b) => nameParts(b).given.length + (nameParts(b).surname ? 1 : 0) - (nameParts(a).given.length + (nameParts(a).surname ? 1 : 0)) || formCount.get(b)! - formCount.get(a)!);

  const newEntity = (form: string): Entity => {
    const p = nameParts(form);
    const e: Entity = { key: form, forms: new Map([[form, formCount.get(form)!]]), mentions: [], given: p.given[0] ?? null, surname: p.surname, title: p.title, titleGenders: new Set() };
    const g = titleGender(p.title);
    if (g) e.titleGenders.add(g);
    entities.push(e);
    byForm.set(form, e);
    return e;
  };
  const attach = (form: string, e: Entity) => {
    e.forms.set(form, formCount.get(form)!);
    byForm.set(form, e);
    const p = nameParts(form);
    const g = titleGender(p.title);
    if (g) e.titleGenders.add(g);
    if (!e.given && p.given[0]) e.given = p.given[0];
    if (!e.surname && p.surname) e.surname = p.surname;
  };

  // Pass 1: full names (given + surname, no title requirement) become anchors
  for (const f of sorted) {
    const p = nameParts(f);
    if (p.given.length >= 1 && p.surname) newEntity(f);
  }
  // Pass 2: title + surname ("Mr Darcy", "Lady Catherine")
  const MALE_TITLE = /^(Mr|Sir|Lord|Dr|Doctor|Captain|Capt|Colonel|Col|Major|General|Professor|Prof|Father|Uncle|King|Prince|Duke|Earl|Baron|Count|Master|Monsieur|Herr|Señor)$/i;
  for (const f of sorted) {
    if (byForm.has(f)) continue;
    const p = nameParts(f);
    if (p.title && p.surname && !p.given.length) {
      const g = titleGender(p.title);
      const cands = entities.filter((e) => e.surname === p.surname && e.given);
      const givenCands = entities.filter((e) => e.given === p.surname && e.title && e.title.toLowerCase() === p.title!.toLowerCase());
      const hintOf = (e: Entity): "male" | "female" | null => {
        let m = 0;
        let fm = 0;
        for (const form of e.forms.keys()) {
          const h = genderHint.get(form);
          if (h) {
            m += h.m;
            fm += h.f;
          }
        }
        if (e.titleGenders.size === 1) return [...e.titleGenders][0];
        return m + fm >= 1 && (m === 0 || fm === 0) ? (m > fm ? "male" : "female") : m + fm >= 3 && m !== fm ? (m > fm ? "male" : "female") : null;
      };
      // If this surname is used with both male and female titles ("Mr Frankenstein" / "Madame Frankenstein"), demand positive gender evidence.
      const surnameGenders = new Set(sorted.map(nameParts).filter((q) => q.title && q.surname === p.surname && !q.given.length).map((q) => titleGender(q.title)).filter(Boolean));
      const strict = surnameGenders.size > 1;
      const compatible = cands.filter((e) => !g || !e.titleGenders.size || e.titleGenders.has(g)).filter((e) => !g || (strict ? hintOf(e) === g : hintOf(e) === null || hintOf(e) === g));
      // By elimination: in strict mode an anchor with no pronoun evidence still takes this title if it doesn't already carry the opposite one.
      const opposite = g === "male" ? "female" : "male";
      const byElimination = strict && compatible.length === 0 && g ? cands.filter((e) => hintOf(e) === null && !e.titleGenders.has(opposite)) : [];
      if (compatible.length === 1) attach(f, compatible[0]);
      else if (byElimination.length === 1) attach(f, byElimination[0]);
      else if (givenCands.length === 1) attach(f, givenCands[0]); // "Lady Catherine" -> "Lady Catherine de Bourgh"
      else newEntity(f);
    }
  }
  const RANK_TITLE = /^(Lady|Lord|Sir|Dame|King|Queen|Prince|Princess|Duke|Duchess|Count|Countess|Baron|Baroness|Earl)$/i;
  /** "dict" = known diminutive (strong), "prefix" = truncation guess (weak, needs frequency support). */
  const isNickOf = (low: string, e: Entity, cnt = 0): "dict" | "prefix" | false => {
    const g = e.given?.toLowerCase();
    if (!g || g === low) return false;
    if (e.title && RANK_TITLE.test(e.title)) return false; // nobility is rarely nicknamed by the narrator ("Kitty" ≠ "Lady Catherine")
    if (DIMINUTIVES[g]?.includes(low)) return "dict";
    if (!!e.surname && low.length >= 4 && g.startsWith(low) && g.length - low.length <= 6 && sum(e.forms) >= cnt) return "prefix";
    return false;
  };
  // Pass 3: single tokens (given names, bare surnames, nicknames)
  for (const f of sorted) {
    if (byForm.has(f)) continue;
    const p = nameParts(f);
    if (p.title || p.given.length !== 1 || p.surname) {
      if (!byForm.has(f)) newEntity(f);
      continue;
    }
    const tok = p.given[0];
    const low = tok.toLowerCase();
    const cnt = formCount.get(f)!;
    const asGiven = entities.filter((e) => e.given?.toLowerCase() === low);
    const asNick = entities.filter((e) => isNickOf(low, e, cnt));
    const asSurname = entities.filter((e) => e.surname?.toLowerCase() === low);
    if (asGiven.length === 1) attach(f, asGiven[0]);
    else if (asGiven.length > 1) attach(f, asGiven.sort((a, b) => sum(b.forms) - sum(a.forms))[0]);
    else if (asNick.length === 1) attach(f, asNick[0]);
    else if (asSurname.length === 1) attach(f, asSurname[0]);
    else if (asSurname.length > 1) {
      // A bare surname conventionally denotes the principal bearer: prefer a full-name anchor, then the "Mr"-style bearer, then the most frequent.
      const weight = (e: Entity) => sum(e.forms) * ((e.title && MALE_TITLE.test(e.title)) || (e.given && !e.title) ? 1.5 : 1);
      attach(f, [...asSurname].sort((a, b) => weight(b) - weight(a))[0]);
    } else newEntity(f);
  }
  // Pass 4: fold nickname-only entities ("Lizzy", "Miss Lizzy") into the character whose given name they shorten.
  for (const e of [...entities]) {
    if ((e.surname && e.given) || e.title) continue; // real full-name anchors and titled people are distinct
    const token = (e.given ?? e.surname ?? "").toLowerCase();
    if (!token) continue;
    const cnt = sum(e.forms);
    const targets = entities.filter((o) => o !== e && isNickOf(token, o, cnt));
    if (targets.length === 1) {
      const target = targets[0];
      for (const [f, c] of e.forms) {
        target.forms.set(f, c);
        byForm.set(f, target);
      }
      for (const g of e.titleGenders) target.titleGenders.add(g);
      entities.splice(entities.indexOf(e), 1);
    }
  }
  for (const m of mentions) byForm.get(normalizeName(m.name))?.mentions.push(m);
  // Cross-sentence antecedents: "Bellamy was an old man. He had a Scottish accent." -> attach the pronoun sentence to Bellamy
  // only when the previous sentence in the same paragraph mentioned exactly one character.
  const allForms = [...byForm.keys()].sort((a, b) => b.length - a.length).map(escapeRe);
  if (allForms.length) {
    const allRe = new RegExp(`\\b(?:Mr|Mrs|Ms|Dr|Prof|Capt|Col|Rev|St|Lt|Sgt|Gen)?\\.?\\s*(${allForms.join("|")})\\b`, "g");
    for (let i = startBlock; i < endBlock; i++) {
      const b = blocks[i];
      if (b.type === "heading") continue;
      const sents = splitSentences(stripDialogue(b.text, quoteStyle));
      let prev: Entity | null = null;
      for (const sent of sents) {
        const ents = new Set<Entity>();
        for (const mm of sent.matchAll(allRe)) {
          const e = byForm.get(normalizeName(mm[1]));
          if (e) ents.add(e);
        }
        if (prev && /^(He|She|His|Her)\b/.test(sent)) prev.mentions.push({ name: "", block: i, sentence: sent, posInSentence: 0, sentenceStart: true, inQuote: false });
        prev = ents.size === 1 ? [...ents][0] : ents.size > 1 ? null : prev;
      }
    }
  }

  // ---------- profiles with evidence
  const profiles: CharacterProfile[] = [];
  for (const e of entities) {
    const total = sum(e.forms);
    if (total < 2) continue;
    const canonical = pickCanonical(e);
    const prof: CharacterProfile = {
      key: e.key, name: canonical, aliases: [...e.forms.keys()].filter((f) => f !== canonical).sort((a, b) => e.forms.get(b)! - e.forms.get(a)!),
      gender: null, genderConfidence: 0, age: null, nationality: null, accent: null, physicalDescriptions: [], vocalDescriptions: [], personality: [], evidence: [],
      importance: "minor", mentionCount: total, lineCount: 0, characterConfidence: Math.min(1, 0.4 + Math.log10(total + 1) * 0.3 + Math.max(0, personSignal.get(e.key) ?? 0) * 0.02), firstBlock: Math.min(...e.mentions.map((m) => m.block), endBlock),
    };
    inferAttributes(e, prof);
    profiles.push(prof);
  }
  // Drop entities that look like places/objects: no gender evidence, no speech signal, low counts
  const kept = profiles.filter((p) => p.mentionCount >= 3 || p.genderConfidence > 0 || (personSignal.get(p.key) ?? 0) >= 2);
  kept.sort((a, b) => b.mentionCount - a.mentionCount);
  return kept;
}

function sum(m: Map<string, number>): number {
  let n = 0;
  for (const v of m.values()) n += v;
  return n;
}

function pickCanonical(e: Entity): string {
  // Prefer the most complete frequently-used form: "First Last" > "Title Last" > most frequent
  const forms = [...e.forms.entries()];
  const full = forms.filter(([f]) => {
    const p = nameParts(f);
    return p.given.length && p.surname && !p.title;
  });
  if (full.length) return full.sort((a, b) => b[1] - a[1])[0][0];
  const titled = forms.filter(([f]) => nameParts(f).title);
  const [top] = forms.sort((a, b) => b[1] - a[1])[0];
  if (titled.length && !e.given) return titled.sort((a, b) => b[1] - a[1])[0][0];
  return top;
}

function inferAttributes(e: Entity, prof: CharacterProfile) {
  let male = 0;
  let female = 0;
  const ageVotes = new Map<string, number>();
  const seen = new Set<string>();
  const addEvidence = (attribute: string, value: string, quote: string) => {
    const k = `${attribute}:${value.toLowerCase()}`;
    if (seen.has(k) || prof.evidence.length > 40) return;
    seen.add(k);
    prof.evidence.push({ attribute, value, quote: quote.length > 220 ? quote.slice(0, 217) + "…" : quote });
  };
  for (const g of e.titleGenders) {
    if (g === "male") male += 3;
    else female += 3;
  }
  const namesRe = new RegExp(`\\b(${[...e.forms.keys()].map(escapeRe).join("|")})\\b`);
  for (const m of e.mentions) {
    if (m.inQuote) continue;
    const s = m.sentence;
    const after = s.slice(m.posInSentence + m.name.length);
    const tail = after.slice(0, 120);
    // Pronoun following the name within the same sentence (subject continuity)
    // Subject/possessive pronouns continue the named subject; object pronouns (him/her) usually refer to someone else.
    // Only the nearest following subject pronoun is informative; later pronouns often switch subject.
    const firstPron = tail.match(/\b(he|his|himself|she|herself)\b/i)?.[1]?.toLowerCase();
    if (firstPron === "he" || firstPron === "his" || firstPron === "himself") male += 1;
    else if (firstPron === "she" || firstPron === "herself") female += 1;
    // "NAME was a young Nigerian woman"
    const noun = after.match(/^\s*(?:,\s*)?(?:was|is|were|being|the|a|an|,)?\s*(?:(?:a|an|the)\s+)?(?:[a-z-]+\s+){0,3}(man|woman|boy|girl|gentleman|lady|father|mother|husband|wife|son|daughter|brother|sister|uncle|aunt|king|queen|prince|princess|lad|lass|widow|widower|grandfather|grandmother|nephew|niece|maid|nurse|governess|priest|monk|nun)\b/i);
    if (noun) {
      const g = GENDERED[noun[1].toLowerCase()];
      if (g === "male") male += 2;
      else if (g === "female") female += 2;
      addEvidence("gender", g, s);
    }
    const possNoun = s.match(new RegExp(`\\b(his|her)\\s+(?:\\w+\\s+)?(?:${escapeRe(m.name)})`, "i"));
    void possNoun;
    // Age
    for (const [re, bucket] of AGE_PATTERNS) {
      const am = s.match(re);
      if (!am) continue;
      const near = Math.abs(s.indexOf(am[0]) - m.posInSentence) < 90;
      if (!near) continue;
      let val = bucket;
      if (bucket === "__num__") {
        const raw = (am[1] ?? am[2] ?? am[3] ?? am[4] ?? am[5] ?? "").toLowerCase();
        const n = /^\d+$/.test(raw) ? Number(raw) : AGE_WORDS[raw] ?? 30;
        val = n < 13 ? "child" : n < 18 ? "teen" : n < 30 ? "young adult" : n < 55 ? "adult" : "older adult";
      }
      ageVotes.set(val, (ageVotes.get(val) ?? 0) + 1);
      addEvidence("age", val, s);
      break;
    }
    // Accent / nationality
    const ac = after.match(ACCENT_RE);
    if (ac && (ac.index ?? 0) < 160) {
      const val = ac[1].charAt(0).toUpperCase() + ac[1].slice(1).toLowerCase();
      if (!prof.accent && new RegExp(DEMONYMS, "i").test(val)) prof.accent = val;
      addEvidence("accent", val, s);
    }
    const nat = after.match(NATIONALITY_RE) ?? s.match(NATIONALITY_APPOS_RE);
    if (nat && Math.abs((nat.index ?? 0) - (after === s ? m.posInSentence : 0)) < 60) {
      const val = nat[1];
      if (!prof.nationality) prof.nationality = val;
      addEvidence("nationality", val, s);
    }
    // Voice
    const v = s.match(VOICE_RE) ?? s.match(VOICE_POST_RE);
    if (v && (/\b(his|her|the|a|an)\s+\w*\s*(voice|tone)/i.test(s) || /voice/i.test(s))) {
      const adj = (v[1].match(/^(voice|tone)$/i) ? v[2] : v[1]).toLowerCase().split(/,?\s+(?:and\s+)?/).filter((x) => x && x !== "and");
      for (const a of adj) {
        if (!prof.vocalDescriptions.includes(a) && prof.vocalDescriptions.length < 6) prof.vocalDescriptions.push(a);
        addEvidence("voice", a, s);
      }
    }
    const sv = tail.match(/^[,\s]*(drawled|boomed|whispered|rasped|growled|croaked|bellowed|murmured|squeaked|purred|barked)\b/i);
    if (sv) {
      const style = SPEECH_STYLE_VERBS[sv[1].toLowerCase()];
      if (style && !prof.vocalDescriptions.includes(style) && prof.vocalDescriptions.length < 6) {
        prof.vocalDescriptions.push(style);
        addEvidence("voice", style, s);
      }
    }
    // Physical (must be within the clause containing the name)
    const clause = clauseAround(s, m.posInSentence);
    const ph = clause.match(PHYSICAL_RE);
    if (ph && prof.physicalDescriptions.length < 8) {
      const val = ph[1].toLowerCase();
      if (!prof.physicalDescriptions.includes(val)) prof.physicalDescriptions.push(val);
      addEvidence("appearance", val, s);
    }
    const pe = clause.match(PERSONALITY_RE);
    if (pe && prof.personality.length < 8 && /\b(was|is|seemed|being|so|very|rather|a|an|too|always|such)\s+(?:\w+\s+)?$/i.test(clause.slice(0, clause.indexOf(pe[0])))) {
      const val = pe[1].toLowerCase();
      if (!prof.personality.includes(val)) prof.personality.push(val);
      addEvidence("personality", val, s);
    }
  }
  if (ageVotes.size) prof.age = [...ageVotes.entries()].sort((a, b) => b[1] - a[1])[0][0];
  const tot = male + female;
  if (e.titleGenders.size === 1) {
    // An explicit gendered title (Mr/Mrs/Lady/Sir/…) is decisive.
    prof.gender = [...e.titleGenders][0];
    prof.genderConfidence = 0.95;
    addEvidence("gender", prof.gender, `Addressed as “${[...e.forms.keys()].find((f) => nameParts(f).title) ?? e.key}”`);
  } else if (tot >= 2 && Math.abs(male - female) / tot > 0.34) {
    prof.gender = male > female ? "male" : "female";
    prof.genderConfidence = Math.min(0.99, Math.abs(male - female) / tot * (1 - 1 / (tot + 1)) + 0.1);
    if (!seen.has(`gender:${prof.gender}`)) {
      const q = e.mentions.find((m) => !m.inQuote && new RegExp(prof.gender === "male" ? "\\b(he|his|him)\\b" : "\\b(she|her)\\b", "i").test(m.sentence.slice(m.posInSentence)));
      if (q) addEvidence("gender", prof.gender, q.sentence);
    }
  }
}

function clauseAround(s: string, pos: number): string {
  const start = Math.max(s.lastIndexOf(";", pos), s.lastIndexOf(". ", pos), 0);
  let end = s.indexOf(";", pos);
  if (end === -1) end = s.length;
  return s.slice(start, Math.min(end, pos + 160));
}

export function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Assign importance tiers from mention + dialogue counts. */
export function rankImportance(profiles: CharacterProfile[], totalWords: number): void {
  const scored = profiles.map((p) => ({ p, score: p.mentionCount + p.lineCount * 2 }));
  scored.sort((a, b) => b.score - a.score);
  const top = scored[0]?.score ?? 1;
  const perThousand = (n: number) => (n / Math.max(1, totalWords)) * 1000;
  scored.forEach(({ p, score }, i) => {
    if ((i < 8 && score >= Math.max(8, top * 0.12)) || (p.lineCount >= 15 && perThousand(p.mentionCount) > 0.5)) p.importance = "major";
    else if (score >= Math.max(4, top * 0.03) || p.lineCount >= 4) p.importance = "supporting";
    else p.importance = "minor";
  });
}
