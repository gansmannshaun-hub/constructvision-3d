"""Capture marketing screenshots from the running Atlas preview into
/app/frontend/public/screenshots/. Requires the Demo · Villa Atlas project
seeded by /app/backend/tests/seed_demo_villa.py."""
import asyncio, os, sys
from playwright.async_api import async_playwright

URL = "https://build-ai-147.preview.emergentagent.com"
EMAIL = os.environ.get("ADMIN_EMAIL", "admin@atlas.app")
PASSWORD = os.environ.get("ADMIN_PASSWORD", "Open0says3me#*03#*")
OUT = "/app/frontend/public/screenshots"
os.makedirs(OUT, exist_ok=True)

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        ctx = await browser.new_context(viewport={"width": 1600, "height": 1000}, device_scale_factor=2)
        page = await ctx.new_page()
        # Sign in
        await page.goto(f"{URL}/signin", wait_until="networkidle")
        await page.fill("input[type='email']", EMAIL)
        await page.fill("input[type='password']", PASSWORD)
        await page.click("button[type='submit']")
        await page.wait_for_url(f"{URL}/app", timeout=15000)
        await page.wait_for_timeout(2500)
        # Select Demo · Villa Atlas project
        try:
            sel = page.locator("select").first
            await sel.select_option(label="Demo · Villa Atlas")
            await page.wait_for_timeout(3500)
        except Exception as e:
            print("Project switch fallback:", e)

        # Helper
        async def shot(tab_testid, filename, wait=2200, crop=None):
            btn = await page.query_selector(f"[data-testid='{tab_testid}']")
            if btn:
                await btn.click()
                await page.wait_for_timeout(wait)
                if crop:
                    await page.screenshot(path=os.path.join(OUT, filename), quality=80, type="jpeg", clip=crop)
                else:
                    await page.screenshot(path=os.path.join(OUT, filename), quality=80, type="jpeg", full_page=False)
                print(f"✓ {filename}")
            else:
                print(f"✗ tab {tab_testid} not found")

        # Full-viewport captures for each tab
        await shot("tab-blueprint", "atlas-blueprint.jpg", wait=2500)
        await shot("tab-cad",       "atlas-cad.jpg",       wait=3200)
        await shot("tab-renderer",  "atlas-3d.jpg",        wait=5500)
        await shot("tab-materials", "atlas-materials.jpg", wait=2500)
        await shot("tab-field",     "atlas-field.jpg",     wait=2500)
        await shot("tab-payapps",   "atlas-payapps.jpg",   wait=2500)
        # A tighter crop of the CAD canvas alone for a hero visual (excludes the black chrome)
        await page.query_selector("[data-testid='tab-cad']") and await (await page.query_selector("[data-testid='tab-cad']")).click()
        await page.wait_for_timeout(2500)
        svg = await page.query_selector("svg")
        if svg:
            box = await svg.bounding_box()
            if box:
                await page.screenshot(
                    path=os.path.join(OUT, "atlas-cad-crop.jpg"),
                    quality=85, type="jpeg",
                    clip={"x": max(0, box["x"]), "y": max(0, box["y"]),
                          "width": min(1600, box["width"]), "height": min(1000, box["height"])},
                )
                print("✓ atlas-cad-crop.jpg")
        await browser.close()

asyncio.run(main())
