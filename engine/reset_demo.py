"""Back up local feedback and clear learned priors."""

import argparse
import json
import os
import tempfile
from contextlib import ExitStack
from pathlib import Path

from engine.feedback import audit_lock

ROOT = Path(__file__).resolve().parents[1]
LOGS = ("data/feedback.jsonl", "data/feedback_demo.jsonl")
BACKUP = "demo/feedback_backup.json"


def checked_path(root, relative):
    path = root / relative
    blind = root / "data/blind"
    resolved = path.resolve()
    if resolved.is_relative_to(blind) or resolved != path:
        raise ValueError(f"Refusing unsafe feedback path: {relative}")
    if path.exists() and (not path.is_file() or path.stat().st_nlink != 1):
        raise ValueError(f"Refusing non-regular or shared feedback path: {relative}")
    return path


def _write_backup(path, document):
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(dir=path.parent, prefix=".feedback-backup-")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as stream:
            json.dump(document, stream, indent=2)
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        Path(temporary).unlink(missing_ok=True)


def reset(root=ROOT):
    root = Path(root).resolve()
    sources = [checked_path(root, name) for name in LOGS]
    backup = checked_path(root, BACKUP)
    lock_paths = [checked_path(root, relative + ".lock") for relative in LOGS]
    with ExitStack() as stack:
        for lock_path in lock_paths:
            stack.enter_context(audit_lock(lock_path))
        records = {
            relative: [json.loads(line) for line in source.read_text(encoding="utf-8").splitlines()
                       if line.strip()] if source.exists() else []
            for relative, source in zip(LOGS, sources, strict=True)
        }
        document = json.loads(backup.read_text(encoding="utf-8")) if backup.exists() else {"resets": []}
        count = sum(map(len, records.values()))
        if count or not backup.exists():
            document["resets"].append(records)
            _write_backup(backup, document)
        for source in sources:
            source.unlink(missing_ok=True)
        return count


def main():
    argparse.ArgumentParser(description=__doc__).parse_args()
    try:
        count = reset()
    except (OSError, ValueError, KeyError) as error:
        raise SystemExit(f"Demo reset refused: {error}") from error
    print(f"Backed up {count} feedback event(s) to {BACKUP}.")
    print("Learned feedback cleared. Initial priors restored.")


if __name__ == "__main__":
    main()
