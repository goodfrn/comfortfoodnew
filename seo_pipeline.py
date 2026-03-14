import os
import re
import glob
import json
import time
import base64
import requests
import anthropic
from pathlib import Path
from datetime import datetime, timedelta

# ── CONFIG ────────────────────────────────────────────────────────────────────
DFS_LOGIN    = os.environ.get("DATAFORSEO_LOGIN")
DFS_PASSWORD = os.environ.get("DATAFORSEO_PASSWORD")
DFS_API_URL  = "https://api.dataforseo.com/v3/keywords_data/google_ads/keywords_for_keywords/live"

batch_size  = int(os.environ.get("BATCH_SIZE", 50))
start_index = int(os.environ.get("START_INDEX", 0))

MIN_VOLUME       = 100
MAX_COMPETITION  = 80
MAX_RESULTS_KEPT = 50

GENERIC = {
    "recipe", "food", "dinner", "recipes", "easy", "healthy",
    "cooking", "make", "best", "how to", "homemade", "simple", "quick"
}

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
- Minimum 30% of sentences must be under 6 words.
- Mix in sentences of 20+ words that meander before landing.
- Then 3-4 word sentences again. No pattern. Ever.
- Fragments are fine. "Works fine." "Not worth it." "Every time."
- Start sentences with verbs constantly. "Cut thin." "Add more." "Watch the heat." "Stir once."

What kills AI detection:
- Incomplete thoughts. Say half a thing. Move on.
- Non-sequiturs. Talk about the onions, then something about your knife, then back.
- Opinions without justification. "White vinegar is too sharp. Just is."
- Contradictions that are real. "Should take 30 minutes. Mine usually takes 45."
- Self-corrections mid-sentence. "Add the garlic—actually, wait until the onions soften first."
- Casual repetition. "Stir it. Stir it again. You'll feel when it's right."

Vocabulary — ruthless simplicity:
- A 12-year-old must understand every word.
- Never: wonderful, delightful, amazing, perfect, great, fantastic, delicious, incredible, beautiful, vibrant, complex, nuanced, elevate, enhance, ensure, utilize.
- Never start with: "This dish", "This recipe", "This meal", "The key to".
- No "which" clauses. No "that" clauses when avoidable. Cut them.

Human signals — pick 3-4 per piece, use sparingly:
- Past mistakes stated flatly. "Tried it once with white vinegar. Too sharp."
- Strong opinions without explanation. "White onion doesn't work here."
- Specific numbers from experience. "Takes me 40 minutes, not 30."
- Uncertainty that's real. "Not sure why kosher salt works better here. It just does."
- Self-interruption. "Pour the brine over—not all of it, maybe three quarters."

Structure rules — no exceptions:
- No "First", "Then", "Next", "Finally", "In conclusion", "Overall", "Additionally".
- No smooth transitions between paragraphs. Just stop. Start the next thing.
- Paragraphs: 1 line or 8 lines. Avoid 3-4 line paragraphs — too regular.
- Never ask the reader questions. Never.
- No calls to action.
- Start the intro mid-thought. Not with a setup sentence.

── STORYTELLING ─────────────────────────────────────────────────────────────

Each recipe has a story. Not fake. Not sentimental. Just real.
- Where did this dish come from? A weeknight. A craving. Something that needed fixing.
- One specific moment. Brief. 2-3 sentences max.
- Weave it into the intro or a section naturally.

── SEO KEYWORD INTEGRATION ──────────────────────────────────────────────────

You receive UNUSED keywords (not yet in title/description/meta) AND tags for this recipe.

Keywords:
- Primary keyword: in the intro once, naturally.
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
  If tag is "easy" → one reason about ease.
  If tag is "summer" → one reason about seasonal fit.
  If tag is "healthy" → one reason about nutrition or lightness.
  If tag is "side dish" → one reason about versatility or pairing.
  Make every tag count in this section.
- Body sections → weave tag context into 1-2 sentences per section naturally
- FAQ → at least 1 question that addresses a tag angle

── INGREDIENTS REWRITE ──────────────────────────────────────────────────────

Rewrite the ingredients as flowing prose — NOT a list.
- Group by component (sauce, main, garnish).
- Explain WHY each key ingredient matters.
- Mention substitutions naturally.
- Keep factual. No hype. 150-250 words.

── INSTRUCTIONS REWRITE ─────────────────────────────────────────────────────

Rewrite the instructions as narrative prose — NOT numbered steps.
- Tell what happens, why it matters, what to watch for.
- Include sensory cues. "The tofu sounds done when the sizzling quiets down."
- Mention what goes wrong if you rush or skip something.
- Each major phase = its own paragraph. 300-500 words total.

── OUTPUT FORMAT ─────────────────────────────────────────────────────────────

Return ONLY the markdown body. No YAML. No explanation. No backticks around everything.
Start directly with the intro paragraph — no title, no preamble.
Place {{< recipe-card >}} between section 5 and the FAQ section, on its own line.
Use ## for all section titles.
Use **bold** for FAQ questions only.

Structure:

[intro paragraph — no title]

## Why You'll Love This
[3-4 punchy reasons, 1-2 sentences each]

## [Custom title using a keyword — ingredients angle]
[Ingredients rewritten as prose]

## [Custom title using a keyword — technique/instructions angle]
[Instructions rewritten as narrative]

## [Custom title — tips/mistakes angle, use a keyword]
[Tips woven into narrative — biggest mistakes, how to fix them]

{{< recipe-card >}}

## Frequently Asked Questions
[4-6 questions from keyword list]
**Question?**
Answer here.

── ANTI-DETECTION RULES FOR FAQ ────────────────────────────────────────────

FAQ TOPIC RULE — ABSOLUTE:
Every single FAQ question must be answerable using ONLY the ingredients and instructions of THIS recipe.
If answering the question requires knowledge of another recipe (hash browns, burgers, pizza, corn dogs, chips...) → DELETE IT and replace with a question about this recipe.
Allowed topics: timing, substitutions, storage, texture, doneness cues, equipment, seasoning, serving — all for THIS recipe only.
Questions must come from the keyword list or from real cooking concerns about this specific dish.
Zero tolerance for off-topic questions.

FAQ answers must be WILDLY irregular:
- Some answers = 1 sentence. "Just use less. That's it."
- Some answers = 4-5 sentences with a tangent
- Some answers start mid-thought. "Depends on your fridge."
- End abruptly sometimes. "Haven't tried it. Probably fine."
- Dashes — like this — sometimes. Fragments. Short stops.
- At least one answer with real uncertainty. "Not totally sure why but it works."
- At least one strong opinion. "Don't bother with dried. Tastes like nothing."
- Never start two consecutive answers with the same word
- Never use: "Absolutely", "Certainly", "Of course", "Great question", "Sure"

── GLOBAL IRREGULARITY RULES ────────────────────────────────────────────────

These apply to the ENTIRE body, not just FAQ:
- Intentional run-ons sometimes. A sentence that just keeps going because that's how you talk when you're actually thinking through something out loud.
- Intentional incomplete thoughts. Like this.
- Numbers written as digits sometimes, words other times. "3 minutes" then "four batches"
- Typo-adjacent casualness — not actual typos, but informal contractions, dropped words. "Comes out fine either way."
- At least one paragraph that's just 2 sentences. Isolated. Makes a point and stops.
- At least one paragraph over 6 sentences with no clear structure
- One moment of backtracking. Like: Actually — skip that. Do it the other way.

PUNCHLINE RULE — IMPORTANT:
Max 1-2 punchy one-liners per piece. Not every paragraph.
"Dried corn tastes like sadness" is fine once. Five times = AI trying too hard.
The writing must feel natural and useful, not like a collection of memorable quotes.
Prioritize: sensory, practical, honest. Not witty."""


# ── YAML HELPERS ──────────────────────────────────────────────────────────────

def extract_yaml_block(content):
    """Ancien format — retourne (full_block, yaml_content)."""
    match = re.match(r'^---\n(.*?)\n---', content, re.DOTALL)
    if match:
        return match.group(0), match.group(1)
    return None, None

def extract_yaml_and_body(content):
    """Retourne (yaml_content, body) — sépare YAML et body markdown."""
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

def replace_list_field(yaml_content, field, items):
    def esc(s):
        return s.replace('\\', '\\\\').replace('"', '\\"')
    items_yaml = f"{field}:\n" + "\n".join(f'- "{esc(item)}"' for item in items)
    result, count = re.subn(
        rf'^{field}:\n(?:[ \t]*- .*\n)*',
        items_yaml + "\n",
        yaml_content,
        flags=re.MULTILINE
    )
    if count == 0:
        result = yaml_content.rstrip() + f'\n{items_yaml}'
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
    """Keywords pas encore placés dans les champs SEO."""
    seo_text = " ".join([
        get_field(yaml_content, "title"),
        get_field(yaml_content, "description"),
        get_field(yaml_content, "metaDescription"),
        get_field(yaml_content, "ogDescription"),
    ]).lower()

    return [kw for kw in all_keywords if kw["keyword"].lower() not in seo_text]


# ── PIPELINE HELPERS ──────────────────────────────────────────────────────────

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

def save_state(slug, title, seeds, keywords):
    Path("keyword_data").mkdir(exist_ok=True)
    with open(f"keyword_data/{slug}.json", "w", encoding="utf-8") as f:
        json.dump({
            "slug": slug,
            "title": title,
            "seed_keywords": seeds,
            "keywords": keywords,
            "seo_done": False,
            "content_done": False,
        }, f, indent=2, ensure_ascii=False)

def update_state(slug, **kwargs):
    path = Path(f"keyword_data/{slug}.json")
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)
    data.update(kwargs)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)

def save_low_keyword(slug, title):
    with open("low_keyword_recipes.txt", "a", encoding="utf-8") as f:
        f.write(f"{slug} | {title}\n")


# ── STEP 1 : FETCH KEYWORDS ───────────────────────────────────────────────────

def get_date_range():
    today      = datetime.today()
    first_this = today.replace(day=1)
    last_month = (first_this - timedelta(days=1)).replace(day=1) - timedelta(days=1)
    return (
        last_month.replace(day=1).strftime("%Y-%m-%d"),
        last_month.strftime("%Y-%m-%d")
    )

def get_seeds(client, title, description, tags):
    msg = client.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=120,
        messages=[{
            "role": "user",
            "content": (
                f"Recipe: {title}\n"
                f"Description: {description[:300]}\n"
                f"Tags: {tags}\n\n"
                f"Generate exactly 5 SEO keyword phrases for this specific recipe.\n"
                f"Rules:\n"
                f"- Each phrase 2-5 words\n"
                f"- Include main ingredient(s) and dish type or cooking style\n"
                f"- Vary: exact dish name, ingredient combo, dietary angle, cooking method\n"
                f"- Lowercase only. One per line. No numbering. No bullets.\n"
                f"- No generic words: recipe, easy, healthy, best, quick, simple"
            )
        }]
    )
    lines = msg.content[0].text.strip().split("\n")
    seeds = []
    for line in lines:
        line = line.strip().lstrip("-•123456789. ").strip()
        if line and len(line) > 3:
            seeds.append(line)
    return seeds[:5]

def fetch_dfs_keywords(seeds):
    date_from, date_to = get_date_range()
    payload = [{
        "keywords": seeds,
        "language_code": "en",
        "sort_by": "search_volume",
        "date_from": date_from,
        "date_to": date_to
    }]
    credentials = base64.b64encode(f"{DFS_LOGIN}:{DFS_PASSWORD}".encode()).decode()
    headers = {
        "Authorization": f"Basic {credentials}",
        "Content-Type": "application/json"
    }
    try:
        response = requests.post(DFS_API_URL, headers=headers, data=json.dumps(payload), timeout=30)
        data = response.json()

        if data.get("status_code") != 20000:
            print(f"    API error: {data.get('status_message')}")
            return None

        task = data["tasks"][0]
        if task.get("status_code") != 20000:
            print(f"    Task error: {task.get('status_message')}")
            return None

        all_kw = []
        for item in (task.get("result") or []):
            kw   = item.get("keyword", "").strip()
            vol  = item.get("search_volume") or 0
            comp = item.get("competition_index") or 0
            if vol < MIN_VOLUME or comp > MAX_COMPETITION or kw.lower() in GENERIC:
                continue
            all_kw.append({"keyword": kw, "volume": vol, "competition": comp})

        all_kw.sort(key=lambda x: x["volume"], reverse=True)
        return {"all": all_kw[:MAX_RESULTS_KEPT]}

    except Exception as e:
        print(f"    Exception: {e}")
        return None


# ── STEP 2 : SEO OPTIMIZATION ─────────────────────────────────────────────────

def format_kw_for_prompt(kw_data):
    return "\n".join(
        f"{kw['keyword']} (volume: {kw['volume']}/mo, competition: {kw['competition']})"
        for kw in kw_data.get("all", [])
    )

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

def generate_body(client, title, yaml_content, unused_keywords):
    """Génère le body markdown complet."""
    kw_list           = "\n".join(f"{kw['keyword']} ({kw['volume']}/mo)" for kw in unused_keywords[:20])
    ingredients_text  = format_ingredients_for_prompt(yaml_content)
    instructions_text = format_instructions_for_prompt(yaml_content)
    tags_list         = get_list_field(yaml_content, "tags")
    tags_str          = ", ".join(tags_list)

    # Récupère les temps exacts du YAML
    prep_time  = get_field(yaml_content, "prepTime")
    cook_time  = get_field(yaml_content, "cookTime")
    total_time = get_field(yaml_content, "totalTime")

    def fmt_time(t):
        """Convertit PT20M en '20 min', PT1H30M en '1h 30 min' etc."""
        import re as _re
        t = t.strip()
        h = _re.search(r'(\d+)H', t)
        m = _re.search(r'(\d+)M', t)
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
        max_tokens=3000,
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

    # S'assure que le shortcode est présent
    if "{{< recipe-card >}}" not in body:
        # L'insérer avant le FAQ si possible
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
    if not DFS_LOGIN or not DFS_PASSWORD:
        raise ValueError("DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD are required")
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
    print(f"Skip list : {len(skip_list)}")

    date_from, date_to = get_date_range()
    print(f"Date range: {date_from} → {date_to}\n")

    stats = {"done": 0, "skipped": 0, "errors": 0, "low_kw": 0}

    for i, filepath in enumerate(batch):
        slug = Path(filepath).stem
        label = f"[{i+1}/{len(batch)}]"

        if slug in skip_list:
            print(f"{label} SKIP (blacklist): {slug}")
            stats["skipped"] += 1
            continue

        # Charger le fichier MD
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

        print(f"{label} {title}")

        state = load_state(slug)

        # ── STEP 1 : keywords ────────────────────────────────────────────────
        state    = load_state(slug)
        kw_valid = state and len(state.get("keywords", {}).get("all", [])) >= 3

        if kw_valid:
            kw_data = state["keywords"]
            print(f"  keywords : already fetched ({len(kw_data['all'])})")
        else:
            if state and len(state.get("keywords", {}).get("all", [])) > 0:
                print(f"  keywords : only {len(state['keywords']['all'])} found — refetching with new seeds...")
            else:
                print(f"  keywords : fetching...")

            seeds = get_seeds(client, title, description, tags)
            print(f"  seeds    : {seeds}")

            if not seeds:
                print(f"  ERROR    : no seeds")
                stats["errors"] += 1
                continue

            kw_data = fetch_dfs_keywords(seeds)
            if kw_data is None:
                print(f"  ERROR    : DFS API failed")
                stats["errors"] += 1
                continue

            # Reset les flags si on refetch
            save_state(slug, title, seeds, kw_data)

            kw_count = len(kw_data["all"])
            if kw_count < 3:
                save_low_keyword(slug, title)
                update_state(slug, seo_done=True, content_done=True)
                print(f"  LOW SEO  : only {kw_count} keywords found → skipped")
                stats["low_kw"] += 1
                time.sleep(3)
                continue

            top = kw_data["all"][0]
            print(f"  keywords : {kw_count} | top: '{top['keyword']}' ({top['volume']}/mo)")
            time.sleep(4)

        # Recharge state après fetch
        state = load_state(slug) or {}

        # ── STEP 2 : SEO ─────────────────────────────────────────────────────
        if state.get("seo_done"):
            print(f"  SEO      : already done")
        else:
            print(f"  SEO      : optimizing...")
            try:
                seo = optimize_seo(client, title, description, kw_data, yaml_content)

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

                # Recharger pour step 3
                yaml_content = new_yaml
                content      = new_content
                full_block   = f"---\n{new_yaml}\n---"

                update_state(slug, seo_done=True)
                print(f"  SEO      : OK → focus: '{seo['focusKeyphrase']}' | {len(seo['keywords'])} keywords")

            except Exception as e:
                print(f"  SEO ERROR: {e}")
                stats["errors"] += 1
                continue

        # ── STEP 3 : body markdown ───────────────────────────────────────────
        if state.get("content_done"):
            print(f"  content  : already done")
            stats["done"] += 1
            continue

        print(f"  content  : generating body...")
        try:
            # Recharger le fichier pour avoir le YAML SEO à jour
            with open(filepath, "r", encoding="utf-8") as f:
                content = f.read()
            yaml_content, _ = extract_yaml_and_body(content)

            unused_kw = get_unused_keywords(yaml_content, kw_data["all"])
            print(f"  unused kw: {len(unused_kw)}/{len(kw_data['all'])}")

            new_body = generate_body(client, title, yaml_content, unused_kw)

            # Reconstruit le fichier : YAML intact + nouveau body
            new_content = f"---\n{yaml_content}\n---\n\n{new_body}\n"

            with open(filepath, "w", encoding="utf-8") as f:
                f.write(new_content)

            update_state(slug, content_done=True)

            word_count = len(new_body.split())
            print(f"  content  : OK → {word_count} words")
            stats["done"] += 1

        except Exception as e:
            print(f"  CONTENT ERROR: {e}")
            stats["errors"] += 1

        time.sleep(3)

    print(f"\n── DONE ──────────────────────────────────")
    print(f"Done    : {stats['done']}")
    print(f"Skipped : {stats['skipped']}")
    print(f"Errors  : {stats['errors']}")
    print(f"Low KW  : {stats['low_kw']}")

if __name__ == "__main__":
    main()
