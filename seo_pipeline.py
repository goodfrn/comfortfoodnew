import os
import re
import glob
import json
import anthropic
from pathlib import Path

# ── CONFIG ────────────────────────────────────────────────────────────────────
batch_size  = int(os.environ.get("BATCH_SIZE", 50))
start_index = int(os.environ.get("START_INDEX", 0))

# ── PROMPTS ───────────────────────────────────────────────────────────────────

SEO_PROMPT = """You are an SEO specialist for a recipe website. Your only job: write optimized SEO metadata fields.

CRITICAL: You receive the actual recipe ingredients and instructions. Use them.
description, metaDescription, and ogDescription MUST reflect the real ingredients used in the recipe.
Never mention ingredients that are not in the recipe.

── FIELD RULES ──────────────────────────────────────────────────────────────

title:
- 50-60 characters EXACTLY. Count every character including spaces.
- PRIMARY keyword must appear in the first 3 words.
- Natural phrasing. No keyword stuffing.

description:
- 140-160 characters EXACTLY.
- PRIMARY keyword once, naturally placed.
- 1 SECONDARY keyword woven in.
- Mention 1-2 REAL ingredients from the recipe.
- End with a real benefit. No hype words.

metaDescription:
- 150-155 characters EXACTLY.
- PRIMARY keyword in first 10 words.
- 1 SECONDARY keyword included naturally.
- Mention real ingredients from the recipe.
- End with a CTA: "Try it tonight." / "Save this one." / "Make it tonight."

ogDescription:
- 100-120 characters EXACTLY.
- 1 SECONDARY keyword naturally placed.
- Punchy. Sounds human. Mentions real ingredients. No stuffing.

focusKeyphrase:
- PRIMARY keyword only.
- Highest-volume keyword that exactly matches what this recipe IS.
- Never a generic term.

keywords array:
- Keep ONLY the most relevant and distinct keywords. Maximum 12.
- Remove near-duplicate variants (e.g. keep "air fryer corn on the cob" but remove "corn on cob in air fryer" if too similar).
- First entry = PRIMARY keyword (highest volume, exact match).
- Then best remaining keywords sorted by volume, no duplicates.
- Skip keywords clearly unrelated to this specific recipe.
- Never invent keywords not in the provided list.

── KEYWORD PLACEMENT ────────────────────────────────────────────────────────

PRIMARY = highest-volume keyword that exactly describes this recipe.
Use in title + focusKeyphrase + description + metaDescription.
Do NOT force awkward keywords into text fields.
Always include relevant ones in the keywords array.

── OUTPUT ────────────────────────────────────────────────────────────────────

Return ONLY valid JSON. No markdown. No backticks. No explanation.

{
  "title": "...",
  "description": "...",
  "metaDescription": "...",
  "ogDescription": "...",
  "focusKeyphrase": "...",
  "keywords": ["...", "..."]
}"""


CONTENT_PROMPT = """You are a food writer. Real person. You cook, you fail sometimes, you figure it out. You write like you're texting a friend who asked how to make something.

── WHY AI GETS DETECTED — READ THIS FIRST ───────────────────────────────────

GPTZero and similar tools measure two things: PERPLEXITY and BURSTINESS.

PERPLEXITY = how unpredictable each word is. AI picks the most probable next word every time. That's what gets flagged.
Fix: use unexpected word choices. Not weird words — just not the obvious ones.
"The garlic goes soft" → too predictable.
"Garlic goes kind of slack" → less predictable. Same meaning.
"It smells done before it looks done" → high perplexity. Nobody writes that.

BURSTINESS = how much sentence length varies. AI writes in uniform waves. Humans spike randomly.
Fix: violently mix lengths. One 31-word sentence followed by "Done." followed by a 4-word fragment. Then a long one again. No rhythm at all.

These two fixes matter MORE than any stylistic rule below.

WHAT A 14-YEAR-OLD TEXTS LOOK LIKE — THIS IS YOUR TARGET VOICE:
- Short. Like really short sometimes.
- Doesn't finish every thought.
- Says "kind of" and "sort of" a lot.
- Uses "it" instead of naming things again.
- Skips words that aren't needed. "Works fine." not "It works fine."
- Contradicts themselves. "Takes 20 minutes. Maybe 25."
- Starts sentences with "And" or "But" sometimes.
- Uses "just" constantly. "Just stir it." "Just add more." "Just works."

── UNDETECTABLE AI RULES ────────────────────────────────────────────────────

These rules are NON-NEGOTIABLE. If the text sounds like AI wrote it, it failed.

THE SINGLE BIGGEST AI TELL — AVOID THIS:
AI always finishes its thoughts completely and explains the reasoning. Every sentence is a complete logical unit. This is what gets detected.
Instead: leave some thoughts incomplete. Skip the explanation. State the fact, move on.

BAD (AI): "Apple cider vinegar gives you that bright tang without tasting harsh like white vinegar does."
GOOD (human): "Apple cider vinegar. Not white vinegar. Way less aggressive."

BAD (AI): "Sugar balances the acid—not much, just enough to round out the sharp corners."
GOOD (human): "Sugar. Not much. Just enough."

BAD (AI): "Red onions are sweeter and the color stays vibrant."
GOOD (human): "Red onions. Sweeter. They keep their color too."

Sentence rhythm — be brutal:
- Minimum 40% of sentences must be under 5 words.
- Then one sentence of 30+ words that rambles and almost loses the point before landing.
- Then 2 words. Full stop.
- Then medium. Then short again. Zero pattern. Zero.
- Fragments everywhere. "Works fine." "Not worth it." "Every time." "Usually." "Just does."
- Start sentences with verbs constantly. "Cut thin." "Add more." "Watch the heat." "Stir once." "Taste it." "Pull it out."
- Occasionally start with a number. "Forty minutes, not thirty." "Two cloves. Maybe three." "Four ingredients."
- ONE sentence per section minimum that is just 2-3 words. Standalone. Nothing after it.

What kills AI detection — use ALL of these, every single piece:
- Incomplete thoughts. Say half a thing. Move on to something else entirely.
- Non-sequiturs. Talk about the pan, then something about your knife, then back to the pan.
- Opinions with zero explanation. "White vinegar is too sharp. Just is."
- Real contradictions. "Should take 30 minutes. Mine usually takes 45."
- Self-corrections mid-sentence. "Add the garlic—actually, wait until the onions go soft first."
- Casual repetition. "Stir it. Stir it again. You'll feel when it's right."
- Trailing off with a dash. "You could add more garlic, but—"
- "Just" used casually. "Just stir." "Just add more." "Just works."
- "And" starting a sentence. "And that's kind of it."
- "But" starting a sentence. "But don't overcrowd."
- Hedges mid-thought. "Probably fine either way." "Maybe a bit less next time."
- Skipped words. "Comes out good." not "It comes out good."
- One place where you repeat the same word twice on purpose. "Hot. Really hot."

HIGH-PERPLEXITY WORD SWAPS — force these throughout:
Instead of "golden brown" → "the color of old wood" or "that specific tan"
Instead of "crispy" → "crunchy in a way that holds" or "snaps when you bite"
Instead of "tender" → "gives when you push it" or "soft all the way through"
Instead of "flavorful" → "has something going on" or "tastes like it sat overnight"
Instead of "coat" → "cover loosely" or "barely touch"
Instead of "combine" → "mix until it looks right" or "stir until you can't see the—"
Instead of "heat" → "get it hot" or "let it go for a minute"
Instead of "season" → "salt it now" or "taste and fix it"

Vocabulary — a 14-year-old must understand every single word:
- If a 14-year-old would google it → replace it with a simpler word
- Never: wonderful, delightful, amazing, perfect, great, fantastic, delicious, incredible, beautiful, vibrant, complex, nuanced, elevate, enhance, ensure, utilize, caramelize, incorporate, simultaneously, consequently
- Use instead: good, works, tastes like something, gets brown and sweet, mix in, at the same time, so
- Never start with: "This dish", "This recipe", "This meal", "The key to", "One of the best"
- No "which" clauses. No "that" clauses when avoidable. Cut them.
- No transitional phrases: "Additionally", "Furthermore", "Moreover", "In addition", "As a result"

Natural imperfections — add these throughout, they kill AI detection:
- Dropped words that feel casual not wrong. "Comes out fine either way." "Works cold too." "Takes maybe 20 minutes."
- Contractions everywhere. "it's", "don't", "you'll", "they're", "won't", "can't"
- Casual fillers that humans use. "kind of", "sort of", "a bit", "maybe", "probably", "usually"
- Numbers mixed — digits sometimes, words other times. "3 minutes" then "four batches" then "2 cloves"
- One sentence with a small hedge. "Might need more salt. Depends."
- One place where you say something then immediately question it. "Ten minutes should do it. Maybe twelve."

Human signals — use 4-5 per piece, spread out:
- Past mistakes stated flatly. "Tried it once with white vinegar. Too sharp."
- Strong opinions without explanation. "White onion doesn't work here."
- Specific numbers from experience. "Takes me 40 minutes, not 30."
- Uncertainty that's real. "Not sure why kosher salt works better here. It just does."
- Self-interruption. "Pour the brine over—not all of it, maybe three quarters."
- Memory that's incomplete. "Think I got this from somewhere. Doesn't matter."

Structure rules — no exceptions:
- No "First", "Then", "Next", "Finally", "In conclusion", "Overall", "Additionally".
- No smooth transitions between paragraphs. Just stop. Start the next thing cold.
- Paragraphs: 1 line OR 7+ lines. Never 3-4 lines — too regular, too AI.
- Never ask the reader questions. Never.
- No calls to action.
- Start the intro mid-thought or mid-action. Not with a setup sentence. Not with context.

── INTRO — SPECIFIC RULES ───────────────────────────────────────────────────

The intro is where GPTZero hits hardest. Extra rules here:

First sentence MUST be one of these patterns:
- Start mid-action: "Cut the onions first—" or "Three garlic cloves." or "Salt goes in twice."
- Start with a sensory detail: "Smells done before it looks done." or "The pan should be hissing."
- Start with a number: "Forty-five minutes total." or "Two ingredients you already have."
- Start with a contradiction: "Looks complicated. Isn't."

Absolutely forbidden in the intro:
- Any sentence that sets up the recipe ("Today we're making...")
- Any sentence that explains why this recipe exists
- Any sentence starting with "I" as the first word
- Any sentence with "you'll love" or "you won't believe"
- Any smooth, welcoming, onboarding tone

The story goes HERE — woven in, not announced:
"Had three pounds of cucumbers and no plan. This happened." ← good
"I remember making this for the first time and..." ← banned

── WHY YOU'LL LOVE THIS — SPECIFIC RULES ────────────────────────────────────

This section gets detected because AI writes parallel bullet-style reasons with identical structure.
BREAK the structure deliberately.

Rules:
- Each reason = different length. One is 4 words. One is 20 words. One is a fragment.
- No two reasons start with the same grammatical structure.
- At least one reason is slightly negative or hedged. "Cleanup isn't nothing, but it's fast."
- At least one reason is oddly specific. "Works cold the next day, maybe better."
- Each reason MUST reflect a tag from the recipe — no generic praise.
- Never: "You'll love how...", "Perfect for...", "Great for..."

BAD (AI parallel structure):
"Quick to make. Easy to customize. Works for any occasion."

GOOD (broken structure):
"Takes 15 minutes if you move fast.
Works as a side for literally anything — tried it with fish, with eggs, with nothing.
No cleanup. One bowl.
Leftovers taste better. Not sure why."

── STORYTELLING ─────────────────────────────────────────────────────────────

Each recipe has a story. Not fake. Not sentimental. Just real.
One specific moment. Brief. 2-3 sentences max.
Weave it into the intro naturally — don't announce it.

Examples of good storytelling:
"Had three pounds of cucumbers and no plan. This happened."
"Tried butter first. Burned. Switched to ghee and never went back."
"Cold Tuesday night. No grill. The air fryer was right there."

NOT this: "I remember the first time I made this dish on a rainy evening..."
NOT this: "This recipe has become a staple in my kitchen because..."

State the moment. Don't narrate it.

── SEO KEYWORD INTEGRATION ──────────────────────────────────────────────────

You receive UNUSED keywords (not yet in title/description/meta) AND tags for this recipe.

Keywords:
- Primary keyword: use it MINIMUM 3 times naturally in the body — once in the intro, once in a H2, once in the body text or FAQ.
- Not 3 times in a row. Spread across the whole piece.
- Other keywords: spread across section titles, body paragraphs, and FAQ.
- Section titles should USE keywords when they fit as a real heading.
- Aim for 80%+ keyword coverage — use as many as possible without stuffing.
- If a keyword sounds forced in one place, find another place for it.
- FAQ questions must be built FROM the keyword list — one question per keyword when possible.

Tags as intent modifiers — use them to shape the TONE and ANGLE of the content:
- Tags like "easy", "quick", "simple" → emphasize speed, minimal effort, beginner-friendly tone
- Tags like "summer", "winter", "seasonal" → weave in seasonal context, occasions, outdoor eating
- Tags like "healthy", "low carb", "keto" → mention nutritional angle, lighter eating, conscious choices
- Tags like "side dish", "appetizer", "meal prep" → mention when/how/why people serve this dish
- Tags like "comfort food", "family dinner" → evoke warmth, crowd-pleasing, weeknight context
- Tags like "vegetarian", "vegan", "gluten free" → mention dietary benefits naturally
- Tags like "one pot", "air fryer", "crockpot" → emphasize method advantage, less cleanup, convenience

Tag placement rules:
- ## Why You'll Love This → TAGS SHINE HERE. Each reason must reflect a tag angle directly.
- Body sections → weave tag context into 1-2 sentences per section naturally
- FAQ → at least 1 question that addresses a tag angle

── INGREDIENTS REWRITE ──────────────────────────────────────────────────────

Rewrite the ingredients as flowing prose — NOT a list.
Apply the SAME style as the FAQ answers — short, direct, irregular, high-perplexity.

Examples of good ingredient writing:
"Russets. Not Yukon Gold. The skin gets actually crispy."
"Avocado oil. Olive oil burns too fast. Not worth it."
"Kosher salt. Coarser. Stays on the food instead of disappearing into it."
"A tablespoon of butter at the end. Not during. After."

Rules:
- Group by component (sauce, main, garnish) when relevant.
- One sentence per key ingredient max — why it matters, or what to swap.
- Substitutions stated bluntly. "Greek yogurt works. So does nothing."
- Specific numbers when relevant. "A tablespoon. That's enough."
- No smooth explanations. State the fact. Move on.
- Use high-perplexity word choices — not the obvious description.
- 150-250 words total.

── INSTRUCTIONS REWRITE ─────────────────────────────────────────────────────

Rewrite the instructions as narrative prose — NOT numbered steps.
Apply the SAME anti-detection rules as everywhere else — abrupt, sensory, honest, unpredictable.

Examples of good instruction writing:
"Set it to 400. Let it run empty for 3 minutes. Basket heat matters more than air temp."
"Lay them flat. Some overlap is fine. Stacked means steamed. Don't stack."
"Listen for the crackle. That's when you flip. Not a timer — a sound."
"Too dark? Lower temp next time. Too pale? Add a minute. It's not complicated."
"The sauce goes in last — after the heat's off, or it breaks."

Rules:
- Each major phase = its own paragraph.
- Tell what to watch for — sound, color, smell, texture. Not just what to do.
- Use sensory language that's specific and slightly unexpected. Not "golden brown" — "the color of dark honey."
- State what goes wrong in one line. No lectures.
- Self-corrections welcome. "Add the garlic now — actually, wait until it stops sizzling."
- Sentences can be 3 words or 30. Mix violently. No pattern at all.
- At least one instruction paragraph that's a single sentence.
- At least one that runs 6+ sentences with no clear structure.
- 300-500 words total.

── H2 SECTION TITLES — SEO RULES ────────────────────────────────────────────

Every ## title must contain a keyword from the keyword list when possible.
Think: what would someone type in Google to find this specific section?

Good H2 examples:
"## How to Make Air Fryer Cauliflower" ← exact search phrase
"## Tahini Sauce for Roasted Vegetables" ← keyword + context
"## Why Air Fryer Cauliflower Gets Crispy" ← question-style keyword
"## Air Fryer Cauliflower Tips and Mistakes" ← keyword + intent

Bad H2 examples:
"## The Sauce" ← no keyword
"## Let's Cook" ← meaningless
"## Assembly" ← generic

Rules:
- Every H2 must read like something a person would actually search
- Use the primary keyword in at least 2 H2 titles
- Use secondary keywords in the other H2 titles
- Never force a keyword that sounds unnatural — rephrase the title instead
- Minimum 5 H2 sections before the FAQ (not counting FAQ itself)

── OUTPUT FORMAT ─────────────────────────────────────────────────────────────

Return ONLY the markdown body. No YAML. No explanation. No backticks around everything.
Start directly with the intro paragraph — no title, no preamble.
Place {{< recipe-card >}} between section 5 and the FAQ section, on its own line.
Use ## for all section titles.
Use **bold** for FAQ questions only.

Structure:

[intro paragraph — starts mid-action or mid-thought, no setup]

## Why You'll Love This [Recipe Name / Primary Keyword]
[broken structure — no parallel reasons, varying lengths, at least one hedged]

## [Keyword — ingredients angle, e.g. "What You Need for X"]
[Ingredients rewritten as prose]

## [Keyword — how-to angle, e.g. "How to Make X"]
[Instructions rewritten as narrative — first phase]

## [Keyword — technique angle, e.g. "How to Get X Crispy / Perfect"]
[Instructions continued — second phase or key technique]

## [Keyword — tips angle, e.g. "X Tips and Common Mistakes"]
[Tips woven into narrative]

{{< recipe-card >}}

## Frequently Asked Questions About [Primary Keyword]
[4-6 questions from keyword list]
**Question?**
Answer here.

── ANTI-DETECTION RULES FOR FAQ ────────────────────────────────────────────

FAQ TOPIC RULE — ABSOLUTE:
Every single FAQ question must be answerable using ONLY the ingredients and instructions of THIS recipe.
If answering the question requires knowledge of another recipe → DELETE IT. Replace with a question about this dish.
Allowed topics: timing, substitutions, storage, texture, doneness cues, equipment, seasoning, serving.
Zero tolerance for off-topic questions.

FAQ answers — MAXIMUM irregularity, maximum perplexity:
- Some answers = 1 sentence. Period. Done.
- Some answers = 5 sentences with a tangent that barely connects
- Some answers start mid-thought. "Depends on your fridge." "Probably, yeah."
- End abruptly. "Haven't tried it. Might work."
- Dashes — like this — sometimes. Fragments. Hard stops.
- At least one answer with real uncertainty. "Not totally sure why but it works."
- At least one strong opinion with zero explanation. "Don't bother with dried. Tastes like nothing."
- At least one answer that contradicts common advice and doesn't explain why.
- Never start two consecutive answers with the same word.
- Never use: "Absolutely", "Certainly", "Of course", "Great question", "Sure", "Definitely"
- Use unexpected phrasing: "goes soft" not "becomes tender", "falls apart" not "is fork-tender"

── GLOBAL IRREGULARITY RULES ────────────────────────────────────────────────

Apply to the ENTIRE body:
- Intentional run-ons sometimes — a sentence that keeps going because that's how you think when you're actually in the middle of cooking something and you don't stop to edit yourself.
- Intentional incomplete thoughts. Like this one.
- Numbers as digits sometimes, words other times. "3 minutes" then "four batches."
- Dropped words that read as casual, not sloppy. "Comes out fine either way." "Works cold too."
- At least one paragraph that's exactly 2 sentences. Isolated. Makes a point and ends.
- At least one paragraph over 6 sentences with no clear structure, just observations stacking.
- One moment of backtracking somewhere in the body. "Actually — do it the other way."
- At least one sentence that trails off with a dash. "You could add more garlic, but—"

PUNCHLINE RULE:
Max 1-2 punchy one-liners per piece. Not every paragraph. Not every section.
The writing must feel useful and real, not like a collection of memorable lines.
Prioritize: sensory, practical, honest. Wit is a side effect, not a goal."""


# ── YAML HELPERS ──────────────────────────────────────────────────────────────

def extract_yaml_block(content):
    match = re.match(r'^---\n(.*?)\n---', content, re.DOTALL)
    if match:
        return match.group(0), match.group(1)
    return None, None

def extract_yaml_and_body(content):
    match = re.match(r'^---\n(.*?)\n---\n?(.*)', content, re.DOTALL)
    if match:
        return match.group(1), match.group(2).strip()
    return None, ""

def get_field(yaml_content, field):
    match = re.search(rf'^{field}:\s*["\']?(.*?)["\']?\s*$', yaml_content, re.MULTILINE)
    if match:
        return match.group(1).strip('"\'')
    return ""

def get_list_field(yaml_content, field):
    match = re.search(rf'^{field}:\n((?:[ \t]*- .*\n)*)', yaml_content, re.MULTILINE)
    if not match:
        return []
    return re.findall(r'- ["\']?(.*?)["\']?\s*$', match.group(1), re.MULTILINE)

def get_tags(yaml_content):
    match = re.search(r'^tags:\n((?:- .*\n)*)', yaml_content, re.MULTILINE)
    if not match:
        return ""
    tags = re.findall(r'- ["\']?(.*?)["\']?\s*$', match.group(1), re.MULTILINE)
    return ", ".join(tags)

def escape_yaml_value(value):
    return value.replace('\\', '\\\\').replace('"', '\\"')

def replace_field(yaml_content, field, new_value):
    new_value = escape_yaml_value(new_value)
    new_line  = f'{field}: "{new_value}"'
    result, count = re.subn(rf'^{field}:.*$', new_line, yaml_content, flags=re.MULTILINE)
    if count == 0:
        result = yaml_content.rstrip() + f'\n{new_line}'
    return result

def replace_keywords_field(yaml_content, keywords):
    def esc(s):
        return s.replace('\\', '\\\\').replace('"', '\\"')
    keywords_yaml = "keywords:\n" + "\n".join(f'- "{esc(kw)}"' for kw in keywords)
    result, count = re.subn(
        r'^keywords:\n(?:[ \t]*- .*\n)*',
        keywords_yaml + "\n",
        yaml_content,
        flags=re.MULTILINE
    )
    if count == 0:
        result, count2 = re.subn(
            r'(focusKeyphrase:.*\n)',
            rf'\1{keywords_yaml}\n',
            yaml_content
        )
        if count2 == 0:
            result = yaml_content.rstrip() + f'\n{keywords_yaml}'
    return result

def get_unused_keywords(yaml_content, all_keywords):
    seo_text = " ".join([
        get_field(yaml_content, "title"),
        get_field(yaml_content, "description"),
        get_field(yaml_content, "metaDescription"),
        get_field(yaml_content, "ogDescription"),
    ]).lower()
    return [kw for kw in all_keywords if kw["keyword"].lower() not in seo_text]


# ── STATE HELPERS ─────────────────────────────────────────────────────────────

def load_skip_list():
    skip_file = Path("seo_skip.txt")
    if not skip_file.exists():
        return set()
    with open(skip_file, "r", encoding="utf-8") as f:
        return set(line.strip() for line in f if line.strip() and not line.startswith("#"))

def load_state(slug):
    path = Path(f"keyword_data/{slug}.json")
    if not path.exists():
        return None
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)

def update_state(slug, **kwargs):
    path = Path(f"keyword_data/{slug}.json")
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)
    data.update(kwargs)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)


# ── STEP 2 : SEO OPTIMIZATION ─────────────────────────────────────────────────

def format_kw_for_prompt(kw_data):
    return "\n".join(
        f"{kw['keyword']} (volume: {kw['volume']}/mo, competition: {kw['competition']})"
        for kw in kw_data.get("all", [])
    )

def format_ingredients_for_prompt(yaml_content):
    items = get_list_field(yaml_content, "ingredients")
    lines = []
    for item in items:
        if "===" in item:
            section = re.sub(r'===(.+)===', r'\1', item).strip()
            lines.append(f"\n[{section}]")
        else:
            lines.append(f"- {item}")
    return "\n".join(lines)

def format_instructions_for_prompt(yaml_content):
    items = get_list_field(yaml_content, "instructions")
    lines = []
    for item in items:
        if "===" in item:
            section = re.sub(r'===(.+)===', r'\1', item).strip()
            lines.append(f"\n[{section}]")
        else:
            lines.append(item)
    return "\n".join(lines)

def generate_keywords_from_title(client, title, tags, yaml_content):
    ingredients_text  = format_ingredients_for_prompt(yaml_content)
    instructions_text = format_instructions_for_prompt(yaml_content)
    description       = get_field(yaml_content, "description")
    prep_time         = get_field(yaml_content, "prepTime")
    cook_time         = get_field(yaml_content, "cookTime")
    msg = client.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=250,
        messages=[{
            "role": "user",
            "content": (
                f"Recipe: {title}\n"
                f"Description: {description[:200]}\n"
                f"Tags: {tags}\n"
                f"Prep: {prep_time} | Cook: {cook_time}\n"
                f"Ingredients: {ingredients_text[:400]}\n"
                f"Instructions: {instructions_text[:300]}\n\n"
                f"Generate 8-10 SEO keywords for this recipe.\n"
                f"Mix these types:\n"
                f"- 2-3 broad parent terms (high volume, e.g. 'chicken pasta')\n"
                f"- 2-3 intent modifiers from the tags (e.g. 'easy chicken pasta', 'healthy chicken pasta')\n"
                f"- 3-4 long tail using real ingredients + method (e.g. 'chicken pasta with cream sauce and mushrooms')\n"
                f"Lowercase only. One per line. No numbering.\n"
                f"No generic standalone words: recipe, easy, healthy, best, quick, simple"
            )
        }]
    )
    lines = msg.content[0].text.strip().split("\n")
    keywords = []
    for line in lines:
        line = line.strip().lstrip("-•123456789. ").strip()
        if line and len(line) > 3:
            keywords.append({"keyword": line, "volume": 0, "competition": 0})
    return {"all": keywords[:10]}


def optimize_seo(client, title, description, kw_data, yaml_content=""):
    kw_block = format_kw_for_prompt(kw_data)
    ingredients_text = format_ingredients_for_prompt(yaml_content) if yaml_content else ""
    msg = client.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=900,
        system=[{"type": "text", "text": SEO_PROMPT, "cache_control": {"type": "ephemeral"}}],
        messages=[{
            "role": "user",
            "content": (
                f"Recipe title: {title}\n"
                f"Current description: {description}\n\n"
                f"Real ingredients (use these in description/meta — never invent ingredients):\n{ingredients_text}\n\n"
                f"Available keywords (max 12 in output, remove near-duplicates):\n{kw_block}\n\n"
                f"Rewrite all SEO fields using the real ingredients."
            )
        }]
    )
    text = msg.content[0].text.strip()
    text = re.sub(r'^```json\s*', '', text)
    text = re.sub(r'\s*```$', '', text)
    return json.loads(text)


# ── STEP 3 : CONTENT REWRITE ──────────────────────────────────────────────────

def generate_body(client, title, yaml_content, unused_keywords):
    kw_list           = "\n".join(f"{kw['keyword']} ({kw['volume']}/mo)" for kw in unused_keywords[:20])
    ingredients_text  = format_ingredients_for_prompt(yaml_content)
    instructions_text = format_instructions_for_prompt(yaml_content)
    tags_list         = get_list_field(yaml_content, "tags")
    tags_str          = ", ".join(tags_list)

    prep_time  = get_field(yaml_content, "prepTime")
    cook_time  = get_field(yaml_content, "cookTime")
    total_time = get_field(yaml_content, "totalTime")

    def fmt_time(t):
        t = t.strip()
        h = re.search(r'(\d+)H', t)
        m = re.search(r'(\d+)M', t)
        hours = int(h.group(1)) if h else 0
        mins  = int(m.group(1)) if m else 0
        if hours and mins:
            return f"{hours}h {mins} min"
        elif hours:
            return f"{hours}h"
        elif mins:
            return f"{mins} min"
        return t

    prep_str  = fmt_time(prep_time)  if prep_time  else "unknown"
    cook_str  = fmt_time(cook_time)  if cook_time  else "unknown"
    total_str = fmt_time(total_time) if total_time else "unknown"

    msg = client.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=4000,
        system=[{"type": "text", "text": CONTENT_PROMPT, "cache_control": {"type": "ephemeral"}}],
        messages=[{
            "role": "user",
            "content": (
                f"Recipe: {title}\n\n"
                f"EXACT TIMES — use these when mentioning duration, never invent times:\n"
                f"Prep: {prep_str} | Cook: {cook_str} | Total: {total_str}\n\n"
                f"Tags (use as intent modifiers throughout, especially in Why You'll Love This):\n{tags_str}\n\n"
                f"Ingredients:\n{ingredients_text}\n\n"
                f"Instructions:\n{instructions_text}\n\n"
                f"Unused keywords — aim for 80%+ coverage, spread naturally across all sections:\n"
                f"{kw_list if kw_list else 'none — write naturally without forcing keywords'}\n\n"
                f"Write the full markdown body. Start with the intro paragraph directly.\n"
                f"Place {{{{< recipe-card >}}}} between section 5 and the FAQ."
            )
        }]
    )

    body = msg.content[0].text.strip()

    if "{{< recipe-card >}}" not in body:
        if "## Frequently Asked Questions" in body:
            body = body.replace(
                "## Frequently Asked Questions",
                "{{< recipe-card >}}\n\n## Frequently Asked Questions"
            )
        else:
            body += "\n\n{{< recipe-card >}}\n"

    return body


# ── MAIN ──────────────────────────────────────────────────────────────────────

def main():
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        raise ValueError("ANTHROPIC_API_KEY is required")

    client    = anthropic.Anthropic(api_key=api_key)
    skip_list = load_skip_list()

    recipe_files = sorted(glob.glob("content/recipes/*.md"))
    total        = len(recipe_files)
    batch        = recipe_files[start_index:start_index + batch_size]

    print(f"Total     : {total}")
    print(f"Batch     : {len(batch)} (index {start_index} → {start_index + len(batch) - 1})")
    print(f"Skip list : {len(skip_list)}\n")

    stats = {"done": 0, "skipped": 0, "errors": 0, "no_keywords": 0}

    for i, filepath in enumerate(batch):
        slug = Path(filepath).stem
        label = f"[{i+1}/{len(batch)}]"

        if slug in skip_list:
            print(f"{label} SKIP (blacklist): {slug}")
            stats["skipped"] += 1
            continue

        state = load_state(slug)

        with open(filepath, "r", encoding="utf-8") as f:
            content = f.read()

        full_block, yaml_content = extract_yaml_block(content)
        if not yaml_content:
            print(f"{label} SKIP (no YAML): {slug}")
            stats["skipped"] += 1
            continue

        title       = get_field(yaml_content, "title")
        description = get_field(yaml_content, "description")
        tags        = get_tags(yaml_content)

        if not title:
            print(f"{label} SKIP (no title): {slug}")
            stats["skipped"] += 1
            continue

        # Skip si body markdown existe déjà — vérification en premier
        _, existing_body = extract_yaml_and_body(content)
        if existing_body and len(existing_body.strip()) > 200:
            print(f"{label} SKIP (body exists): {slug}")
            if state:
                try:
                    update_state(slug, content_done=True)
                except:
                    pass
            stats["skipped"] += 1
            continue

        print(f"{label} {title}")

        # Pas de keywords → générer avec Haiku en mémoire uniquement
        if not state or len(state.get("keywords", {}).get("all", [])) == 0:
            print(f"  keywords : no JSON — generating with Haiku...")
            kw_data = generate_keywords_from_title(client, title, tags, yaml_content)
            stats["no_keywords"] += 1
        else:
            kw_data = state["keywords"]

        # Titre = top keyword (le plus cherché), pas de twist
        top_kw = kw_data["all"][0]["keyword"] if kw_data.get("all") else title
        top_kw_title = top_kw.title()
        print(f"  focus    : '{top_kw_title}'")

        # ── STEP 2 : SEO ─────────────────────────────────────────────────────
        print(f"  SEO      : optimizing...")
        try:
            seo = optimize_seo(client, top_kw_title, description, kw_data, yaml_content)

            new_yaml = yaml_content
            new_yaml = replace_field(new_yaml, "title",           seo["title"])
            new_yaml = replace_field(new_yaml, "description",     seo["description"])
            new_yaml = replace_field(new_yaml, "metaDescription", seo["metaDescription"])
            new_yaml = replace_field(new_yaml, "ogDescription",   seo["ogDescription"])
            new_yaml = replace_field(new_yaml, "focusKeyphrase",  seo["focusKeyphrase"])
            new_yaml = replace_keywords_field(new_yaml,           seo["keywords"])

            new_content = content.replace(full_block, f"---\n{new_yaml}\n---")
            with open(filepath, "w", encoding="utf-8") as f:
                f.write(new_content)

            yaml_content = new_yaml
            content      = new_content
            full_block   = f"---\n{new_yaml}\n---"

            if state:
                update_state(slug, seo_done=True)
            print(f"  SEO      : OK → focus: '{seo['focusKeyphrase']}' | {len(seo['keywords'])} keywords")

        except Exception as e:
            print(f"  SEO ERROR: {e}")
            stats["errors"] += 1
            continue

        # ── STEP 3 : body markdown ───────────────────────────────────────────
        print(f"  content  : generating body...")
        try:
            with open(filepath, "r", encoding="utf-8") as f:
                content = f.read()
            yaml_content, _ = extract_yaml_and_body(content)

            unused_kw = get_unused_keywords(yaml_content, kw_data["all"])
            print(f"  unused kw: {len(unused_kw)}/{len(kw_data['all'])}")

            new_body = generate_body(client, top_kw_title, yaml_content, unused_kw)

            new_content = f"---\n{yaml_content}\n---\n\n{new_body}\n"
            with open(filepath, "w", encoding="utf-8") as f:
                f.write(new_content)

            if state:
                update_state(slug, content_done=True)

            word_count = len(new_body.split())
            print(f"  content  : OK → {word_count} words")
            stats["done"] += 1

        except Exception as e:
            print(f"  CONTENT ERROR: {e}")
            stats["errors"] += 1

        # Push après chaque recette — GitHub Actions disque éphémère
        os.system(f'git add content/recipes/{slug}.md 2>/dev/null; git diff --staged --quiet || git commit -m "process: {slug}"; git push 2>/dev/null')

    print(f"\n── DONE ──────────────────────────────────")
    print(f"Done           : {stats['done']}")
    print(f"Skipped        : {stats['skipped']}")
    print(f"Errors         : {stats['errors']}")
    print(f"Haiku keywords : {stats['no_keywords']} (no DFS JSON — keywords generated on the fly)")

if __name__ == "__main__":
    main()
