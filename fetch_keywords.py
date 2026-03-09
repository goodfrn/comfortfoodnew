import os
import re
import glob
import json
import time
import requests
import anthropic
from pathlib import Path

# ── CONFIG ────────────────────────────────────────────────────────────────────
DFS_LOGIN    = os.environ.get("DATAFORSEO_LOGIN")
DFS_PASSWORD = os.environ.get("DATAFORSEO_PASSWORD")
API_URL      = "https://api.dataforseo.com/v3/keywords_data/google_ads/keywords_for_keywords/live"

batch_size  = int(os.environ.get("BATCH_SIZE", 50))
start_index = int(os.environ.get("START_INDEX", 0))

MIN_VOLUME       = 50
MAX_COMPETITION  = 80
MAX_RESULTS_KEPT = 15

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

def already_fetched(slug):
    f = Path(f"keyword_data/{slug}.json")
    if not f.exists():
        return False
    with open(f, "r", encoding="utf-8") as fp:
        data = json.load(fp)
    # refetch si primary est null
    return data.get("keywords", {}).get("primary") is not None

def load_skip_list():
    skip_file = Path("seo_skip.txt")
    if not skip_file.exists():
        return set()
    with open(skip_file, "r", encoding="utf-8") as f:
        return set(line.strip() for line in f if line.strip() and not line.startswith("#"))

def get_seed_keyword(client, title, description):
    """Use Haiku to extract the best seed keyword from title + description"""
    message = client.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=20,
        messages=[{
            "role": "user",
            "content": f"""Recipe title: {title}
Description: {description[:200]}

Return the single most searched Google keyword for this recipe.
Short, simple, no fluff. Just the keyword, nothing else."""
        }]
    )
    return message.content[0].text.strip().lower()

def fetch_keywords(seed_keyword):
    """Call DataForSEO with seed keyword — worldwide, no location filter"""
    payload = [{
        "keywords": [seed_keyword],
        "language_code": "en",
        "sort_by": "search_volume"
    }]

    try:
        response = requests.post(
            API_URL,
            auth=(DFS_LOGIN, DFS_PASSWORD),
            json=payload,
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

        GENERIC = {"recipe", "food", "dinner", "recipes", "easy", "healthy",
                   "cooking", "make", "best", "how to", "homemade", "simple", "quick"}

        all_keywords = []
        for result in (task.get("result") or []):
            for item in (result.get("items") or []):
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

        primary   = top[0] if len(top) > 0 else None
        secondary = top[1:4] if len(top) > 1 else []
        lsi       = top[4:] if len(top) > 4 else []

        return {
            "primary": primary,
            "secondary": secondary,
            "lsi": lsi,
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

    fetched = 0
    skipped = 0
    errors  = 0

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

        # Haiku génère le seed keyword propre
        seed = get_seed_keyword(client, title, description)
        print(f"         seed: '{seed}'")

        # DataForSEO avec le seed propre
        keywords = fetch_keywords(seed)

        if keywords is None:
            print(f"         ERROR: API failed")
            errors += 1
            continue

        save_keyword_data(slug, title, seed, keywords)

        if keywords["primary"]:
            print(f"         OK → primary: '{keywords['primary']['keyword']}' ({keywords['primary']['volume']}/mo) | {len(keywords['all'])} total")
        else:
            print(f"         WARN: 0 keywords returned for seed '{seed}'")

        fetched += 1
        time.sleep(5)

    print(f"\n── DONE ──")
    print(f"Fetched : {fetched}")
    print(f"Skipped : {skipped}")
    print(f"Errors  : {errors}")
    print(f"Estimated cost: ${fetched * 0.075:.2f}")

if __name__ == "__main__":
    main()
