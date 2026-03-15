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


# ── YAML HELPERS ──────────────────────────────────────────────────────────────

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

def save_low_keyword(slug, title):
    with open("low_keyword_recipes.txt", "a", encoding="utf-8") as f:
        f.write(f"{slug} | {title}\n")


# ── KEYWORD FETCH ─────────────────────────────────────────────────────────────

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
                f"Generate exactly 5 SEO keyword phrases to use as DataForSEO seeds.\n"
                f"CRITICAL RULES:\n"
                f"- Seeds must be BROAD PARENT TERMS, not the exact recipe name\n"
                f"- Think: what would someone search to find this TYPE of dish, not this exact recipe\n"
                f"- At least 2 seeds must be broad category terms with high search volume\n"
                f"- At least 2 seeds must be ingredient+method combos\n"
                f"- 1 seed can be close to the recipe name\n"
                f"- Lowercase only. One per line. No numbering. No bullets.\n"
                f"- 2-4 words max per seed\n"
                f"- No generic words: recipe, easy, healthy, best, quick, simple\n\n"
                f"Example for 'Curried Chicken Salad Toasts':\n"
                f"chicken salad\n"
                f"chicken sandwich\n"
                f"curried chicken salad\n"
                f"cold chicken lunch\n"
                f"chicken toast"
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

def generate_keywords_from_title(client, title, yaml_content):
    ingredients_text = format_ingredients_for_prompt(yaml_content)
    msg = client.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=150,
        messages=[{
            "role": "user",
            "content": (
                f"Recipe: {title}\n"
                f"Ingredients: {ingredients_text[:300]}\n\n"
                f"Generate 6-8 SEO keyword phrases someone would search to find this recipe.\n"
                f"Rules:\n"
                f"- Mix broad terms and specific terms\n"
                f"- Include main ingredient + cooking method combos\n"
                f"- Lowercase only. One per line. No numbering.\n"
                f"- No generic words: recipe, easy, healthy, best, quick, simple"
            )
        }]
    )
    lines = msg.content[0].text.strip().split("\n")
    keywords = []
    for line in lines:
        line = line.strip().lstrip("-•123456789. ").strip()
        if line and len(line) > 3:
            keywords.append({"keyword": line, "volume": 0, "competition": 0})
    return {"all": keywords[:8]}

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

        # Skip si keywords déjà fetchés
        state = load_state(slug)
        if state and len(state.get("keywords", {}).get("all", [])) >= 3:
            print(f"{label} SKIP (keywords already done): {slug}")
            stats["skipped"] += 1
            continue

        print(f"{label} {title}")
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

        save_state(slug, title, seeds, kw_data)

        kw_count = len(kw_data["all"])
        if kw_count == 0:
            print(f"  LOW SEO  : 0 from DFS — generating with Haiku")
            kw_data = generate_keywords_from_title(client, title, yaml_content)
            save_state(slug, title, seeds, kw_data)
            save_low_keyword(slug, title)
            stats["low_kw"] += 1
        elif kw_count < 3:
            print(f"  LOW SEO  : only {kw_count} from DFS — completing with Haiku")
            haiku_kw = generate_keywords_from_title(client, title, yaml_content)
            combined = kw_data["all"] + [
                k for k in haiku_kw["all"]
                if k["keyword"] not in [x["keyword"] for x in kw_data["all"]]
            ]
            kw_data = {"all": combined[:8]}
            save_state(slug, title, seeds, kw_data)
            save_low_keyword(slug, title)
            stats["low_kw"] += 1
        else:
            top = kw_data["all"][0]
            print(f"  keywords : {kw_count} | top: '{top['keyword']}' ({top['volume']}/mo)")
            stats["done"] += 1
            time.sleep(4)

    print(f"\n── DONE ──────────────────────────────────")
    print(f"Done    : {stats['done']}")
    print(f"Skipped : {stats['skipped']}")
    print(f"Errors  : {stats['errors']}")
    print(f"Low KW  : {stats['low_kw']}")

if __name__ == "__main__":
    main()
