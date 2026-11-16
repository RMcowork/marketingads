# The kickoff message

This is the first message your service sends into a new session. The agent is generic. Everything that makes the ad about this business arrives here, as data, in three blocks.

## Template

```text
<brand_sheet>
{{ the full text of prompts/brand-sheet.md }}
</brand_sheet>

<facts>
Today: {{ weekday }} {{ YYYY-MM-DD }}. Time zone: {{ IANA time zone }}.
Branch: {{ the branch this owner manages, or "all branches" }}
Opening hours: {{ hours for that branch, from your records }}
Products and prices: {{ name and price, from your records }}
</facts>

<request>
{{ the owner's WhatsApp text, word for word }}
</request>
```

Three rules for whoever fills it in:

1. **`<facts>` comes from your database, never from the message.** The service looks up prices and hours with a query. These are the only business facts the agent may state, so a missing fact means a missing claim, which is the safe direction.
2. **Always send today's date.** The model does not know what day it is. Without the date it cannot work out what "Friday" means.
3. **`<request>` is copied, not cleaned.** Do not translate, correct or summarise the owner's words. The agent answers in the language it finds there.

## Filled example

The branch, hours and prices are placeholder data for MeatLocker until the owner supplies the real ones.

```text
<brand_sheet>
... prompts/brand-sheet.md goes here ...
</brand_sheet>

<facts>
Today: Wednesday 2026-11-11. Time zone: Asia/Jerusalem.
Branch: Tel Aviv
Opening hours: Sunday to Thursday 12:00-23:00, Friday 12:00-17:00, Saturday 19:00-23:00.
Products and prices: Mushroom Burger ₪56, Double Cheeseburger ₪62, Smash Onion Burger ₪54, Bacon Burger ₪64, Fries ₪18, Milkshake ₪24, Soft drink ₪12.
</facts>

<request>
מודעה ליום שישי: דאבל צ׳יזבורגר, 2 ב-100, תל אביב
</request>
```

## The revision message

When the owner answers a draft, send their reply into the **same session**. The agent still remembers the brand sheet, the facts and its last brief, so the message is tiny.

```text
<reply>
{{ the owner's WhatsApp reply, word for word }}
</reply>
```

Examples of replies the agent handles: "קצר יותר", "another image", "make it about the bacon burger", "בלי אימוג'י".

Two replies never reach the agent, because the service answers them itself:

| The owner writes | The service does |
|---|---|
| `ok` or `👍` | Marks the job approved and replies "Saved." Nothing is posted for her. |
| `stop` | Closes the job. The next message starts a new session. |

## What the service answers to `submit_ad_brief`

The tool result is plain text, and it is a prompt too: the agent reads it and acts on it. Keep it short and specific.

```text
accepted
```

```text
rejected
- copy.caption is 688 characters. The limit is 600.
- copy.caption states "₪95", which is not in facts_used. Use only prices from <facts> or <request>.
- image.scene is in Hebrew. Write the scene in English.
```

Name the field, say what is wrong and say what would be right. "Invalid brief" teaches the agent nothing and costs you another round.
