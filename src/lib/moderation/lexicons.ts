/**
 * Diccionarios de insultos y agresiones verbales por idioma (detección local, sin IA).
 *
 * - `strong`: palabras ofensivas por sí mismas → derivan salvo negación, cita o exclusión.
 * - `mild`: palabras ambiguas o con otros usos ("burro de arranque", "carne de cerdo",
 *   "pedido retrasado", "bolsas de basura") → solo derivan si van dirigidas al interlocutor
 *   ("sos un …", "you are …", "seu …") o si el mensaje es prácticamente solo el insulto.
 * - `phrases`: expresiones de varias palabras (insultos compuestos, amenazas). Derivan siempre
 *   (salvo cita entre comillas).
 * - `safePhrases`: expresiones que contienen palabras de la lista pero no son insultos.
 *
 * Las entradas van en minúsculas y sin tildes; el detector normaliza igual el texto y las listas.
 * Ampliar la cobertura sin tocar el núcleo: agregar un idioma a LEXICONS, o términos extra
 * por bot (config.handoff.extraInsultTerms / ignoredInsultTerms).
 *
 * Cuidado con colisiones entre idiomas: una palabra común en otro idioma no puede ser `strong`
 * (p. ej. el francés "con" es la preposición española "con"; por eso solo se usa en frases).
 */
export type Lexicon = {
  lang: string;
  label: string;
  strong: string[];
  mild: string[];
  phrases: string[];
  safePhrases: string[];
  /** Indicadores de segunda persona: el término `mild` debe aparecer poco después de uno. */
  directedCues: string[];
  /** Negaciones: anulan una coincidencia de una sola palabra que aparece poco después. */
  negations: string[];
  /** Verbos de cita/relato ("me dijo idiota"): anulan términos `mild` cercanos. */
  reportCues: string[];
};

const es: Lexicon = {
  lang: "es",
  label: "Español",
  strong: [
    "pelotudo", "pelotuda", "boludazo", "gilipollas", "cabron", "cabrona", "imbecil", "estupido", "estupida", "idiota", "mogolico", "mogolica",
    "subnormal", "hdp", "hdlgp", "conchudo", "conchuda", "malparido", "malparida", "hijueputa", "huevon", "huevona", "culiao", "culiado",
    "carajo", "mierda", "chupapija", "chupapijas", "pajero", "pajera", "trolo", "maricon", "garca", "garcas", "sorete", "soretes",
  ],
  mild: [
    "boludo", "boluda", "gil", "gila", "salame", "nabo", "bobo", "boba", "tonto", "tonta", "payaso", "payasa", "animal", "bestia", "burro", "burra",
    "cerdo", "cerda", "basura", "chanta", "chantas", "inepto", "inepta", "incompetente", "incompetentes", "sinverguenza", "sinverguenzas",
    "estafa", "estafador", "estafadora", "estafadores", "ladron", "ladrona", "ladrones", "chorro", "chorra", "chorros", "rata", "ratas",
    "puto", "puta", "putos", "putas", "perra", "zorra", "pendejo", "pendeja", "tarado", "tarada", "retrasado", "retrasada", "baboso", "babosa",
    "inutil", "inutiles", "cagon", "cagona", "forro", "forra",
  ],
  phrases: [
    "hijo de puta", "hija de puta", "hijos de puta", "la concha de tu madre", "la concha de la lora", "la puta que te pario", "la puta madre que te pario",
    "andate a la mierda", "vete a la mierda", "vayanse a la mierda", "anda a cagar", "andate a cagar", "vete al carajo", "andate al carajo",
    "chupame la pija", "metetelo en el culo", "me cago en tu", "me cago en vos", "me cago en ustedes", "te voy a matar", "los voy a matar",
    "te voy a cagar a trompadas", "te voy a romper la cara", "manga de chorros", "manga de inutiles", "manga de ladrones", "son unos chorros",
    "son unos ladrones", "son unos estafadores", "son una estafa", "pedazo de mierda", "pedazo de idiota", "pedazo de imbecil", "forro de mierda",
  ],
  safePhrases: ["de puta madre", "burro de arranque", "carne de cerdo", "bolsa de basura", "bolsas de basura", "cesto de basura", "tacho de basura"],
  directedCues: ["sos", "eres", "son", "sois", "vos", "tu", "te", "usted", "ustedes", "che", "pedazo", "manga", "flor", "tremendo", "tremenda", "unos", "unas"],
  negations: ["no", "ni", "nunca", "jamas", "tampoco", "sin"],
  reportCues: ["dijo", "dijeron", "dice", "dicen", "llamo", "llamaron", "trato", "trataron", "decir", "palabra", "significa", "escribio"],
};

const en: Lexicon = {
  lang: "en",
  label: "English",
  strong: ["fuck", "fucking", "fucker", "motherfucker", "shit", "bullshit", "asshole", "bitch", "bastard", "cunt", "dickhead", "prick", "wanker", "twat", "retard", "retarded", "moron", "idiot", "imbecile", "scumbag", "douchebag", "jackass", "whore", "slut"],
  mild: ["stupid", "dumb", "dumbass", "loser", "useless", "clown", "pathetic", "trash", "garbage", "incompetent", "liar", "liars", "fool", "jerk", "scam", "scammer", "scammers", "thief", "thieves", "crook", "crooks", "dick"],
  phrases: ["fuck you", "fuck off", "screw you", "go to hell", "piece of shit", "son of a bitch", "shut up", "kill you", "i will kill", "go fuck yourself", "you suck", "you people suck", "bunch of thieves", "bunch of crooks", "bunch of idiots"],
  safePhrases: ["garbage bag", "garbage bags", "trash bag", "trash bags", "trash can", "garbage can"],
  directedCues: ["you", "youre", "your", "ur", "u", "such", "yall"],
  negations: ["not", "no", "never", "isnt", "arent", "dont", "wasnt", "without"],
  reportCues: ["said", "called", "says", "word", "means", "meaning", "wrote", "told"],
};

const pt: Lexicon = {
  lang: "pt",
  label: "Português",
  strong: ["porra", "caralho", "merda", "viado", "arrombado", "arrombada", "babaca", "otario", "otaria", "imbecil", "idiota", "corno", "cuzao", "desgracado", "desgracada", "fdp"],
  mild: ["burro", "burra", "estupido", "estupida", "palhaco", "lixo", "inutil", "incompetente", "mentiroso", "mentirosa", "trouxa", "golpe", "golpista", "golpistas", "ladrao", "ladroes", "safado", "safada", "vagabundo", "vagabunda", "puta", "puto"],
  phrases: ["filho da puta", "filha da puta", "vai se foder", "vai tomar no cu", "vai a merda", "pau no cu", "vou te matar", "bando de ladroes", "seu merda", "sua merda"],
  safePhrases: ["saco de lixo", "sacos de lixo"],
  directedCues: ["voce", "voces", "vc", "seu", "sua", "seus", "suas", "tu", "te", "bando", "sao"],
  negations: ["nao", "nem", "nunca", "jamais", "sem"],
  reportCues: ["disse", "disseram", "diz", "chamou", "chamaram", "palavra", "significa"],
};

const it: Lexicon = {
  lang: "it",
  label: "Italiano",
  strong: ["cazzo", "stronzo", "stronza", "vaffanculo", "coglione", "cogliona", "puttana", "bastardo", "bastarda", "imbecille", "deficiente", "minchia"],
  mild: ["stupido", "stupida", "scemo", "scema", "cretino", "cretina", "incompetente", "inutile", "pagliaccio", "truffa", "ladro", "ladri", "truffatore", "truffatori"],
  phrases: ["figlio di puttana", "va a fare in culo", "vai a quel paese", "ti ammazzo", "pezzo di merda"],
  safePhrases: [],
  directedCues: ["sei", "siete", "tu", "ti", "voi", "brutto", "brutta"],
  negations: ["non", "mai", "senza", "neanche"],
  reportCues: ["detto", "chiamato", "parola", "significa"],
};

const fr: Lexicon = {
  lang: "fr",
  label: "Français",
  strong: ["putain", "connard", "connasse", "salaud", "salope", "encule", "enculee", "batard", "abruti", "abrutie", "pute"],
  mild: ["idiote", "stupide", "nul", "nulle", "imbecile", "incompetent", "incompetente", "minable", "arnaque", "voleur", "voleurs", "escroc", "escrocs", "debile"],
  phrases: ["fils de pute", "va te faire foutre", "ta gueule", "ferme ta gueule", "nique ta mere", "je vais te tuer", "bande de voleurs", "bande de cons", "espece de con", "sale con", "pauvre con", "petit con"],
  safePhrases: [],
  directedCues: ["vous", "etes", "espece", "sale", "bande", "toi", "t"],
  negations: ["pas", "jamais", "sans"],
  reportCues: ["appele", "traite", "mot", "signifie"],
};

const de: Lexicon = {
  lang: "de",
  label: "Deutsch",
  strong: ["scheisse", "arschloch", "wichser", "fotze", "hurensohn", "hure", "schlampe", "missgeburt", "vollidiot", "spast"],
  mild: ["dumm", "blod", "doof", "trottel", "depp", "unfahig", "nutzlos", "versager", "abzocke", "betruger", "dieb", "diebe"],
  phrases: ["fick dich", "leck mich", "halt die fresse", "halts maul", "ich bring dich um", "verpiss dich"],
  safePhrases: [],
  directedCues: ["du", "bist", "ihr", "seid"],
  negations: ["nicht", "kein", "keine", "nie", "niemals", "ohne"],
  reportCues: ["gesagt", "genannt", "wort", "bedeutet"],
};

/** Idiomas cubiertos y verificados por pruebas (tests/unit/insults.test.ts). */
export const LEXICONS: Lexicon[] = [es, en, pt, it, fr, de];
