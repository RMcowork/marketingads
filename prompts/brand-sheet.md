# Brand sheet: MeatLocker

> **Draft written from the logo and four product photos in `Clients/MeatLocker/`.** The voice, audience and rules below are a sensible starting point, not something the owner has approved. Confirm every line with the owner before running this for real.

The service pastes this file, unchanged, into the `<brand_sheet>` block of every kickoff message. It is data, not code. The owner can edit it without anyone touching the agent.

## Who we are

MeatLocker, a burger restaurant. The logo is a maroon circle with a cream "ml!" and the name in maroon and tan. Thick patties, seared hard, in a shiny brioche bun, with melted cheese, caramelised onions, pickles and sauce. Three burgers lead the menu: the Mushroom Burger, the Double Cheeseburger and the Smash Onion Burger.

## Who we talk to

Young people, teens and twenty-somethings from Mevaseret Zion and the area: friends meeting after school or the army, late-night cravings, a Thursday-night treat, a Friday-noon stop. They want a proper burger, scroll fast and decide fast, so the ad says what it is and where.

## Voice

- Street-style, for young people: loud, quick and a little cheeky. A friend texting "come eat", not a brochure.
- Casual spoken Hebrew with light slang is fine ("אחי", "בואו על זה"), as long as it stays friendly and clean. No swearing, and no grand adjectives.
- Short, punchy sentences. Name the burger, say what is in it, then stop.
- Hebrew by default. English or Arabic only when the owner writes the request in that language, and then the copy is in that language. Burger names stay in English, as they are on the menu.
- In Hebrew, speak to the reader in the plural: "בואו", "תבואו רעבים".
- At most one emoji in a post. One exclamation mark at most.
- Describe the food by what is on it: melted cheese, caramelised onions, pickles, a seared patty. Do not describe it with grand adjectives.

## Example posts

Four posts in the voice we want. They show tone, length and rhythm only. The prices, hours and ingredients in them are not facts: an ad may state only what is in `<facts>` and `<request>`. Never copy a number from an example.

**1. A burger and a day**
Headline: שני פטיס. גבינה נמסה.
Post: שני פטיסים צרובים, גבינה שנמסה על הכול, מלפפון חמוץ ובצל מקורמל בתוך לחמנייה מבריוש. שישי בצהריים במבשרת ציון. בואו רעבים.
Call to action: יום שישי, מבשרת ציון, מ-12:00
Hashtags: #MeatLocker #המבורגר #מבשרתציון

**2. A burger that sells itself**
Headline: פטריות, בצל, פטיס
Post: פטריות מוקפצות, בצל מקורמל, רוטב שמנת וירוקים טריים על פטיס צרוב. זה כל הסיפור. נתראה ביום חמישי.
Call to action: יום חמישי, מבשרת ציון
Hashtags: #MeatLocker #המבורגר #פטריות

**3. A price, said plainly**
Headline: סמאש אוניון. ₪54.
Post: פטיס מעוך, ערימת בצל מקורמל, גבינה נמסה ומלפפון חמוץ. ₪54, במבשרת ציון, מיום ראשון עד חמישי.
Call to action: ראשון עד חמישי, מ-12:00
Hashtags: #MeatLocker #המבורגר #סמאש

**4. A moment, then the burger** (a timely hook from the research, never invented)
Headline: משחק בערב? קודם בורגר.
Post: שני פטיסים צרובים, גבינה נמסה, בצל מקורמל ומלפפון חמוץ. בורגר אחד לפני הצפירה. ₪62, במבשרת ציון.
Call to action: יום חמישי, מבשרת ציון, עד 24:00
Hashtags: #MeatLocker #המבורגר #מבשרתציון

What they share: the burger is named in the first line, what is on it comes next, then the day and the place. One idea, no big adjectives, at most one exclamation mark and one emoji. Replace these with posts the owner really likes as soon as there are some.

## Picture style

The service turns this section into the brand layer of every image prompt (`prompts/image-brand-layer.txt`).

- The burger is the hero, in the middle of the frame, with empty counter and wall above and below it (the logo and the headline are added there). The shot list below says which angle to use.
- The four photos in `Clients/MeatLocker/` are for reference only (what the burgers are). The look of the pictures is NOT copied from them.
- Background: dark and moody. A matte charcoal-black slate counter, and a smoky wall that falls from near-black into deep oxblood maroon, with a few soft amber bokeh lights far behind. Uncluttered.
- Lighting: low-key and dramatic. A strong warm rim light from behind-left, a soft fill from the front-right, backlit amber steam. Sharp highlights on the bun glaze, the cheese and the sauce. Deep shadows and a gentle vignette.
- Colours: charcoal and oxblood base; a glossy golden-amber bun, a dark seared patty, molten yellow-orange cheese. Green and red only from ingredients the burger really has. Cream and tan only as tiny accents.
- Presentation: a tall, generous burger on a slate board or butcher paper, cheese and sauce melting and dripping, a few crumbs. Macro detail, shallow depth of field (85mm, f/2), razor-sharp burger, creamy blurred background. Fresh off the grill, juicy and a little messy, never plastic.

## Shot list

The agent picks ONE shot per ad, the one that fits the angle, and describes it in the picture scene. Do not use the same shot twice in a row when the owner asks for another picture.

1. **Hero** (the default). One burger, straight-on at eye level, centred.
2. **Cheese pull.** One burger from a slightly low angle, close, with melted cheese running down its side. For cheesy burgers.
3. **Cross-section.** One burger cut in half, the layers facing the camera. For "what is in it" posts.
4. **Two burgers.** Two different burgers side by side, for a two-burger offer or a "which one" post.
5. **In hand.** One hand holding the burger, the rest blurred. A hand only: no face, no other part of a person. For lunch and quick-bite posts.
6. **Overhead.** Looking straight down: a burger with fries and a drink on the counter. For combos and sides, and only when the request or the facts mention them.

Every shot follows these rules:
- Show only the ingredients that `<facts>` lists for that burger.
- Keep the burger in the middle of the frame. The service adds the logo at the top and the headline at the bottom, so those two strips stay empty counter and wall.
- No text, logo or lettering in the scene.

## Always

- Name the branch when the offer is for one branch.
- Name the day.
- Name the burger.

## Never

- "The best burger in town", "the juiciest", or any comparison with another restaurant or chain.
- Health claims of any kind.
- Kosher, halal, vegan or allergen statements. They are not in our facts. The menu has cheese and meat together, so never imply the food is kosher or halal, and never imply it is not. No religious-dietary wording of any kind, in any language, and no holiday or religious framing that suggests an observant kitchen.
- Bacon, pork, ham, pig or "חזיר": none is on the menu, so never mention or show them, in words or in a picture.
- "Last chance" or "today only", unless the owner wrote it himself.
- Faces of people. Other brands' logos. The MeatLocker logo drawn inside the picture: the owner adds the logo afterwards.

## Hashtags

Always `#MeatLocker`, plus up to five that fit the post. Pick from this pool, and add one that fits the day or the burger:

- Place: `#מבשרתציון` `#MevaseretZion`
- Burgers: `#המבורגר` `#בורגר` `#SmashBurger` `#CheeseBurger` `#BurgerTime`
- Mood: `#אוכלרחוב` `#בורגרחלומי` `#בואורעבים` `#CheeseMelt` `#StreetFood`
- Time: `#חמישיבורגר` `#שישיבצהריים` `#לילהבורגר`

In Arabic or English posts, use the English tags and `#MevaseretZion`.
