import os
import re
import glob
import anthropic

# ── TAXONOMY ──────────────────────────────────────────────────────────────────
ALLOWED_TAGS = [
    "comfort food", "snack", "cheese", "vegetarian", "chocolate", "cake",
    "vegan", "chicken", "italian", "salad", "appetizer", "summer", "seafood",
    "healthy", "pasta", "beef", "spicy", "holiday", "breakfast", "cookies",
    "spice", "bread", "mediterranean", "grilling", "party", "easy dinner",
    "apple", "fall", "drink", "almond", "pork", "homemade", "asian", "coconut",
    "gluten free", "soup", "caramel", "cocktail", "potato", "mexican",
    "southern", "bacon", "slow cooker", "citrus", "fried", "lemon", "sandwich",
    "mushroom", "corn", "cinnamon", "side dish", "no bake", "honey", "eggs",
    "rice", "tart", "pie", "turkey", "roasted", "sausage", "one pot", "pumpkin",
    "candy", "peanut butter", "pecan", "avocado", "chili", "gin", "banana",
    "rum", "tofu", "brownies", "muffins", "stew", "pineapple", "mint",
    "spinach", "blueberry", "vanilla", "ricotta", "ham", "gelatin", "lamb",
    "shrimp", "cupcakes", "meatball", "air fryer", "indian", "veal",
    "condiment", "steak", "broccoli", "cabbage", "walnut", "espresso", "salmon",
    "burger", "pancakes", "strawberry", "easter", "japanese", "chorizo",
    "fudge", "cranberry", "pesto", "cherry", "salsa", "greek", "asparagus",
    "jam", "caribbean", "tacos", "barley", "sesame", "pistachio", "cajun",
    "zucchini", "quinoa", "pretzel", "instant pot", "duck", "harissa",
    "smoothie", "cornbread", "vodka", "pizza", "british", "lentils",
    "raspberry", "korean", "mascarpone", "tuna", "quiche", "brioche",
    "pressure cooker", "cauliflower", "spelt", "gravy", "chutney", "molasses",
    "hazelnut", "main dish", "oatmeal", "lobster", "crab", "risotto",
    "chickpeas", "fennel", "peach", "thai", "vietnamese", "meatloaf",
    "fritters", "chai", "shortbread", "elderflower", "crumble",
    "eastern european", "omelet", "blondies", "squash", "wraps", "beet",
    "cucumber", "dry rub", "fondue", "eggplant", "moroccan", "couscous",
    "coffee cake", "popcorn", "dessert", "american", "french", "easy"
]

TAGS_LIST_STR = "\n".join(f"- {t}" for t in ALLOWED_TAGS)

# ── HELPERS ───────────────────────────────────────────────────────────────────
def extract_yaml_block(content):
    """Extract the YAML frontmatter from a markdown file."""
    match = re.match(r'^---\n(.*?)\n---', content, re.DOTALL)
    if match:
        return match.group(0), match.group(1)
    return None, None

def get_title_and_description(yaml_content):
    """Extract title and description from YAML content."""
    title = ""
    description = ""
    
    title_match = re.search(r'^title:\s*["\']?(.*?)["\']?\s*$', yaml_content, re.MULTILINE)
    if title_match:
        title = title_match.group(1).strip('"\'')
    
    desc_match = re.search(r'^description:\s*["\']?(.*?)["\']?\s*$', yaml_content, re.MULTILINE)
    if desc_match:
        description = desc_match.group(1).strip('"\'')[:300]
    
    return title, description

def replace_tags_in_content(content, new_tags):
    """Replace the tags section in the markdown file."""
    tags_yaml = "tags:\n" + "\n".join(f'- "{tag}"' for tag in new_tags)
    
    # Replace existing tags block
    new_content = re.sub(
        r'tags:\n(?:- .*\n)*',
        tags_yaml + "\n",
        content
    )
    
    # If no tags block found, add after categories
    if new_content == content:
        new_content = re.sub(
            r'(categories:.*?\n(?:- .*\n)*)',
            r'\1' + tags_yaml + "\n",
            new_content
        )
    
    return new_content

def get_tags_from_claude(client, title, description, current_tags):
    """Call Claude Haiku to get the best tags for a recipe."""
    prompt = f"""You are a recipe tag classifier. Choose exactly 5 tags from the allowed list below that best match this recipe.

Recipe title: {title}
Recipe description: {description}
Current tags: {', '.join(current_tags)}

ALLOWED TAGS (choose ONLY from this list):
{TAGS_LIST_STR}

Rules:
- Choose exactly 5 tags
- Only use tags from the allowed list above
- Pick the most specific and relevant tags
- Return only the 5 tags, one per line, no numbering, no extra text

Your 5 tags:"""

    message = client.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=100,
        messages=[{"role": "user", "content": prompt}]
    )
    
    response_text = message.content[0].text.strip()
    tags = [line.strip().strip('- "\'') for line in response_text.split('\n') if line.strip()]
    
    # Validate — keep only tags that are in our allowed list
    valid_tags = [t for t in tags if t.lower() in [a.lower() for a in ALLOWED_TAGS]]
    
    # Normalize to exact case from ALLOWED_TAGS
    normalized = []
    for t in valid_tags:
        for allowed in ALLOWED_TAGS:
            if t.lower() == allowed.lower():
                normalized.append(allowed)
                break
    
    return normalized[:5]

# ── MAIN ──────────────────────────────────────────────────────────────────────
def main():
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        raise ValueError("ANTHROPIC_API_KEY not set")
    
    batch_size = int(os.environ.get("BATCH_SIZE", 50))
    start_index = int(os.environ.get("START_INDEX", 0))
    
    client = anthropic.Anthropic(api_key=api_key)
    
    # Get all recipe files
    recipe_files = sorted(glob.glob("content/recipes/*.md"))
    total = len(recipe_files)
    
    batch = recipe_files[start_index:start_index + batch_size]
    
    print(f"Total recipes: {total}")
    print(f"Processing: {len(batch)} recipes (index {start_index} to {start_index + len(batch) - 1})")
    
    updated = 0
    skipped = 0
    errors = 0
    
    for i, filepath in enumerate(batch):
        try:
            with open(filepath, 'r', encoding='utf-8') as f:
                content = f.read()
            
            full_block, yaml_content = extract_yaml_block(content)
            if not yaml_content:
                print(f"  [{i+1}] SKIP (no YAML): {filepath}")
                skipped += 1
                continue
            
            title, description = get_title_and_description(yaml_content)
            if not title:
                print(f"  [{i+1}] SKIP (no title): {filepath}")
                skipped += 1
                continue
            
            # Get current tags
            current_tags_match = re.findall(r'^- ["\']?(.*?)["\']?\s*$', 
                re.search(r'tags:\n((?:- .*\n)*)', yaml_content, re.MULTILINE).group(1) 
                if re.search(r'tags:\n((?:- .*\n)*)', yaml_content, re.MULTILINE) else "",
                re.MULTILINE)
            
            # Get new tags from Claude
            new_tags = get_tags_from_claude(client, title, description, current_tags_match)
            
            if len(new_tags) < 3:
                print(f"  [{i+1}] SKIP (not enough valid tags returned): {title}")
                skipped += 1
                continue
            
            # Replace tags in file
            new_content = replace_tags_in_content(content, new_tags)
            
            if new_content != content:
                with open(filepath, 'w', encoding='utf-8') as f:
                    f.write(new_content)
                print(f"  [{i+1}] UPDATED: {title} → {new_tags}")
                updated += 1
            else:
                print(f"  [{i+1}] NO CHANGE: {title}")
                skipped += 1
                
        except Exception as e:
            print(f"  [{i+1}] ERROR: {filepath} — {e}")
            errors += 1
    
    print(f"\n── DONE ──")
    print(f"Updated: {updated}")
    print(f"Skipped: {skipped}")
    print(f"Errors:  {errors}")

if __name__ == "__main__":
    main()
