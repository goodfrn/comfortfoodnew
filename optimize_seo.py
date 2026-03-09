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
SYSTEM_PROMPT = """You are a culinary content writer. You write like someone who actually cooks and talks to a friend in their kitchen. Not like a blog. Not like an AI.

STYLE RULES:
- Short sentences. Then a long one that breathes. Then short again. No regular pattern.
- Never use: "wonderful", "delightful", "amazing", "perfect", "great", "fantastic"
- No questions to the reader. No "you'll love this", "what's your favorite?", "tell me in the comments"
- No smooth transitions. One idea. Stop. Next idea.
- Direct opinions. "Tried both. Shiitake has more depth."
- Real experience. "Switched a while back and never went back."
- Past mistakes. "Tried it. Bad idea. Meat went stringy."
- Sentences that start with verbs. "Cut the beef thin." "Scrape the bottom."
- Hard stops. "That's it." "Works fine." "Not worth it."
- No visible structure. No "First... Second... Third..."
- A paragraph can be 3 lines or 8. No regularity.
- No filler words. Every sentence says something.
- Confident tone but not salesy. You know what you're doing but you're not pushing anything.

SEO RULES:
- title: 50-60 characters. PRIMARY keyword in first 3 words. Natural, not stuffed.
- description: 140-160 characters. PRIMARY keyword once naturally. 1 SECONDARY keyword woven in. Ends with a real benefit — no hype.
- metaDescription: 150-155 characters. PRIMARY keyword in first 10 words. 1 SECONDARY keyword. End with CTA like "Try it tonight." or "Save this one."
- ogDescription: 100-120 characters. 1 SECONDARY keyword naturally. Punchy. No stuffing. Sounds like a human wrote it.
- focusKeyphrase: PRIMARY keyword only — the one with highest volume that matches exactly what this recipe IS. Not generic.
- keywords array: return up to 10 keywords (never more). Put the PRIMARY keyword first. Then choose the strongest SECONDARY and LSI keywords based on relevance to the recipe, search volume, and diversity. Avoid near-duplicate wording variations unless they clearly deserve a slot.

KEYWORD PLACEMENT LOGIC:
- PRIMARY keyword = highest volume + most specific to this exact recipe
- SECONDARY keywords = strong variations and long-tail terms
- LSI keywords = semantic variations and supporting search terms
- Use the full keyword list as input, but return only the 10 best keywords in the final keywords array
- Prefer keywords that are:
  1. highly relevant to the exact recipe,
  2. high volume,
  3. distinct from each other in wording or search intent
- Avoid wasting keyword slots on tiny wording variants of the same phrase
- Use around 5 of the strongest keywords naturally across title, description, metaDescription, ogDescription, and focusKeyphrase combined
- Do not force awkward keywords into the text
- Do not invent keywords that are not present in the provided keyword list.

Return ONLY valid JSON, no explanation, no markdown backticks:
{
  "title": "...",
  "description": "...",
  "metaDescription": "...",
  "ogDescription": "...",
  "focusKeyphrase": "...",
  "keywords": ["...", "...", "..."]
}"""

# ── HELPERS ───────────────────────────────────────────────────────────────────
def extract_yaml_block(content):
    match = re.match(r'^---\n(.*?)\n---', content, re.DOTALL)
    if match:
        return match.group(0), match.group(1)
    return None, None

def get_field(yaml_content, field):
    match = re.search(rf'^{field}:\s*["\']?(.*?)["\']?\s*$', yaml_content, re.MULTILINE)
    if match:
        return match.group(1).strip('"\'')
    return ""

def replace_field(yaml_content, field, new_value):
    new_value = new_value.replace('"', '\\"')
    new_line  = f'{field}: "{new_value}"'
    result    = re.sub(rf'^{field}:.*$', new_line, yaml_content, flags=re.MULTILINE)
    if result == yaml_content:
        result = re.sub(r'^(title:.*$)', rf'\1\n{new_line}', yaml_content, flags=re.MULTILINE)
    return result

def replace_keywords_field(yaml_content, keywords):
    keywords_yaml = "keywords:\n" + "\n".join(f'- "{kw}"' for kw in keywords)
    result = re.sub(r'keywords:\n(?:- .*\n)*', keywords_yaml + "\n", yaml_content)
    if result == yaml_content:
        result = re.sub(r'(focusKeyphrase:.*\n)', rf'\1{keywords_yaml}\n', yaml_content)
    return result

def load_skip_list():
    skip_file = Path("seo_skip.txt")
    if not skip_file.exists():
        return set()
    with open(skip_file, "r", encoding="utf-8") as f:
        return set(line.strip() for line in f if line.strip())

def get_pending_recipes():
    pending = []
    for kw_file in sorted(Path("keyword_data").glob("*.json")):
        with open(kw_file, "r", encoding="utf-8") as f:
            data = json.load(f)
        if not data.get("processed") and data.get("keywords", {}).get("primary"):
            md_path = f"content/recipes/{data['slug']}.md"
            if Path(md_path).exists():
                pending.append((md_path, data))
    return pending

def mark_as_processed(slug):
    kw_file = f"keyword_data/{slug}.json"
    with open(kw_file, "r", encoding="utf-8") as f:
        data = json.load(f)
    data["processed"] = True
    with open(kw_file, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)

def format_keywords_for_prompt(kw_data):
    lines = []
    primary = kw_data.get("primary")
    if primary:
        lines.append(f"PRIMARY: {primary['keyword']} ({primary['volume']}/month)")

    for kw in kw_data.get("secondary", []):
        lines.append(f"SECONDARY: {kw['keyword']} ({kw['volume']}/month)")

    for kw in kw_data.get("lsi", []):
        lines.append(f"LSI: {kw['keyword']} ({kw['volume']}/month)")

    return "\n".join(lines)

def optimize_with_claude(client, title, description, kw_data):
    kw_block = format_keywords_for_prompt(kw_data)

    message = client.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=600,
        system=[{
            "type": "text",
            "text": SYSTEM_PROMPT,
            "cache_control": {"type": "ephemeral"}
        }],
        messages=[{
            "role": "user",
            "content": f"Recipe title: {title}\nCurrent description: {description}\n\nKeywords from Google Ads:\n{kw_block}\n\nRewrite the SEO fields."
        }]
    )

    response_text = message.content[0].text.strip()
    response_text = re.sub(r'^```json\s*', '', response_text)
    response_text = re.sub(r'\s*```$', '', response_text)
    return json.loads(response_text)

# ── MAIN ──────────────────────────────────────────────────────────────────────
def main():
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        raise ValueError("ANTHROPIC_API_KEY not set")

    skip_list = load_skip_list()
    client    = anthropic.Anthropic(api_key=api_key)
    pending   = get_pending_recipes()

    # Filter skip list
    pending = [(fp, d) for fp, d in pending if d["slug"] not in skip_list]
    batch   = pending[start_index:start_index + batch_size]

    print(f"Pending recipes : {len(pending)}")
    print(f"Processing      : {len(batch)} recipes (index {start_index} to {start_index + len(batch) - 1})")

    updated = 0
    skipped = 0
    errors  = 0

    for i, (filepath, kw_data) in enumerate(batch):
        try:
            with open(filepath, "r", encoding="utf-8") as f:
                content = f.read()

            full_block, yaml_content = extract_yaml_block(content)
            if not yaml_content:
                print(f"  [{i+1}] SKIP (no YAML): {filepath}")
                skipped += 1
                continue

            title       = kw_data["title"]
            kw          = kw_data["keywords"]
            description = get_field(yaml_content, "description")

            print(f"  [{i+1}] Optimizing: {title}")

            seo = optimize_with_claude(client, title, description, kw)

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

            mark_as_processed(kw_data["slug"])

            print(f"         OK → focus: '{seo['focusKeyphrase']}' | title: {seo['title']}")
            updated += 1

        except json.JSONDecodeError as e:
            print(f"  [{i+1}] JSON ERROR: {filepath} — {e}")
            errors += 1
        except Exception as e:
            print(f"  [{i+1}] ERROR: {filepath} — {e}")
            errors += 1

    print(f"\n── DONE ──")
    print(f"Updated : {updated}")
    print(f"Skipped : {skipped}")
    print(f"Errors  : {errors}")

if __name__ == "__main__":
    main()
