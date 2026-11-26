"""Refresh the local name and recipe index. Prices always come from the calculator."""
import json
from pathlib import Path
import subprocess
import time

BASE = "https://forever-ah.com/v1/houses/6"
DEST = Path(__file__).resolve().parents[1] / "assets" / "forever-catalog.js"


def pages(endpoint):
    offset = 0
    while True:
        url = f"{BASE}/{endpoint}?limit=200&offset={offset}"
        response = subprocess.check_output(["curl", "-fsSL", "--retry", "2", "--max-time", "40", url])
        data = json.loads(response)
        assert data["house"]["house_key"] == 6 and data["house"]["house_id"] == 114
        rows = data["rows"]
        if not rows and offset < data["total"]:
            raise ValueError(f"Incomplete {endpoint} page at {offset}")
        yield from rows
        time.sleep(1.1)
        offset += len(rows)
        if offset >= data["total"]:
            return


def main():
    items = {}
    recipes = {}

    def remember(raw):
        item_id = raw["item_id"]
        if item_id not in items or raw.get("item_class"):
            items[item_id] = dict(id=item_id, name=raw["name"], quality=raw.get("quality", ""),
                                 category=raw.get("item_subclass") or raw.get("item_class") or "Reagent")
        return item_id

    for row in pages("market"):
        remember(row["item"])
    for row in pages("crafting"):
        if not row.get("item"):
            continue
        output = remember(row["item"])
        parts = [[remember(r), r["quantity"]] for r in row["reagents"]]
        if not parts or not all(isinstance(q, int) and q > 0 for _, q in parts):
            continue
        recipes[row["recipe_id"]] = dict(id=row["recipe_id"], name=row["recipe_name"], output=output,
                                        profession=row["profession"], yieldCount=row["crafted_quantity"], parts=parts)
    items = {k:v for k,v in items.items() if isinstance(v["name"], str) and v["name"].strip()}
    recipes = {k:v for k,v in recipes.items() if v["output"] in items and all(i in items for i,_ in v["parts"])}
    if not items or not recipes:
        raise ValueError("Empty catalog")
    catalog = dict(items=sorted(items.values(), key=lambda i: i["id"]),
                   recipes=sorted(recipes.values(), key=lambda r: r["id"]))
    temp = DEST.with_suffix(".tmp")
    temp.write_text("const foreverCatalog = " + json.dumps(catalog, ensure_ascii=True, separators=(",", ":")) + ";\n")
    temp.replace(DEST)
    print(f"{len(items)} items, {len(recipes)} recipes")


if __name__ == "__main__":
    main()
