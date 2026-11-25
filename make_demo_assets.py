#!/usr/bin/env python3
"""
make_demo_assets.py - build the demo kit from CLEAN data you already have.

    python make_demo_assets.py --movements data/synthetic/movements.csv \
                               --counts data/synthetic/counts.csv --out demo --seed 7

Writes into demo/:
  messy_movements.csv   renamed headers, dd/mm/YYYY dates, ERP-style event codes, junk columns
  messy_inout.csv       same, but quantity split into separate In / Out columns
  messy_counts.csv      renamed headers, dd/mm/YYYY dates
  corrupted/C1..Cn/     clean counts + a movement log with ONE planted error each
  corruptions.json      what was planted where, and the gap the engine should report

The corruptions are chosen in windows that reconcile perfectly before the edit,
so the engine should report exactly the gap listed in corruptions.json.
Use these files for the live "pick a transaction" challenge.
"""
from __future__ import annotations

import argparse
import csv
import json
import random
from collections import defaultdict
from datetime import datetime
from pathlib import Path

KINDS = ["double_scan", "qty_typo", "missed_scan", "wrong_location"]
ALIASES = {"receive": "GRN", "pick": "ISSUE", "move": "TRANSFER", "return": "RTN", "adjust": "ADJ"}


def parse_ts(s: str) -> datetime:
    s = s.strip()
    try:
        return datetime.fromisoformat(s)
    except ValueError:
        pass
    for f in ("%d/%m/%Y %H:%M", "%m/%d/%Y %H:%M", "%d/%m/%Y", "%m/%d/%Y", "%Y/%m/%d"):
        try:
            return datetime.strptime(s, f)
        except ValueError:
            continue
    raise ValueError(f"unparseable date: {s!r}")


def load(path):
    with open(path, newline="", encoding="utf-8-sig") as f:
        r = csv.DictReader(f)
        return list(r.fieldnames or []), list(r)


def write(path: Path, cols, rows):
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=cols, extrasaction="ignore")
        w.writeheader()
        w.writerows(rows)


def num(x: float) -> str:
    return str(int(x)) if float(x).is_integer() else str(x)


# ───────────────────────────── messy variants ─────────────────────────────
def messy_files(mcols, mov, ccols, cnt, out: Path):
    rng = random.Random(1)
    mapping = {"ts": "Posting Date", "item": "Material", "location": "Bin", "event_type": "Mvt Type",
               "qty_delta": "Quantity", "doc_no": "Doc Ref", "worker": "Operator", "shift": "Shift Code"}
    keep = [c for c in mcols if c in mapping]
    junk = ["Remarks", "Plant"]

    def base(r):
        o = {mapping[c]: r.get(c, "") for c in keep}
        o["Posting Date"] = parse_ts(r["ts"]).strftime("%d/%m/%Y %H:%M")
        o["Mvt Type"] = ALIASES.get(r["event_type"].strip().lower(), r["event_type"].upper())
        o["Remarks"] = rng.choice(["", "", "", "checked", "see PO"])
        o["Plant"] = "P100"
        return o

    cols = [mapping[c] for c in keep] + junk
    write(out / "messy_movements.csv", cols, [base(r) for r in mov])

    rows2 = []
    for r in mov:
        o = base(r)
        q = float(r["qty_delta"])
        o["Qty In"] = num(q) if q > 0 else ""
        o["Qty Out"] = num(-q) if q < 0 else ""
        o.pop("Quantity", None)
        rows2.append(o)
    cols2 = [c for c in cols if c != "Quantity"] + ["Qty In", "Qty Out"]
    write(out / "messy_inout.csv", cols2, rows2)

    ccols_m = ["Material", "Bin", "Physical Qty", "Count Date"]
    write(out / "messy_counts.csv", ccols_m, [
        {"Material": r["item"], "Bin": r["location"], "Physical Qty": r["counted_qty"],
         "Count Date": parse_ts(r["count_ts"]).strftime("%d/%m/%Y")} for r in cnt])


# ───────────────────────────── corruptions ─────────────────────────────
def clean_windows(mov, cnt):
    """Count-to-count windows that reconcile exactly and have no txn on a boundary."""
    ev = defaultdict(list)
    for i, r in enumerate(mov):
        ev[(r["item"], r["location"])].append((parse_ts(r["ts"]), i))
    cs = defaultdict(list)
    for c in cnt:
        cs[(c["item"], c["location"])].append((parse_ts(c["count_ts"]), float(c["counted_qty"])))
    wins = []
    for key, counts in cs.items():
        counts.sort()
        events = sorted(ev.get(key, []))
        for (t0, q0), (t1, q1) in zip(counts, counts[1:]):
            if any(t == t0 or t == t1 for t, _ in events):
                continue  # boundary ambiguity: skip
            inside = [i for t, i in events if t0 < t < t1]
            if not inside:
                continue
            if abs(q1 - (q0 + sum(float(mov[i]["qty_delta"]) for i in inside))) > 1e-9:
                continue  # already has a gap, not a clean test case
            wins.append({"key": key, "t0": t0, "t1": t1, "rows": inside})
    return wins


def corrupt(mov, row_idx, kind, other_loc):
    rows = [dict(r) for r in mov]
    d = float(rows[row_idx]["qty_delta"])
    if kind == "double_scan":
        rows.insert(row_idx + 1, dict(rows[row_idx]))
        return rows, -d, f"duplicated a {num(d)} posting"
    if kind == "qty_typo":
        rows[row_idx]["qty_delta"] = num(d * 10)
        return rows, -9 * d, f"{num(d)} became {num(d * 10)} (extra zero)"
    if kind == "missed_scan":
        del rows[row_idx]
        return rows, d, f"deleted a {num(d)} posting"
    rows[row_idx]["location"] = other_loc
    return rows, d, f"{num(d)} posted to {other_loc} instead"


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--movements", required=True)
    ap.add_argument("--counts", required=True)
    ap.add_argument("--out", default="demo")
    ap.add_argument("--n", type=int, default=5, help="number of corruption cases")
    ap.add_argument("--seed", type=int, default=7)
    a = ap.parse_args()

    out = Path(a.out)
    mcols, mov = load(a.movements)
    ccols, cnt = load(a.counts)
    messy_files(mcols, mov, ccols, cnt, out)

    rng = random.Random(a.seed)
    wins = clean_windows(mov, cnt)
    rng.shuffle(wins)
    locations = sorted({r["location"] for r in mov})
    used_keys, cases = set(), []
    for w in wins:
        if len(cases) >= a.n:
            break
        if w["key"] in used_keys:
            continue
        rows = [i for i in w["rows"] if float(mov[i]["qty_delta"]) != 0]
        if not rows:
            continue
        kind = KINDS[len(cases) % len(KINDS)]
        i = rng.choice(rows)
        others = [l for l in locations if l != mov[i]["location"]]
        if kind == "wrong_location" and not others:
            continue
        other = rng.choice(others) if others else ""
        new_rows, gap, what = corrupt(mov, i, kind, other)
        cid = f"C{len(cases) + 1}"
        write(out / "corrupted" / cid / "movements.csv", mcols, new_rows)
        write(out / "corrupted" / cid / "counts.csv", ccols, cnt)
        case = {"id": cid, "kind": kind, "item": w["key"][0], "location": w["key"][1],
                "window": [w["t0"].isoformat(), w["t1"].isoformat()],
                "source_file_line": i + 2, "what_changed": what,
                "expected_gap": gap, "dir": str(out / "corrupted" / cid)}
        if kind == "wrong_location":
            case["mirror_gap"] = {"location": other, "gap": -gap}
        cases.append(case)
        used_keys.add(w["key"])

    (out / "corruptions.json").write_text(json.dumps(cases, indent=2))
    print(f"messy files: 3 written to {out}/")
    print(f"clean reconciling windows found: {len(wins)}")
    print(f"corruption cases: {len(cases)} written to {out}/corrupted/")
    for c in cases:
        print(f"  {c['id']}  {c['kind']:<15} {c['item']} @ {c['location']}  expect gap {num(c['expected_gap'])}  ({c['what_changed']})")
    if len(cases) < a.n:
        print(f"WARNING: only {len(cases)} of {a.n} cases possible - need more clean count windows.")


if __name__ == "__main__":
    main()
