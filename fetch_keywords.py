import os
import re
import glob
import json
import time
import requests
import anthropic
from pathlib import Path
from datetime import datetime, timedelta

# ── CONFIG ────────────────────────────────────────────────────────────────────
DFS_LOGIN    = os.environ.get("DATAFORSEO_LOGIN")
DFS_PASSWORD = os.environ.get("DATAFORSEO_PASSWORD")
API_URL      = "https://api.dataforseo.com/v3/keywords_data/google_ads/keywords_for_keywords/live"

batch_size  = int(os.environ.get("BATCH_SIZE", 50))
start_index = int(os.environ.get("START_INDEX", 0))

MIN_VOLUME       = 100
MAX_COMPETITION  = 80
MAX_RESULTS_KEPT = 50

GENERIC = {
    "recipe", "food", "dinner", "recipes", "easy", "healthy",
    "cooking", "make", "best", "how to", "homemade", "simple", "quick"
}

# ── HELPERS ───────────────────────────────────────────────────────────────────
def get_date_range():
    today      = datetime.today()
    # Go back 2 months to get last fully available month
    first_this = today.replace(day=1)
    last_month = (first_this - timedelta(days=1)).replace(day=1) - timedelta(days=1)
    date_from  = last_month.replace(day=1).strftime("%Y-%m-%d")
    date_to    = last_month.strftime("%Y-%m-%d")
    return date_from, date_to
# Today = March 2026 → returns 2026-01-01 to 2026-01-31

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

def already_fetched(slug):
    f = Path(f"keyword_data/{slug}.json")
    if not f.exists():
        return False
    with open(f, "r", encoding="utf-8") as fp:
        data = json.load(fp)
    return len(data.get("keywords", {}).get("all", [])) > 0

def load_skip_list():
    skip_file = Path("seo_skip.txt")
    if not skip_file.exists():
        return set()
    with open(skip_file, "r", encoding="utf-8") as f:
        return set(line.strip() for line in f if line.strip() and not line.startswith("#"))

import json

def get_seed_keywords(client, title, description):

    message = client.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=120,
        messages=[{
            "role": "user",
            "content": f"""Recipe title: {title}
Description: {description[:200]}

Return JSON only with this shape:
{{
 "keywords": [
  "keyword1",
  "keyword2",
  "keyword3",
  "keyword4",
  "keyword5"
 ]
}}

Rules:
- exactly 5 keywords
- lowercase only
- real food search keywords
- include:
  1 exact keyword
  1 long-tail keyword
  1 short/head keyword
  1 SEO variation
  1 broader high-volume keyword
"""
        }]
    )

    text = message.content[0].text.strip()

    try:
        data = json.loads(text)
        keywords = data.get("keywords", [])

        # sécurité : max 5
        return keywords[:5]

    except Exception:
        return []
def fetch_keywords(seed_keyword):
    date_from, date_to = get_date_range()

    payload = [{
        "keywords": [seed_keyword],
        "language_code": "en",
        "sort_by": "search_volume",
        "date_from": date_from,
        "date_to": date_to
    }]

    try:
        import base64
        credentials = base64.b64encode(f"{DFS_LOGIN}:{DFS_PASSWORD}".encode()).decode()
        headers = {
            "Authorization": f"Basic {credentials}",
            "Content-Type": "application/json"
        }
        response = requests.request(
            "POST",
            API_URL,
            headers=headers,
            data=json.dumps(payload),
            timeout=30
        )
        data = response.json()

        if data.get("status_code") != 20000:
            print(f"    API error: {data.get('status_message')}")
            return None

        task = data["tasks"][0]
        if task.get("status_code") != 20000:
            print(f"    Task error: {task.get('status_message')}")
            return None

        all_keywords = []
        for item in (task.get("result") or []):
            kw   = item.get("keyword", "").strip()
            vol  = item.get("search_volume") or 0
            comp = item.get("competition_index") or 0

            if vol < MIN_VOLUME:
                continue
            if comp > MAX_COMPETITION:
                continue
            if kw in GENERIC:
                continue

            all_keywords.append({
                "keyword": kw,
                "volume": vol,
                "competition": comp
            })

        all_keywords.sort(key=lambda x: x["volume"], reverse=True)
        top = all_keywords[:MAX_RESULTS_KEPT]
        
        return {
            "all": top
        }

    except Exception as e:
        print(f"    Exception: {e}")
        return None

def save_keyword_data(slug, title, seed, keywords):
    Path("keyword_data").mkdir(exist_ok=True)
    with open(f"keyword_data/{slug}.json", "w", encoding="utf-8") as f:
        json.dump({
            "slug": slug,
            "title": title,
            "seed_keyword": seed,
            "keywords": keywords,
            "processed": False
        }, f, indent=2, ensure_ascii=False)

        
def save_low_keyword_recipe(slug, title):
    with open("low_keyword_recipes.txt", "a", encoding="utf-8") as f:
        f.write(f"{slug} | {title}\n")

def mark_keyword_file_as_processed(slug):
    path = Path(f"keyword_data/{slug}.json")
    if not path.exists():
        return

    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)

    data["processed"] = True

    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)

# ── MAIN ──────────────────────────────────────────────────────────────────────
def main():
    if not DFS_LOGIN or not DFS_PASSWORD:
        raise ValueError("DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD are required")

    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        raise ValueError("ANTHROPIC_API_KEY is required")

    client       = anthropic.Anthropic(api_key=api_key)
    skip_list    = load_skip_list()
    recipe_files = sorted(glob.glob("content/recipes/*.md"))
    total        = len(recipe_files)
    batch        = recipe_files[start_index:start_index + batch_size]

    print(f"Total recipes : {total}")
    print(f"Skip list     : {len(skip_list)} recipes")
    print(f"Processing    : {len(batch)} recipes (index {start_index} to {start_index + len(batch) - 1})")

    date_from, date_to = get_date_range()
    print(f"Date range    : {date_from} → {date_to}")

    fetched = 0
    skipped = 0
    errors  = 0
    low_kw = 0

    for i, filepath in enumerate(batch):
        slug = Path(filepath).stem

        if slug in skip_list:
            print(f"  [{i+1}] SKIP (blacklist): {slug}")
            skipped += 1
            continue

        if already_fetched(slug):
            print(f"  [{i+1}] SKIP (already fetched): {slug}")
            skipped += 1
            continue

        with open(filepath, "r", encoding="utf-8") as f:
            content = f.read()

        _, yaml_content = extract_yaml_block(content)
        if not yaml_content:
            print(f"  [{i+1}] SKIP (no YAML): {slug}")
            skipped += 1
            continue

        title       = get_field(yaml_content, "title")
        description = get_field(yaml_content, "description")

        if not title:
            print(f"  [{i+1}] SKIP (no title): {slug}")
            skipped += 1
            continue

        print(f"  [{i+1}] Processing: {title}")

        seed = get_seed_keywords(client, title, description)
        print(f"         seed: '{seed}'")

        keywords = fetch_keywords(seed)

        if keywords is None:
            print(f"         ERROR: API failed")
            errors += 1
            continue

        save_keyword_data(slug, title, seed, keywords)
        
        if len(keywords["all"]) == 0 or (len(keywords["all"]) == 1 and keywords["all"][0]["volume"] < 1000):
            save_low_keyword_recipe(slug, title)
            mark_keyword_file_as_processed(slug)
            low_kw += 1
            print(f"         LOW SEO → skipped")
            continue
        
        if keywords["all"]:
            print(f"         OK → {len(keywords['all'])} keywords returned | top: '{keywords['all'][0]['keyword']}' ({keywords['all'][0]['volume']}/mo)")
        else:
            print(f"         WARN: 0 keywords returned for seed '{seed}'")
        
        fetched += 1
        time.sleep(5)
        
    print(f"\n── DONE ──")
    print(f"Fetched : {fetched}")
    print(f"Skipped : {skipped}")
    print(f"Errors  : {errors}")
    print(f"Low keyword recipes : {low_kw}")
    print(f"Estimated cost: ${fetched * 0.075:.2f}")

if __name__ == "__main__":
    main()
