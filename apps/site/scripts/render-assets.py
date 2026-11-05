"""Render the site's PNG brand assets with Playwright (Chromium).

  cd apps/site && python3 -m http.server 8794 --bind 127.0.0.1    # in one shell
  python3 scripts/render-assets.py                                 # in another

Writes assets/og-image.png (1200x630, from scripts/og.html), assets/favicon-32.png
(from assets/favicon.svg) and assets/apple-touch-icon.png (180x180, from
scripts/apple-touch-icon.svg). Pass a different base URL as the first argument if the
server runs elsewhere. Set PLAYWRIGHT_CHROMIUM to a browser binary if Playwright's
own download is missing.
"""
import asyncio
import os
import pathlib
import sys

from playwright.async_api import async_playwright

BASE = (sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8794").rstrip("/")
ASSETS = pathlib.Path(__file__).resolve().parent.parent / "assets"

JOBS = [
    # (url, width, height, output)
    ("/scripts/og.html", 1200, 630, "og-image.png"),
    ("/assets/favicon.svg", 32, 32, "favicon-32.png"),
    ("/scripts/apple-touch-icon.svg", 180, 180, "apple-touch-icon.png"),
]


async def main():
    exe = os.environ.get("PLAYWRIGHT_CHROMIUM")
    async with async_playwright() as p:
        browser = await p.chromium.launch(**({"executable_path": exe} if exe else {}))
        for url, w, h, out in JOBS:
            page = await browser.new_page(viewport={"width": w, "height": h}, device_scale_factor=1)
            await page.goto(BASE + url, wait_until="networkidle")
            await page.evaluate("document.fonts && document.fonts.ready")
            await page.wait_for_timeout(300)
            await page.screenshot(path=str(ASSETS / out), clip={"x": 0, "y": 0, "width": w, "height": h},
                                  omit_background=url.endswith(".svg"))
            await page.close()
            print("wrote", ASSETS / out)
        await browser.close()


asyncio.run(main())
