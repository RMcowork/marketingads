// Unit tests for the brief validator and caption composer. Run: npm run test:brief
import { validateBrief, composeCaption, requiredHashtag } from '../src/brief.mjs';
import { composePrompt } from '../src/image.mjs';

const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? `  (${detail})` : ''}`); };

const brandSheet = '## Hashtags\n\nAlways `#MeatLocker`, plus up to five that fit the post.';
const facts = 'Today: Wednesday 2026-11-11. Time zone: Asia/Jerusalem.\nBranch: Tel Aviv\nProducts and prices: Double Cheeseburger ₪62, Smash Onion Burger ₪54.';
const request = 'מודעה ליום שישי: דאבל צ׳יזבורגר, 2 ב-100, מבשרת ציון';
const ctx = { brandSheet, facts, request };
const scene = 'A double cheeseburger on a glossy amber brioche bun, two seared patties with melted cheese running down the sides, pickles and caramelised onions peeking out. It sits centred on a pale warm-grey stone counter in front of a mottled grey marble wall. Soft diffused light from the front-left, straight-on at eye level, the burger filling the frame.';
const good = () => ({
  language: 'he', angle: 'Friday lunch burger.',
  copy: { headline: 'דאבל צ׳יזבורגר ליום שישי', caption: 'שני פטיס צרובים וגבינה נמסה. 2 ב-100 במבשרת ציון. בואו.', cta: 'יום שישי במבשרת ציון', hashtags: ['#MeatLocker', '#המבורגר', '#תלאביב'] },
  image: { scene, aspect: 'square', text_in_image: '', avoid: [] },
  facts_used: ['Double Cheeseburger ₪62'], sources: [], redraw_image: true, notes_for_owner: '',
});

check('requiredHashtag parsed from brand sheet', requiredHashtag(brandSheet) === '#MeatLocker');
check('a good brief is accepted', validateBrief(good(), ctx).result === 'accepted');

let b = good(); b.copy.caption = 'שני דאבל צ׳יזבורגר ב-₪95 במבשרת ציון';
let v = validateBrief(b, ctx);
check('unlisted price is rejected and named', !v.ok && v.problems.some((p) => p.includes('₪95')), v.problems[0]);

b = good(); b.copy.caption = 'דאבל צ׳יזבורגר 2 ב-₪100 במבשרת ציון';
check('a price that appears in the request passes', validateBrief(b, { ...ctx, request: `${request} ₪100` }).ok);

b = good(); b.copy.caption = 'דאבל צ׳יזבורגר ₪62, במבשרת ציון. או ₪62.';
check('a listed price followed by a comma or full stop is accepted', validateBrief(b, ctx).ok, validateBrief(b, ctx).problems[0]);

b = good(); b.facts_used = ['Double Cheeseburger ₪69'];
v = validateBrief(b, ctx);
check('facts_used not found word for word is rejected', !v.ok && /facts_used contains "Double Cheeseburger ₪69"/.test(v.problems.join(' ')));

b = good(); b.copy.headline = 'א'.repeat(41);
check('headline over 40 chars is rejected', /copy.headline is 41 characters/.test(validateBrief(b, ctx).result));

b = good(); b.image.scene = 'המבורגר על השולחן';
check('Hebrew scene is rejected', /image.scene is in Hebrew/.test(validateBrief(b, ctx).result));

b = good(); b.image.scene = 'A burger on a counter.';
check('scene under 40 words is rejected', /image.scene has 5 words/.test(validateBrief(b, ctx).result));

b = good(); b.copy.hashtags = ['#המבורגר', '#תלאביב', '#שישי'];
check('missing required hashtag is rejected', /must include #MeatLocker/.test(validateBrief(b, ctx).result));

b = good(); b.copy.hashtags = ['#המבורגר', 'תלאביב', '#MeatLocker'];
check('hashtag without # is rejected', /contains "תלאביב"/.test(validateBrief(b, ctx).result));

b = good(); b.language = 'en';
check('language mismatch with a Hebrew request is rejected', /owner wrote in Hebrew/.test(validateBrief(b, ctx).result));

b = good(); b.image.text_in_image = 'one two three four five six';
check('text_in_image over 5 words is rejected', /text_in_image has 6 words/.test(validateBrief(b, ctx).result));

b = good(); b.image.aspect = 'wide';
check('bad aspect is rejected', /image.aspect must be/.test(validateBrief(b, ctx).result));

// Food-law and meat-type claims: never in the copy unless the owner wrote them.
b = good(); b.copy.caption = 'בורגר כשר במבשרת ציון. בואו.';
check('kosher wording in the copy is rejected', /religious-dietary wording/.test(validateBrief(b, ctx).result));

b = good(); b.copy.hashtags = ['#MeatLocker', '#המבורגר', '#halal'];
check('halal in a hashtag is rejected', /religious-dietary wording/.test(validateBrief(b, ctx).result));

b = good(); b.copy.caption = 'בורגר כשר במבשרת ציון. בואו.';
check('the owner writing the word in the request allows it', validateBrief(b, { ...ctx, request: `${request}, כשר` }).ok);

b = good(); b.copy.caption = 'בייקון פריך וגבינה נמסה במבשרת ציון. בואו.';
check('bacon in the copy is rejected', /mentions bacon, pork, a pig or ham/.test(validateBrief(b, ctx).result));

b = good(); b.copy.caption = 'Crispy bacon burger in Mevaseret Zion. Come hungry.';
check('English bacon in the copy is rejected', /mentions bacon, pork, a pig or ham/.test(validateBrief(b, ctx).result));

b = good(); b.copy.hashtags = ['#MeatLocker', '#המבורגר', '#bacon'];
check('bacon in a hashtag is rejected', /mentions bacon, pork, a pig or ham/.test(validateBrief(b, ctx).result));

b = good(); b.copy.caption = 'בורגר עם חזיר במבשרת ציון. בואו.';
check('pork in the copy is rejected', /mentions bacon, pork, a pig or ham/.test(validateBrief(b, ctx).result));

b = good(); b.copy.caption = 'בייקון פריך וגבינה נמסה במבשרת ציון. בואו.';
check('the owner writing the word in the request allows it', validateBrief(b, { ...ctx, request: `${request}, בייקון` }).ok);

b = good(); b.image.scene = `${scene} Crispy bacon strips lie across the top patty.`;
check('bacon in the scene is rejected', /mentions bacon, pork, a pig, ham/.test(validateBrief(b, ctx).result));

b = good(); b.image.scene = `${scene} A slab of pork belly rests beside the burger on the counter.`;
check('pork imagery in the scene is rejected', /mentions bacon, pork, a pig, ham/.test(validateBrief(b, ctx).result));

b = good(); b.image.scene = scene.replace('A double cheeseburger', 'A double hamburger');
check('"hamburger" in the scene is not mistaken for ham', validateBrief(b, ctx).ok, validateBrief(b, ctx).problems[0]);

v = validateBrief({}, ctx);
check('empty brief lists many problems in the rejected format', !v.ok && v.result.startsWith('rejected\n- ') && v.problems.length >= 8, `${v.problems.length} problems`);

const cap = composeCaption(good());
check('caption joins headline, text, cta and hashtags', cap.startsWith('דאבל צ׳יזבורגר ליום שישי\n\n') && cap.endsWith('#MeatLocker #המבורגר #תלאביב'));
b = good(); b.copy.caption = 'x'.repeat(600); b.copy.hashtags = ['#a'.repeat(1), '#b', '#c', '#dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd'];
check('caption never exceeds 1024 chars', composeCaption(b).length <= 1024, `${composeCaption(b).length}`);

const prompt = composePrompt({ scene, aspect: 'portrait', text_in_image: '', avoid: ['faces', 'logos'] });
check('image prompt has brand, scene and format layers', /burger restaurant/.test(prompt) && prompt.includes(scene) && /Vertical composition/.test(prompt) && /No text, letters/.test(prompt) && /Do not include: faces, logos\./.test(prompt));
const prompt2 = composePrompt({ scene, aspect: 'square', text_in_image: 'שבת שלום', avoid: [] });
check('text_in_image switches the format layer', /Render this text once, exactly as written, large and clearly legible: "שבת שלום"/.test(prompt2) && !/Do not include/.test(prompt2));

const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
