/* On-demand Japanese analysis. Passage text stays inside this worker. */
const CDN = "https://cdn.jsdelivr.net/npm/kuromoji@0.1.2/";
const KANJI_DATA = "https://cdn.jsdelivr.net/gh/davidluzgouveia/kanji-data@00fd7079c3890f430759536f91aa5e854ec0ca4f/kanji.json";
let resources;
// kuromoji's path.join collapses https:// into https:/ before opening each
// dictionary file. Repair only its pinned CDN prefix inside this worker.
const malformedDictionaryPrefix = "https:/cdn.jsdelivr.net/npm/kuromoji@0.1.2/dict/";
const correctDictionaryPrefix = `${CDN}dict/`;
const originalOpen = XMLHttpRequest.prototype.open;
XMLHttpRequest.prototype.open = function (method, url, ...args) {
  const fixed = typeof url === "string" && url.startsWith(malformedDictionaryPrefix)
    ? correctDictionaryPrefix + url.slice(malformedDictionaryPrefix.length)
    : url;
  return originalOpen.call(this, method, fixed, ...args);
};
function loadResources() {
  if (!resources) resources = (async () => {
    importScripts(`${CDN}build/kuromoji.js`);
    const [tokenizer, dictionary] = await Promise.all([
      new Promise((resolve, reject) => kuromoji.builder({ dicPath: `${CDN}dict/` }).build((error, result) => error ? reject(error) : resolve(result))),
      fetch(KANJI_DATA).then(response => { if (!response.ok) throw new Error("Kanji dictionary download failed"); return response.json(); }),
    ]);
    return { tokenizer, dictionary };
  })().catch(error => { resources = null; throw error; });
  return resources;
}
function hiragana(text) {
  return text.replace(/[\u30a1-\u30f6]/g, character => String.fromCharCode(character.charCodeAt(0) - 0x60));
}
self.onmessage = async ({ data }) => {
  try {
    const { tokenizer, dictionary } = await loadResources();
    const counts = new Map();
    for (const character of data.text) {
      if (!/\p{Unified_Ideograph}/u.test(character)) continue;
      counts.set(character, (counts.get(character) || 0) + 1);
    }
    let previous = null, rank = 0;
    const ranking = [...counts].sort((a, b) => b[1] - a[1]).map(([character, count], index) => {
      if (count !== previous) rank = index + 1;
      previous = count;
      const entry = dictionary[character] || {};
      const readings = [...(entry.readings_on || []), ...(entry.readings_kun || [])].slice(0, 6).map(hiragana);
      return { character, count, rank, meaning: (entry.meanings || []).slice(0, 3).join('; '), reading: readings.join(' · ') };
    });
    const tokens = tokenizer.tokenize(data.text).map(token => ({
      surface: token.surface_form,
      reading: token.reading && token.reading !== '*' ? hiragana(token.reading) : '',
      unknown: token.word_type === 'UNKNOWN' && /\p{Unified_Ideograph}/u.test(token.surface_form),
    }));
    self.postMessage({ id: data.id, tokens, ranking });
  } catch (error) {
    self.postMessage({ id: data.id, error: String(error.message || error) });
  }
};
