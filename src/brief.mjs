// Checks an ad brief the researcher agent submitted. Returns the exact text that goes back
// to the agent as the tool result: "accepted", or "rejected" plus one line per problem that
// names the field, what is wrong and what would be right (prompts/kickoff-message.md).
const LIMITS = {
  headline: 40, cta: 60, caption: 600, notes: 200, textInImageWords: 5, sceneMin: 40, sceneMax: 120, sources: 5,
  // Everything the model writes that is shown to people, put into the image prompt or sent to the reviewer has a size cap.
  angle: 300, hashtag: 60, factsUsed: 12, fact: 300, avoid: 10, avoidItem: 60, textInImageChars: 60, sourceUrl: 500, sourceNote: 200,
};
// The number in a price, so "₪62" is compared with "₪62" and never found inside "₪620" or matched by "₪6".
const amount = (price) => price.replace(/[^\d.,]/g, '').replace(/[,.]+$/, '');
const amountsIn = (text) => new Set((String(text).slice(0, 5000).match(PRICE) ?? []).map(amount));
const ASPECTS = new Set(['square', 'portrait', 'landscape']);
const HEBREW = /[֐-׿]/;
const PRICE = /₪\s?\d[\d,.]*|\d[\d,.]*\s?₪|\d[\d,.]*\s?ש["״]?ח|\d[\d,.]*\s?(?:nis|shekels?)/gi;

// Food-law and pork claims. The menu has cheese and meat together, so an ad must never claim or hint at a
// religious dietary status, and bacon and pork are not on the menu at all. Allowed only when the owner wrote
// the word in <request>; <facts> is not consulted, so it cannot unlock them.
const RELIGIOUS = /כשר(?!ון)|כשרות|הכשר|מהדרין|חלאל|kosher|kashrut|halal|كوشر|حلال/i;
const PORK = /חזיר|בייקון|\bbacon\b|\bpork\b|\bpigs?\b|\bham\b|خنزير|بيكون/i;

const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const str = (v) => (typeof v === 'string' ? v : '');
const words = (s) => norm(s).split(' ').filter(Boolean);

/** The hashtag the brand sheet marks as "Always", if any (e.g. Always `#המאפייהשלדנה`). */
export function requiredHashtag(brandSheet) {
  return /Always\s+`(#[^`\s]+)`/.exec(brandSheet ?? '')?.[1] ?? null;
}

/**
 * @param brief  the submit_ad_brief tool input
 * @param ctx    { facts, request, brandSheet }: the text blocks the agent was given
 * @returns {{ ok: boolean, problems: string[], result: string }}
 */
export function validateBrief(brief, ctx) {
  const p = [];
  const b = brief && typeof brief === 'object' ? brief : {};
  const copy = b.copy && typeof b.copy === 'object' ? b.copy : {};
  const image = b.image && typeof b.image === 'object' ? b.image : {};
  const requestHasHebrew = HEBREW.test(ctx.request ?? '');

  // language
  const lang = str(b.language).toLowerCase();
  if (!/^[a-z]{2}$/.test(lang)) p.push('language must be a two-letter code such as he or en.');
  else if (requestHasHebrew && lang !== 'he') p.push(`language is "${lang}" but the owner wrote in Hebrew. Use he and write the copy in Hebrew.`);
  else if (!requestHasHebrew && lang === 'he') p.push('language is "he" but the owner did not write in Hebrew. Match the language of the request.');

  if (!norm(b.angle)) p.push('angle is empty. State the one idea this ad is built on, in one sentence.');
  else if (str(b.angle).length > LIMITS.angle) p.push(`angle is ${str(b.angle).length} characters. The limit is ${LIMITS.angle}: one sentence.`);

  // copy
  const headline = str(copy.headline), caption = str(copy.caption), cta = str(copy.cta);
  if (!norm(headline)) p.push('copy.headline is empty.');
  else if (headline.length > LIMITS.headline) p.push(`copy.headline is ${headline.length} characters. The limit is ${LIMITS.headline}.`);
  if (!norm(caption)) p.push('copy.caption is empty.');
  else if (caption.length > LIMITS.caption) p.push(`copy.caption is ${caption.length} characters. The limit is ${LIMITS.caption}.`);
  if (!norm(cta)) p.push('copy.cta is empty.');
  else if (cta.length > LIMITS.cta) p.push(`copy.cta is ${cta.length} characters. The limit is ${LIMITS.cta}.`);
  if (requestHasHebrew && lang === 'he' && !HEBREW.test(headline + caption + cta)) p.push('The copy is not in Hebrew although language is he and the owner wrote in Hebrew.');

  const tags = Array.isArray(copy.hashtags) ? copy.hashtags.map(str).map(norm).filter(Boolean) : [];
  if (tags.length < 3 || tags.length > 6) p.push(`copy.hashtags has ${tags.length} items. Use 3 to 6 hashtags.`);
  const badTag = tags.find((t) => !t.startsWith('#') || /\s/.test(t));
  if (badTag) p.push(`copy.hashtags contains "${badTag.slice(0, 40)}". Each hashtag starts with # and has no spaces.`);
  else if (tags.some((t) => t.length > LIMITS.hashtag)) p.push(`a hashtag is longer than ${LIMITS.hashtag} characters. Use short hashtags.`);
  const must = requiredHashtag(ctx.brandSheet);
  if (must && !tags.includes(must)) p.push(`copy.hashtags must include ${must} (the brand sheet says it is always used).`);

  // facts
  const factsUsed = Array.isArray(b.facts_used) ? b.facts_used.map(str).map(norm).filter(Boolean) : [];
  const allowed = norm(`${ctx.facts ?? ''} ${ctx.request ?? ''}`);
  if (factsUsed.length > LIMITS.factsUsed) p.push(`facts_used has ${factsUsed.length} items. The limit is ${LIMITS.factsUsed}.`);
  else if (factsUsed.some((f) => f.length > LIMITS.fact)) p.push(`a facts_used entry is longer than ${LIMITS.fact} characters. List one short fact per entry.`);
  else {
    for (const f of factsUsed) {
      if (!allowed.includes(f)) p.push(`facts_used contains "${f}", which does not appear word for word in <facts> or <request>. Copy facts exactly from there.`);
    }
  }
  // Prices are compared as whole amounts: "₪6" is not covered by "₪62", and "₪10" is not covered by a request that says "₪100".
  // The text is cut first so a huge answer cannot make the pattern slow.
  const copyText = `${headline} ${caption} ${cta}`;
  const listed = amountsIn(factsUsed.join(' '));
  const fromOwner = amountsIn(ctx.request ?? '');
  for (const price of new Set((copyText.slice(0, 3000).match(PRICE) ?? []).map((m) => norm(m).replace(/[,.]+$/, '')))) {
    if (!listed.has(amount(price)) && !fromOwner.has(amount(price))) {
      p.push(`copy states "${price}", which is not in facts_used. Use only prices from <facts> or <request>, and list them in facts_used.`);
    }
  }

  // food-law and meat-type claims (brand sheet "Never"), in the copy, the hashtags and any text on the picture
  const claimText = `${copyText} ${tags.join(' ')} ${str(image.text_in_image)}`;
  const ownerText = norm(ctx.request ?? '');
  if (RELIGIOUS.test(claimText) && !RELIGIOUS.test(ownerText)) {
    p.push('The copy uses religious-dietary wording (kosher, halal or similar). Nothing in <facts> says that, and the menu has cheese and meat together. Remove it.');
  }
  if (PORK.test(claimText) && !PORK.test(ownerText)) {
    p.push('The copy mentions bacon, pork, a pig or ham. None of them is on the menu in <facts>. Remove it.');
  }

  // image
  const scene = str(image.scene);
  if ((PORK.test(scene) && !PORK.test(ownerText)) || (RELIGIOUS.test(scene) && !RELIGIOUS.test(ownerText))) {
    p.push('image.scene mentions bacon, pork, a pig, ham or a religious-dietary mark. None of them belongs in the picture. Show only ingredients from <facts>, and no stamps or symbols.');
  }
  const sceneWords = scene.match(/[A-Za-z][A-Za-z'-]*/g)?.length ?? 0;
  if (!norm(scene)) p.push('image.scene is empty.');
  else if (HEBREW.test(scene)) p.push('image.scene is in Hebrew. Write the scene in English.');
  else if (sceneWords < LIMITS.sceneMin) p.push(`image.scene has ${sceneWords} words. Write 40 to 120 words in English.`);
  else if (sceneWords > LIMITS.sceneMax) p.push(`image.scene has ${sceneWords} words. The limit is ${LIMITS.sceneMax}.`);
  if (!ASPECTS.has(image.aspect)) p.push('image.aspect must be square, portrait or landscape.');
  const tii = str(image.text_in_image);
  if (words(tii).length > LIMITS.textInImageWords) p.push(`image.text_in_image has ${words(tii).length} words. The limit is ${LIMITS.textInImageWords}, or an empty string for no text.`);
  else if (tii.length > LIMITS.textInImageChars) p.push(`image.text_in_image is ${tii.length} characters. The limit is ${LIMITS.textInImageChars}.`);
  if (!Array.isArray(image.avoid)) p.push('image.avoid must be a list (empty if nothing to avoid).');
  else if (image.avoid.length > LIMITS.avoid || image.avoid.some((a) => typeof a !== 'string' || a.length > LIMITS.avoidItem)) {
    p.push(`image.avoid must have at most ${LIMITS.avoid} short items (${LIMITS.avoidItem} characters each), all text.`);
  }

  // the rest
  if (Array.isArray(b.sources)) {
    if (b.sources.length > LIMITS.sources) p.push(`sources has ${b.sources.length} items. The limit is ${LIMITS.sources}.`);
    if (b.sources.some((s) => !s || typeof s.url !== 'string' || !/^https?:\/\//.test(s.url))) p.push('every sources entry needs a url starting with http(s).');
    else if (b.sources.some((s) => s.url.length > LIMITS.sourceUrl || /\s/.test(s.url) || (s.note != null && (typeof s.note !== 'string' || s.note.length > LIMITS.sourceNote)))) {
      p.push(`a sources entry has a url over ${LIMITS.sourceUrl} characters, a url with spaces, or a note over ${LIMITS.sourceNote} characters.`);
    }
  } else p.push('sources must be a list (empty if none).');
  if (typeof b.redraw_image !== 'boolean') p.push('redraw_image must be true or false.');
  const notes = str(b.notes_for_owner);
  if (notes.length > LIMITS.notes) p.push(`notes_for_owner is ${notes.length} characters. The limit is ${LIMITS.notes}.`);

  const ok = p.length === 0;
  return { ok, problems: p, result: ok ? 'accepted' : `rejected\n${p.map((x) => `- ${x}`).join('\n')}` };
}

/** The post text: headline, caption, call to action, hashtags, trimmed to the limit (the caller passes it). */
export function composeCaption(brief, limit = 1024) {
  const c = brief.copy ?? {};
  const parts = [norm(c.headline), String(c.caption ?? '').trim(), norm(c.cta)];
  let tags = (c.hashtags ?? []).map(norm).filter(Boolean);
  const build = () => parts.filter(Boolean).concat(tags.length ? [tags.join(' ')] : []).join('\n\n');
  let text = build();
  while (text.length > limit && tags.length) { tags = tags.slice(0, -1); text = build(); }
  return text.length > limit ? text.slice(0, limit - 1) + '…' : text;
}
