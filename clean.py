#!/usr/bin/env python3
"""
clean.py - safe cleanup for Inventory Autopsy.

    python clean.py                 DRY RUN: show what junk would go (default)
    python clean.py --yes           delete caches and junk
    python clean.py --generated     also include generated data + eval outputs
    python clean.py --all           everything above, plus build artifacts
    python clean.py --all --yes     actually do it

Never touches: .git, virtualenvs, source code, the blind test set, pilot data,
or demo fallbacks. Those are in PROTECTED and nothing overrides them.
"""
from __future__ import annotations

import argparse
import os
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent

# ───────────────────────── EDIT THESE TO MATCH YOUR REPO ─────────────────────────
JUNK_DIRS = {"__pycache__", ".pytest_cache", ".mypy_cache", ".ruff_cache", ".ipynb_checkpoints", ".hypothesis"}
JUNK_FILE_SUFFIXES = (".pyc", ".pyo", ".log", ".tmp")
JUNK_FILE_NAMES = {".coverage", ".DS_Store", "Thumbs.db"}
GENERATED = ["data/synthetic", "data/generated", "eval/out", "outputs"]
BUILD = ["build", "dist", "htmlcov", ".streamlit/cache", "autopsy.egg-info"]
SKIP_WALK = {".git", ".venv", "venv", "env", "node_modules", "site-packages"}
PROTECTED = ["data/blind", "data/pilot", "demo", ".git", ".venv", "venv"]
# ──────────────────────────────────────────────────────────────────────────────────


def is_protected(p: Path) -> bool:
    rp = p.resolve()
    for prot in PROTECTED:
        pp = (ROOT / prot).resolve()
        if rp == pp or pp in rp.parents:
            return True
    return False


def size_of(p: Path) -> int:
    if p.is_file() or p.is_symlink():
        try:
            return p.lstat().st_size
        except OSError:
            return 0
    total = 0
    for dp, _, fns in os.walk(p):
        for f in fns:
            try:
                total += (Path(dp) / f).lstat().st_size
            except OSError:
                pass
    return total


def human(n: float) -> str:
    for u in ("B", "KB", "MB", "GB"):
        if n < 1024 or u == "GB":
            return f"{n:.0f} {u}" if u == "B" else f"{n:.1f} {u}"
        n /= 1024


def collect(include_generated: bool, include_build: bool):
    targets: dict[Path, str] = {}
    for dp, dns, fns in os.walk(ROOT):
        here = Path(dp)
        keep = []
        for d in dns:
            if d in SKIP_WALK:
                continue
            if d in JUNK_DIRS:
                targets[here / d] = "cache"
                continue  # don't descend into something we're deleting
            keep.append(d)
        dns[:] = keep
        for f in fns:
            if f in JUNK_FILE_NAMES or f.endswith(JUNK_FILE_SUFFIXES):
                targets[here / f] = "junk file"
    extra = []
    if include_generated:
        extra += [(g, "generated") for g in GENERATED]
    if include_build:
        extra += [(b, "build") for b in BUILD]
    for rel, label in extra:
        p = ROOT / rel
        if p.exists():
            targets[p] = label
    return targets


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--yes", action="store_true", help="actually delete (default is dry run)")
    ap.add_argument("--generated", action="store_true", help="include generated data and eval outputs")
    ap.add_argument("--all", action="store_true", help="junk + generated + build artifacts")
    a = ap.parse_args()

    targets = collect(a.generated or a.all, a.all)
    keep, skipped = [], []
    for p, label in sorted(targets.items()):
        if is_protected(p):
            skipped.append(p)
        elif ROOT.resolve() not in p.resolve().parents:
            skipped.append(p)  # refuse anything that resolves outside the repo
        else:
            keep.append((p, label))

    if not keep:
        print("Nothing to clean.")
        for p in skipped:
            print(f"  protected, left alone: {p.relative_to(ROOT)}")
        return

    total = 0
    print(("DELETING" if a.yes else "DRY RUN - would delete") + f" ({ROOT})\n")
    by_label: dict[str, list] = {}
    for p, label in keep:
        by_label.setdefault(label, []).append(p)
    for label, paths in by_label.items():
        sz = sum(size_of(p) for p in paths)
        total += sz
        print(f"  {label:<10} {len(paths):>4} items  {human(sz):>9}")
        for p in paths[:8]:
            print(f"      {p.relative_to(ROOT)}")
        if len(paths) > 8:
            print(f"      ... and {len(paths) - 8} more")
    for p in skipped:
        print(f"  protected, left alone: {p.relative_to(ROOT)}")

    if not a.yes:
        print(f"\n{human(total)} reclaimable. Re-run with --yes to delete.")
        return

    errors = 0
    for p, _ in keep:
        try:
            if p.is_dir() and not p.is_symlink():
                shutil.rmtree(p)
            else:
                p.unlink()
        except OSError as e:
            errors += 1
            print(f"  could not remove {p.relative_to(ROOT)}: {e}", file=sys.stderr)
    print(f"\nFreed about {human(total)}." + (f" {errors} item(s) failed." if errors else ""))
    sys.exit(1 if errors else 0)


if __name__ == "__main__":
    main()
