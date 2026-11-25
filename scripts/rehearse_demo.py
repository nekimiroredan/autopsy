"""Run five clean browser rehearsals and record the fifth using Playwright."""

import argparse
from pathlib import Path
from statistics import median
from subprocess import run
from time import perf_counter

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]


def rehearse(browser, url, output=None):
    start = perf_counter()
    options = {"viewport": {"width": 1440, "height": 1000}, "locale": "en"}
    if output:
        options["record_video_dir"] = str(output)
    context = browser.new_context(**options)
    page = None
    try:
        page = context.new_page()
        page.goto(url, wait_until="domcontentloaded")
        page.get_by_role("heading", name="Warehouse overview").wait_for()
        page.get_by_role("button", name="Load sample data").click()
        page.get_by_role("button", name="Load sample data").wait_for()
        page.locator(".hero").get_by_role("link", name="Upload data").click()
        page.get_by_label("Movement log", exact=True).set_input_files(ROOT / "fixtures/messy_3.xlsx")
        page.get_by_role("button", name="Inspect columns").click()
        page.get_by_role("button", name="Confirm & analyze").click()
        page.get_by_role("heading", name="Preflight report").wait_for()
        page.get_by_role("link", name="Open discrepancies").click()
        page.locator("#filters select[name=status]").select_option("opening")
        page.locator("#case-table a.case-link").first.click()
        page.get_by_role("heading", name="Why Autopsy abstained").wait_for()
        page.locator(".sidebar [data-page=upload]").click()
        page.get_by_role("link", name="Open demo").click()
        page.get_by_role("heading", name="Warehouse overview").wait_for()
        page.locator(".sidebar [data-page=discrepancies]").click()
        page.locator("#filters select[name=status]").select_option("diagnosed")
        page.locator("#case-table a.case-link").first.click()
        page.get_by_role("heading", name="Recommended check").wait_for()
        page.get_by_role("heading", name="Ranked hypotheses").wait_for()
        page.get_by_label("Apply repair").check()
        page.locator(".replay-chart").wait_for()
        page.locator(".sidebar [data-page=hotspots]").click()
        page.get_by_role("heading", name="Counterfactual").wait_for()
        page.locator(".sidebar [data-page=trust]").click()
        page.get_by_role("heading", name="Evaluation gates").wait_for()
        page.get_by_role("heading", name="Trust dial").wait_for()
        if output:
            page.wait_for_timeout(1200)
        return perf_counter() - start
    finally:
        context.close()
        if output and page is not None and page.video:
            page.video.save_as(output / "autopsy-demo.webm")
            page.video.delete()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", default="http://127.0.0.1:5000")
    parser.add_argument("--out", type=Path, default=ROOT / "demo")
    args = parser.parse_args()
    elapsed = []
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch()
        try:
            for run in range(5):
                seconds = rehearse(browser, args.url, args.out if run == 4 else None)
                elapsed.append(seconds)
                print(f"Rehearsal {run + 1}: {seconds:.2f} seconds")
        finally:
            browser.close()
    print(f"Median {median(elapsed):.2f} seconds")
    if max(elapsed) >= 300:
        raise SystemExit("A rehearsal exceeded five minutes.")
    run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(args.out / "autopsy-demo.webm"),
         "-c:v", "libx264", "-pix_fmt", "yuv420p", str(args.out / "backup_demo.mp4")], check=True)


if __name__ == "__main__":
    main()
