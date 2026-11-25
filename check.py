#!/usr/bin/env python3
"""
check.py - one-command health check for Inventory Autopsy.

    python check.py              full check
    python check.py --quick      skip slow checks (pytest, eval run, Streamlit)
    python check.py --only data  run only checks whose name contains "data"
    python check.py --json       machine-readable output
    python check.py -v           show details for passing checks too

Stdlib only on purpose, so it still runs when your environment is on fire.
Exit code 1 if anything FAILs. WARNs don't fail the run.
"""
from __future__ import annotations

import argparse
import csv
import importlib.util
import json
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent

# ───────────────────────── EDIT THESE TO MATCH YOUR REPO ─────────────────────────
REQUIRED_PATHS = ["schemas", "ingest", "generator", "engine", "narrator", "app", "eval", "tests"]
REQUIRED_MODULES = ["schemas", "ingest", "generator", "engine.replay", "engine.scoring", "narrator"]
OPTIONAL_MODULES = ["engine.hotspots", "engine.checks", "engine.calibrate", "engine.assign", "eval.run_all"]
REQUIRED_PKGS = ["pandas", "numpy", "flask"]
OPTIONAL_PKGS = ["sklearn", "openpyxl", "pytest"]
APP_ENTRYPOINTS = ["app/Home.py", "app/app.py", "app/main.py", "app/streamlit_app.py", "app.py"]
EVAL_CMD = [sys.executable, "-m", "eval.run_all"]
EVAL_OUT = "eval/results"
DATA_DIRS = ["data", "demo"]
DEMO_FILES = {
    "cached column mapping (API-down backup)": "demo/mapping_cache.json",
    "backup demo video": "demo/backup_demo.mp4",
    "pre-tested corruption list": "demo/corruptions.json",
    "messy sample files": "demo/messy_movements.csv",
}
MOVEMENT_REQ = ["ts", "item", "location", "qty_delta", "event_type"]
COUNT_REQ = ["item", "location", "counted_qty", "count_ts"]
EVIDENCE_REQ = ["id", "item", "location", "window", "expected", "counted", "gap", "hypotheses", "abstain"]
# ──────────────────────────────────────────────────────────────────────────────────

PASS, FAIL, WARN, SKIP = "PASS", "FAIL", "WARN", "SKIP"
CHECKS: list[tuple[str, bool, callable]] = []


def check(name: str, slow: bool = False):
    def deco(fn):
        CHECKS.append((name, slow, fn))
        return fn
    return deco


def run(cmd, timeout=300):
    try:
        p = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True, timeout=timeout)
        return p.returncode, (p.stdout + p.stderr).strip()
    except subprocess.TimeoutExpired:
        return 124, f"timed out after {timeout}s"


def tail(text, n=4):
    return " | ".join(text.strip().splitlines()[-n:])


def has(pkg):
    try:
        return importlib.util.find_spec(pkg) is not None
    except (ImportError, ValueError):
        return False


# ───────────────────────────────── environment ─────────────────────────────────
@check("python version")
def _():
    v = sys.version_info
    ok = v >= (3, 10)
    return (PASS if ok else FAIL), f"{v.major}.{v.minor}.{v.micro}" + ("" if ok else " (need 3.10+)")


@check("packages installed")
def _():
    missing = [p for p in REQUIRED_PKGS if not has(p)]
    soft = [p for p in OPTIONAL_PKGS if not has(p)]
    if missing:
        return FAIL, "missing: " + ", ".join(missing)
    if soft:
        return WARN, "optional missing: " + ", ".join(soft)
    return PASS, f"{len(REQUIRED_PKGS) + len(OPTIONAL_PKGS)} packages found"


@check("repo structure")
def _():
    missing = [p for p in REQUIRED_PATHS if not (ROOT / p).exists()]
    return (FAIL, "missing: " + ", ".join(missing)) if missing else (PASS, f"{len(REQUIRED_PATHS)} paths present")


@check("modules import")
def _():
    script = (
        "import importlib, json, sys, traceback\n"
        "req, opt = json.loads(sys.argv[1]), json.loads(sys.argv[2])\n"
        "out = {'req': {}, 'opt': {}}\n"
        "for kind, mods in (('req', req), ('opt', opt)):\n"
        "    for m in mods:\n"
        "        try:\n"
        "            importlib.import_module(m)\n"
        "        except ModuleNotFoundError as e:\n"
        "            out[kind][m] = 'not found' if e.name == m or m.startswith(str(e.name)) else f'needs {e.name}'\n"
        "        except Exception as e:\n"
        "            out[kind][m] = f'{type(e).__name__}: {e}'\n"
        "print(json.dumps(out))\n"
    )
    rc, out = run([sys.executable, "-c", script, json.dumps(REQUIRED_MODULES), json.dumps(OPTIONAL_MODULES)], 120)
    try:
        res = json.loads(out.splitlines()[-1])
    except Exception:
        return FAIL, "import probe crashed: " + tail(out)
    bad = [f"{m} ({why})" for m, why in res["req"].items()]
    soft = [f"{m} ({why})" for m, why in res["opt"].items()]
    if bad:
        return FAIL, "broken: " + "; ".join(bad)
    if soft:
        return WARN, "optional not importable: " + "; ".join(soft)
    return PASS, f"{len(REQUIRED_MODULES)} required + {len(OPTIONAL_MODULES)} optional modules import clean"


# ─────────────────────────────────── data ───────────────────────────────────
def _ts_ok(s: str) -> bool:
    s = (s or "").strip()
    try:
        datetime.fromisoformat(s)
        return True
    except ValueError:
        pass
    for f in ("%d/%m/%Y %H:%M", "%m/%d/%Y %H:%M", "%d/%m/%Y", "%m/%d/%Y", "%Y/%m/%d"):
        try:
            datetime.strptime(s, f)
            return True
        except ValueError:
            continue
    return False


def _num_ok(s: str) -> bool:
    try:
        float((s or "").strip())
        return True
    except ValueError:
        return False


def _read(path: Path, limit=200_000):
    with open(path, newline="", encoding="utf-8-sig") as f:
        r = csv.DictReader(f)
        cols = r.fieldnames or []
        rows = []
        for i, row in enumerate(r):
            if i >= limit:
                break
            rows.append(row)
    return cols, rows


@check("data files valid")
def _():
    files = []
    for d in DATA_DIRS:
        base = ROOT / d
        if base.exists():
            files += sorted(base.rglob("*.csv"))[:50]
    if not files:
        return WARN, "no CSV files found - generate data first"
    fails, warns, recognized, other = [], [], 0, 0
    by_dir: dict[Path, dict[str, list]] = {}
    for p in files:
        rel = p.relative_to(ROOT)
        try:
            cols, rows = _read(p)
        except Exception as e:
            fails.append(f"{rel}: unreadable ({type(e).__name__})")
            continue
        if set(MOVEMENT_REQ) <= set(cols):
            kind, req, ts_col, num_col = "mov", MOVEMENT_REQ, "ts", "qty_delta"
        elif set(COUNT_REQ) <= set(cols):
            kind, req, ts_col, num_col = "cnt", COUNT_REQ, "count_ts", "counted_qty"
        else:
            other += 1
            continue
        recognized += 1
        if not rows:
            warns.append(f"{rel}: header only, no rows")
            continue
        empty = sum(1 for r in rows if any(not (r.get(c) or "").strip() for c in req))
        bad_ts = sum(1 for r in rows if not _ts_ok(r.get(ts_col, "")))
        bad_num = sum(1 for r in rows if not _num_ok(r.get(num_col, "")))
        if empty or bad_ts or bad_num:
            fails.append(f"{rel}: {empty} rows with blanks, {bad_ts} bad dates, {bad_num} non-numeric qty")
        if kind == "cnt":
            neg = sum(1 for r in rows if _num_ok(r["counted_qty"]) and float(r["counted_qty"]) < 0)
            if neg:
                warns.append(f"{rel}: {neg} negative counts")
        keys = {(r["item"], r["location"]) for r in rows}
        by_dir.setdefault(p.parent, {"mov": set(), "cnt": set()})[kind] |= keys
    for d, g in by_dir.items():
        if g["mov"] and g["cnt"]:
            overlap = len(g["cnt"] & g["mov"]) / len(g["cnt"])
            msg = f"{d.relative_to(ROOT)}: only {overlap:.0%} of counted item/locations appear in movements"
            if overlap == 0:
                fails.append(msg)
            elif overlap < 0.8:
                warns.append(msg)
    if fails:
        return FAIL, "; ".join(fails[:4])
    if recognized == 0:
        return WARN, f"{other} CSVs found, none match the movements/counts schema"
    if warns:
        return WARN, "; ".join(warns[:4])
    return PASS, f"{recognized} schema files clean ({other} other CSVs ignored)"


@check("evidence JSON contract")
def _():
    files = []
    for d in DATA_DIRS + [EVAL_OUT, "outputs"]:
        base = ROOT / d
        if base.exists():
            files += sorted(base.rglob("evidence*.json"))[:20]
    if not files:
        return WARN, "no evidence*.json found - run the engine first"
    hard, soft, n = [], [], 0
    for p in files:
        rel = p.relative_to(ROOT)
        try:
            data = json.loads(p.read_text())
        except Exception as e:
            hard.append(f"{rel}: invalid JSON ({e})")
            continue
        items = data.get("discrepancies", []) if isinstance(data, dict) else data
        for o in items:
            n += 1
            tag = f"{rel}:{o.get('id', '?')}"
            miss = [k for k in EVIDENCE_REQ if k not in o]
            if miss:
                hard.append(f"{tag} missing {miss}")
                continue
            if abs((o["counted"] - o["expected"]) - o["gap"]) > 1e-9:
                hard.append(f"{tag} gap != counted - expected")
            hyps = o["hypotheses"]
            confs = [h.get("confidence") for h in hyps]
            if any(not isinstance(c, (int, float)) or not 0 <= c <= 1 for c in confs):
                hard.append(f"{tag} confidence outside 0..1")
                continue
            if sum(confs) > 1.01:
                hard.append(f"{tag} confidences sum to {sum(confs):.2f}")
            if any(not isinstance(h.get("repair"), dict) for h in hyps):
                hard.append(f"{tag} hypothesis without a repair edit")
            if confs != sorted(confs, reverse=True):
                soft.append(f"{tag} hypotheses not sorted")
            if not o["abstain"] and not hyps:
                hard.append(f"{tag} not abstaining but has no hypotheses")
            if not o["abstain"] and not o.get("suggested_check"):
                soft.append(f"{tag} no suggested_check")
    if hard:
        return FAIL, f"{len(hard)} violations: " + "; ".join(hard[:3])
    if soft:
        return WARN, f"{len(soft)} soft issues: " + "; ".join(soft[:3])
    return PASS, f"{n} discrepancy objects obey the contract"


# ─────────────────────────────── solver honesty ───────────────────────────────
LEAK_DIRS = ["engine", "narrator", "app"]
LEAK_PATTERNS = r"\b(ground_?truth|planted|injected|true_cause|truth_label)\b|^\s*(from|import)\s+(generator|eval)\b|data[/\\]blind"


@check("solver leakage scan")
def _():
    import re
    rx = re.compile(LEAK_PATTERNS, re.IGNORECASE | re.MULTILINE)
    hits = []
    for d in LEAK_DIRS:
        base = ROOT / d
        if not base.exists():
            continue
        for p in base.rglob("*.py"):
            if "__pycache__" in p.parts:
                continue
            for i, line in enumerate(p.read_text(errors="ignore").splitlines(), 1):
                # The reset command rejects this directory before opening any feedback file.
                if p == ROOT / "engine/reset_demo.py" and line.strip() == 'blind = root / "data/blind"':
                    continue
                if rx.search(line):
                    hits.append(f"{p.relative_to(ROOT)}:{i}")
    if hits:
        return FAIL, f"{len(hits)} suspicious refs (solver reading answers?): " + ", ".join(hits[:5])
    return PASS, "no ground-truth, generator, or blind-set references in engine/narrator/app"


# ───────────────────────────── tests / eval / app ─────────────────────────────
@check("pytest suite", slow=True)
def _():
    tests = ROOT / "tests"
    if not tests.exists() or not any(tests.rglob("test_*.py")):
        return WARN, "no tests found"
    if not has("pytest"):
        return SKIP, "pytest not installed"
    rc, out = run([sys.executable, "-m", "pytest", "-q", "-x", "--tb=short"], 300)
    last = out.splitlines()[-1] if out else ""
    return (PASS if rc == 0 else FAIL), last


@check("eval harness runs", slow=True)
def _():
    if not (ROOT / "eval" / "run_all.py").exists():
        return SKIP, "eval/run_all.py not found"
    t = time.time()
    rc, out = run(EVAL_CMD, 900)
    if rc != 0:
        return FAIL, f"exit {rc}: " + tail(out)
    outdir = ROOT / EVAL_OUT
    fresh = [p for p in outdir.rglob("*") if p.is_file() and p.stat().st_mtime >= t - 1] if outdir.exists() else []
    if not fresh:
        return WARN, f"ran OK but wrote nothing new to {EVAL_OUT}/"
    return PASS, f"ran OK, {len(fresh)} fresh output files"


def _entry():
    return next((p for p in APP_ENTRYPOINTS if (ROOT / p).exists()), None)


def _kind(entry):
    txt = (ROOT / entry).read_text(errors="ignore").lower()
    if "streamlit" in txt:
        return "streamlit"
    if "flask" in txt:
        return "flask"
    return "unknown"


FLASK_PROBE = r"""
import importlib, json, sys
sys.path.insert(0, ".")
try:
    mod = importlib.import_module(sys.argv[1])
except Exception as e:
    print("@@R@@" + json.dumps({"fatal": f"import failed: {type(e).__name__}: {e}"})); sys.exit(1)
import flask
app = next((v for v in vars(mod).values() if isinstance(v, flask.Flask)), None)
if app is None and hasattr(mod, "create_app"):
    app = mod.create_app()
if app is None:
    print("@@R@@" + json.dumps({"fatal": "no Flask app object found in " + sys.argv[1]})); sys.exit(1)
app.testing = False
client = app.test_client()
res = {"ok": [], "warn": [], "bad": []}
for rule in app.url_map.iter_rules():
    if "GET" not in rule.methods or rule.arguments or rule.endpoint == "static":
        continue
    try:
        code = client.get(rule.rule).status_code
    except Exception as e:
        res["bad"].append(f"{rule.rule} raised {type(e).__name__}: {e}"); continue
    bucket = "bad" if code >= 500 else "warn" if code >= 400 else "ok"
    res[bucket].append(f"{rule.rule} -> {code}")
print("@@R@@" + json.dumps(res)); sys.exit(1 if res["bad"] else 0)
"""


@check("app renders (no exceptions)", slow=True)
def _():
    entry = _entry()
    if not entry:
        return SKIP, "no app entrypoint found"
    kind = _kind(entry)
    if kind == "flask":
        if not has("flask"):
            return FAIL, "flask not installed"
        rc, out = run([sys.executable, "-c", FLASK_PROBE, entry[:-3].replace("/", ".")], 120)
        line = next((l for l in reversed(out.splitlines()) if l.startswith("@@R@@")), None)
        if line is None:
            return FAIL, "probe crashed: " + tail(out)
        res = json.loads(line[5:])
        if "fatal" in res:
            return FAIL, res["fatal"]
        if res["bad"]:
            return FAIL, "server errors: " + "; ".join(res["bad"][:4])
        if res["warn"]:
            return WARN, f"{len(res['ok'])} routes OK, 4xx on: " + "; ".join(res["warn"][:4])
        return PASS, f"{entry}: {len(res['ok'])} GET routes respond OK"
    if kind == "streamlit":
        if not has("streamlit"):
            return FAIL, "streamlit not installed"
        code = (
            "import sys, json\n"
            "from streamlit.testing.v1 import AppTest\n"
            "at = AppTest.from_file(sys.argv[1], default_timeout=60).run()\n"
            "errs = [str(e.value) for e in at.exception]\n"
            "print(json.dumps(errs)); sys.exit(1 if errs else 0)\n"
        )
        rc, out = run([sys.executable, "-c", code, entry], 120)
        return (PASS, f"{entry} ran its script clean") if rc == 0 else (FAIL, tail(out))
    return SKIP, f"{entry}: can't tell which framework"


@check("app serves over HTTP", slow=True)
def _():
    entry = _entry()
    if not entry:
        return SKIP, "no app entrypoint found"
    kind = _kind(entry)
    if kind != "streamlit":
        return SKIP, f"{kind}: covered by the route sweep above"
    if not has("streamlit"):
        return FAIL, "streamlit not installed"
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]
    log = tempfile.TemporaryFile()
    proc = subprocess.Popen(
        [sys.executable, "-m", "streamlit", "run", entry, "--server.headless", "true",
         "--server.port", str(port), "--browser.gatherUsageStats", "false"],
        cwd=ROOT, stdout=log, stderr=subprocess.STDOUT)
    try:
        deadline = time.time() + 40
        while time.time() < deadline and proc.poll() is None:
            try:
                with urllib.request.urlopen(f"http://127.0.0.1:{port}/_stcore/health", timeout=2) as r:
                    if r.read().strip() == b"ok":
                        return PASS, f"healthy on :{port}"
            except Exception:
                time.sleep(0.5)
        log.seek(0)
        return FAIL, "never became healthy: " + tail(log.read().decode(errors="replace"))
    finally:
        proc.terminate()
        try:
            proc.wait(10)
        except subprocess.TimeoutExpired:
            proc.kill()


# ─────────────────────────────── demo readiness ───────────────────────────────
@check("demo backups ready")
def _():
    missing = [f"{label} ({p})" for label, p in DEMO_FILES.items() if not (ROOT / p).exists()]
    if missing:
        return WARN, "missing: " + "; ".join(missing)
    return PASS, f"all {len(DEMO_FILES)} demo fallbacks present"


@check("LLM key (narrator/mapper)")
def _():
    import os
    if any(os.environ.get(k) for k in ("ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GEMINI_API_KEY")):
        return PASS, "API key found in environment"
    return WARN, "no API key - narrator must use templates, auto-mapping must use cache"


# ─────────────────────────────────── runner ───────────────────────────────────
def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--quick", action="store_true", help="skip slow checks")
    ap.add_argument("--only", help="run checks whose name contains this text")
    ap.add_argument("--json", action="store_true", help="JSON output")
    ap.add_argument("-v", "--verbose", action="store_true")
    a = ap.parse_args()

    results = []
    for name, slow, fn in CHECKS:
        if a.only and a.only.lower() not in name.lower():
            continue
        if a.quick and slow:
            results.append((name, SKIP, "slow check skipped (--quick)", 0.0))
            continue
        t = time.time()
        try:
            status, detail = fn()
        except Exception as e:  # a crashing check is a failing check
            status, detail = FAIL, f"check crashed: {type(e).__name__}: {e}"
        results.append((name, status, detail, time.time() - t))

    counts = {s: sum(1 for r in results if r[1] == s) for s in (PASS, WARN, FAIL, SKIP)}
    if a.json:
        print(json.dumps({"counts": counts, "results": [
            {"name": n, "status": s, "detail": d, "seconds": round(t, 2)} for n, s, d, t in results]}, indent=2))
    else:
        tty = sys.stdout.isatty()
        col = {PASS: "32", FAIL: "31", WARN: "33", SKIP: "90"}
        paint = lambda s, t: f"\033[{col[s]}m{t}\033[0m" if tty else t
        width = max((len(r[0]) for r in results), default=10)
        print(f"\nInventory Autopsy health check  ({ROOT})\n")
        for n, s, d, t in results:
            line = f"  {paint(s, s):<{4 + (9 if tty else 0)}}  {n:<{width}}  {t:5.1f}s"
            print(line)
            if d and (a.verbose or s != PASS):
                print(f"        {d}")
        print(f"\n  {counts[PASS]} pass, {counts[WARN]} warn, {counts[FAIL]} fail, {counts[SKIP]} skipped\n")
    sys.exit(1 if counts[FAIL] else 0)


if __name__ == "__main__":
    main()
