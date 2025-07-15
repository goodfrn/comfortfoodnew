IMG_DIR := static/images

.PHONY: webp

webp:
	find $(IMG_DIR) -type f \( -iname '*.jpg' -o -iname '*.jpeg' -o -iname '*.png' \) -print0 \
	| while IFS= read -r -d '' file; do \
	    cwebp -q 80 "$$file" -o "$${file%.*}.webp"; \
	  done
