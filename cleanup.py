import re
import glob
import os
from pathlib import Path

FIELDS_TO_REMOVE = [
    "ingredientsNote",
    "instructionsNote",
    "introduction",
    "faq",
]

recipe_files = sorted(glob.glob("content/recipes/*.md"))
total = len(recipe_files)
cleaned = 0
skipped = 0

for filepath in recipe_files:
    with open(filepath, "r", encoding="utf-8") as f:
        content = f.read()

    match = re.match(r'^---\n(.*?)\n---\n?(.*)', content, re.DOTALL)
    if not match:
        skipped += 1
        continue

    yaml_content = match.group(1)
    body = match.group(2)

    original_yaml = yaml_content

    for field in FIELDS_TO_REMOVE:
        # Champ valeur simple sur une ligne : field: "value"
        yaml_content = re.sub(
            rf'^{field}:[ \t].*\n',
            '',
            yaml_content,
            flags=re.MULTILINE
        )
        # Champ valeur multiline entre guillemets
        yaml_content = re.sub(
            rf'^{field}:[ \t]*".*?"\n',
            '',
            yaml_content,
            flags=re.MULTILINE | re.DOTALL
        )
        # Champ liste multiline (- item\n- item)
        yaml_content = re.sub(
            rf'^{field}:\n(?:- .*\n)*',
            '',
            yaml_content,
            flags=re.MULTILINE
        )

    if yaml_content == original_yaml:
        skipped += 1
        continue

    new_content = f"---\n{yaml_content}\n---\n\n{body.strip()}\n"

    with open(filepath, "w", encoding="utf-8") as f:
        f.write(new_content)

    cleaned += 1

# Push tout d'un coup
os.system('git add content/recipes/ && git commit -m "cleanup: remove old YAML fields" && git push')

print(f"\n── DONE ──────────────────────────────")
print(f"Total   : {total}")
print(f"Cleaned : {cleaned}")
print(f"Skipped : {skipped}")
