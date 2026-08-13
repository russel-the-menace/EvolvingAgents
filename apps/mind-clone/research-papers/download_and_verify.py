from __future__ import annotations

import csv
import hashlib
import shutil
import subprocess
from pathlib import Path

from pypdf import PdfReader


ROOT = Path(__file__).resolve().parent
MANIFEST = ROOT / "papers.tsv"
TMP = ROOT / "tmp"


def download(url: str, target: Path) -> None:
    partial = TMP / f"{target.name}.part"
    subprocess.run(
        [
            "curl",
            "--fail",
            "--location",
            "--retry",
            "3",
            "--connect-timeout",
            "20",
            "--max-time",
            "180",
            "--user-agent",
            "Mozilla/5.0 MindClone literature review",
            "--output",
            str(partial),
            url,
        ],
        check=True,
    )
    with partial.open("rb") as stream:
        if stream.read(5) != b"%PDF-":
            raise ValueError("download is not a PDF")
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.move(partial, target)


def inspect(target: Path) -> tuple[int, str, int]:
    reader = PdfReader(target)
    pages = len(reader.pages)
    if pages < 2:
        raise ValueError(f"unexpected page count: {pages}")
    digest = hashlib.sha256(target.read_bytes()).hexdigest()
    return pages, digest, target.stat().st_size


def main() -> None:
    TMP.mkdir(exist_ok=True)
    rows = list(csv.DictReader(MANIFEST.open(encoding="utf-8"), delimiter="\t"))
    results: list[dict[str, str | int]] = []
    failures: list[str] = []

    for index, row in enumerate(rows, start=1):
        target = ROOT / row["group"] / row["filename"]
        try:
            if not target.exists():
                print(f"[{index}/{len(rows)}] downloading {row['filename']}", flush=True)
                download(row["url"], target)
            pages, digest, size = inspect(target)
            results.append(
                {
                    **row,
                    "pages": pages,
                    "bytes": size,
                    "sha256": digest,
                    "status": "verified",
                }
            )
        except Exception as exc:
            target.unlink(missing_ok=True)
            failures.append(f"{row['filename']}: {exc}")
            results.append({**row, "pages": "", "bytes": "", "sha256": "", "status": f"failed: {exc}"})

    with (ROOT / "verification.tsv").open("w", encoding="utf-8", newline="") as stream:
        fieldnames = ["group", "filename", "title", "url", "pages", "bytes", "sha256", "status"]
        writer = csv.DictWriter(stream, fieldnames=fieldnames, delimiter="\t")
        writer.writeheader()
        writer.writerows(results)

    shutil.rmtree(TMP, ignore_errors=True)
    print(f"Verified {len(rows) - len(failures)}/{len(rows)} PDFs")
    if failures:
        print("Failures:")
        for failure in failures:
            print(f"- {failure}")
        raise SystemExit(1)


if __name__ == "__main__":
    main()
