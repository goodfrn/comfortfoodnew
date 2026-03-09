import os
import re
import glob
import json
import time
import requests
from pathlib import Path

# ── CONFIG ────────────────────────────────────────────────────────────────────
DFS_LOGIN    = os.environ.get("DATAFORSEO_LOGIN")
DFS_PASSWORD = os.environ.get("DATAFORSEO_PASSWORD")
API_URL      = "https://api.dataforseo.com/v3/keywords_data/google_ads/keywords_for_keywords/live"

batch_size  = int(os.environ.get("BATCH_SIZE", 50))
start_index = int(os.environ.get("START_INDEX", 0))

MIN_VOLUME       = 100
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
    return Path(f"keyword_data/{slug}.json").exists()

def load_skip_list():
    skip_file = Path("seo_skip.txt")
    if not skip_file.exists():
        return set()
    with open(skip_file, "r", encoding="utf-8") as f:
        return set(line.strip() for line in f if line.strip())

def fetch_keywords(title):
    seed = [title.lower()]
    words = title.lower().split()
    if len(words) >= 3:
        seed.append(" ".join(words[:3]))
    if len(words) >= 2:
        seed.append(" ".join(words[:2]))

    payload = [{
        "keywords": seed[:5],
        "location_code": 2826,
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

        GENERIC = {"recipe", "food", "dinner", "recipes", "easy", "healthy", "cooking", "make", "best", "how to"}

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

        # Classify primary / secondary / lsi
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

def save_keyword_data(slug, title, keywords):
    Path("keyword_data").mkdir(exist_ok=True)
    with open(f"keyword_data/{slug}.json", "w", encoding="utf-8") as f:
        json.dump({
            "slug": slug,
            "title": title,
            "keywords": keywords,
            "processed": False
        }, f, indent=2, ensure_ascii=False)

# ── MAIN ──────────────────────────────────────────────────────────────────────
def main():
    if not DFS_LOGIN or not DFS_PASSWORD:
        raise ValueError("DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD are required")

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

        title = get_field(yaml_content, "title")
        if not title:
            print(f"  [{i+1}] SKIP (no title): {slug}")
            skipped += 1
            continue

        print(f"  [{i+1}] Fetching: {title}")

        keywords = fetch_keywords(title)

        if keywords is None:
            print(f"         ERROR: API failed")
            errors += 1
            continue

        save_keyword_data(slug, title, keywords)

        if keywords["primary"]:
            print(f"         OK → primary: '{keywords['primary']['keyword']}' ({keywords['primary']['volume']}/mo) | {len(keywords['all'])} total")
        else:
            print(f"         OK: 0 keywords returned (low volume)")

        fetched += 1
        time.sleep(5)

    print(f"\n── DONE ──")
    print(f"Fetched : {fetched}")
    print(f"Skipped : {skipped}")
    print(f"Errors  : {errors}")
    print(f"Estimated cost: ${fetched * 0.075:.2f}")

if __name__ == "__main__":
    main()
