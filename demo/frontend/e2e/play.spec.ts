import { test, expect, type ConsoleMessage, type Page } from '@playwright/test';

/**
 * Smoke tests for /play/, the six-step decision game (entry -> budget -> build
 * -> predict -> run -> optimiser -> conclusions; run/optimiser/conclusions are
 * placeholders). Each test starts from a fresh browser context (Playwright's
 * default), so localStorage/hash state never leaks between tests.
 *
 * Targeting strategy: role/label/text locators where the DOM offers them
 * (candidates and the tracker route are `role="button"` with aria-labels);
 * class locators for markup with no accessible name (the step card, the
 * meter). Placed stations have no distinguishing class of their own, so
 * "N stations placed" is read two ways that must agree: the meter's own
 * count (`.playmeter b.mono`) and the drop in free-candidate markers
 * (`.candidates > g[role="button"]`), since a placed candidate leaves the
 * free layer entirely (useStepContent.tsx `free` filters out `placedIds`).
 */

const PLAY = 'play/';

function collectPageErrors(page: Page) {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on('pageerror', (err) => pageErrors.push(String(err?.message ?? err).slice(0, 300)));
  page.on('console', (msg: ConsoleMessage) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text().slice(0, 300));
  });
  return { pageErrors, consoleErrors };
}

/** Entry -> pick the 20 k€ plan -> Next. Leaves the session on `build`. */
async function toBuild(page: Page) {
  await page.goto(PLAY);
  await page.getByRole('button', { name: 'Take the job' }).click();
  await page.locator('.scard', { hasText: 'Starter' }).getByRole('button', { name: 'Choose this budget' }).click();
  await page.getByRole('button', { name: 'Go and place the stations' }).click();
  await expect(page.locator('.step-build')).toBeVisible();
  // The bottom sheet (phone/tablet) re-snaps per step with a 250ms CSS
  // transition (useBottomSheet.ts SNAP); settle before interacting so a tap
  // near the map's edge does not land on the still-animating sheet.
  await page.waitForTimeout(350);
}

function freeCandidates(page: Page) {
  return page.locator('.mapcard .candidates > g[role="button"]');
}

function placedCountFromMeter(page: Page) {
  return page.locator('.playmeter b.mono').first();
}

test.describe('play: load and console health', () => {
  test('a. page loads at play/, no page errors, no console errors', async ({ page }) => {
    const { pageErrors, consoleErrors } = collectPageErrors(page);
    const response = await page.goto(PLAY);
    expect(response?.status()).toBeLessThan(400);
    await expect(page.locator('.playapp')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Take the job' })).toBeVisible();
    // let the island hydrate and any async warnings surface
    await page.waitForTimeout(1000);
    test.info().annotations.push({ type: 'pageErrors', description: JSON.stringify(pageErrors) });
    test.info().annotations.push({ type: 'consoleErrors', description: JSON.stringify(consoleErrors) });
    expect(pageErrors, `page errors: ${pageErrors.join(' | ')}`).toEqual([]);
    expect(consoleErrors, `console errors: ${consoleErrors.join(' | ')}`).toEqual([]);
  });
});

test.describe('play: entry -> budget -> build', () => {
  test('b. picking the 20k plan reaches build; tracker shows build current', async ({ page }) => {
    await toBuild(page);
    const compactCount = await page.locator('.tracker.compact').count();
    if (compactCount > 0) {
      await expect(page.locator('.trackpos')).toContainText('2 of 6');
    } else {
      const current = page.locator('.tracker .trackitem.current');
      await expect(current).toHaveCount(1);
      await expect(current).toContainText('Build');
    }
  });
});

test.describe('play: build - tap placement', () => {
  test('c. tap places/removes exactly one station; drag pans without placing; Enter places via keyboard', async ({ page }) => {
    await toBuild(page);

    const before = await freeCandidates(page).count();
    expect(before).toBeGreaterThan(0);
    await expect(placedCountFromMeter(page)).toHaveText('0');

    // Tap the centre of the first candidate's bounding box.
    const target = freeCandidates(page).first();
    const box = await target.boundingBox();
    expect(box).not.toBeNull();
    const cx = box!.x + box!.width / 2;
    const cy = box!.y + box!.height / 2;
    await page.mouse.click(cx, cy);

    await expect(placedCountFromMeter(page)).toHaveText('1');
    const afterPlace = await freeCandidates(page).count();
    expect(afterPlace).toBe(before - 1);

    // Tap the SAME point again: the hit test runs against every candidate
    // (placed or free — useStepContent.tsx `hitCandidates`), so this should
    // toggle the same station off again.
    await page.mouse.click(cx, cy);
    await expect(placedCountFromMeter(page)).toHaveText('0');
    const afterRemove = await freeCandidates(page).count();
    expect(afterRemove).toBe(before);

    // A drag (mouse down, move 60px, up) on empty map space must pan, not place.
    // Start from the map's CENTRE, not a corner: the zoom buttons
    // (`.mapzoom`, MapFrame.tsx) overlay the top-left corner of `.mapcard`
    // and would intercept a pointerdown aimed at `mapBox + (20,20)`.
    const mapSvg = page.locator('.mapcard svg').first();
    const mapBox = await mapSvg.boundingBox();
    expect(mapBox).not.toBeNull();
    const dragStartX = mapBox!.x + mapBox!.width / 2;
    const dragStartY = mapBox!.y + mapBox!.height / 2;
    const svgBefore = await mapSvg.getAttribute('viewBox');
    const placedBeforeDrag = await placedCountFromMeter(page).textContent();
    await page.mouse.move(dragStartX, dragStartY);
    await page.mouse.down();
    await page.mouse.move(dragStartX + 60, dragStartY + 10, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(100);
    const svgAfter = await mapSvg.getAttribute('viewBox');
    const placedAfterDrag = await placedCountFromMeter(page).textContent();
    expect(placedAfterDrag).toBe(placedBeforeDrag);
    expect(svgAfter).not.toBe(svgBefore);

    // Keyboard path: focus a free candidate and press Enter.
    const beforeKeyboard = await freeCandidates(page).count();
    const kbCandidate = freeCandidates(page).first();
    await kbCandidate.focus();
    await page.keyboard.press('Enter');
    const afterKeyboard = await freeCandidates(page).count();
    expect(afterKeyboard).toBe(beforeKeyboard - 1);
  });
});

test.describe('play: build - assistant', () => {
  test('d. "help me" places N=10 assisted stations; Undo reverts', async ({ page }) => {
    await toBuild(page);
    const nSpan = page.locator('.playassistn');
    const n = Number((await nSpan.textContent())?.trim() ?? '0');
    expect(n).toBeGreaterThan(0);
    test.info().annotations.push({ type: 'assist-n', description: String(n) });

    const freeBefore = await freeCandidates(page).count();
    await page.getByRole('button', { name: 'Place them for me' }).click();

    await expect(placedCountFromMeter(page)).toHaveText(String(n));
    const freeAfter = await freeCandidates(page).count();
    expect(freeAfter).toBe(freeBefore - n);
    await expect(page.locator('.playwho')).toContainText(`the assistant ${n}`);

    await page.getByRole('button', { name: /Undo/ }).click();
    await expect(placedCountFromMeter(page)).toHaveText('0');
    const freeAfterUndo = await freeCandidates(page).count();
    expect(freeAfterUndo).toBe(freeBefore);
  });
});

test.describe('play: city pulse animation', () => {
  test('e. trip sprites animate; reduced motion hides them for static lines', async ({ page }) => {
    await toBuild(page);
    const trips = page.locator('.mapcard .trip');
    const count = await trips.count();
    test.info().annotations.push({ type: 'trip-count', description: String(count) });
    expect(count).toBeGreaterThan(0);

    const animationName = await trips.first().evaluate((el) => getComputedStyle(el as Element).animationName);
    expect(animationName).not.toBe('none');

    await page.emulateMedia({ reducedMotion: 'reduce' });
    // reduced motion is a CSS media query; give the browser a frame to re-evaluate styles
    await page.waitForTimeout(100);
    const tripDisplay = await page.locator('.mapcard .trip').first().evaluate((el) => getComputedStyle(el as Element).display);
    const lineDisplay = await page.locator('.mapcard .tripline').first().evaluate((el) => getComputedStyle(el as Element).display);
    expect(tripDisplay).toBe('none');
    expect(lineDisplay).not.toBe('none');
  });
});

test.describe('play: evaluation', () => {
  test('f. evaluation runs on predict, solver wasm/data requests, hero number on run', async ({ page }) => {
    await toBuild(page);

    const requests: { url: string; status: number | null }[] = [];
    page.on('response', (res) => {
      const url = res.url();
      if (url.includes('highs') || url.includes('/data/game/')) {
        requests.push({ url, status: res.status() });
      }
    });
    const workerErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error' && /worker|highs|wasm/i.test(msg.text())) {
        workerErrors.push(msg.text().slice(0, 300));
      }
    });

    // Place >=10 stations quickly via the assistant.
    await page.getByRole('button', { name: 'Place them for me' }).click();
    await expect(placedCountFromMeter(page)).not.toHaveText('0');

    await page.getByRole('button', { name: 'I am done placing' }).click();
    await expect(page.locator('.step-predict')).toBeVisible();

    const questions = page.locator('.playoption');
    // Answer all 5 polls: click the first option each time (advances automatically).
    for (let i = 0; i < 5; i += 1) {
      await expect(questions.first()).toBeVisible();
      await questions.first().click();
      await page.waitForTimeout(50);
    }

    const t0 = Date.now();
    await page.getByRole('button', { name: 'Run a day on my network' }).click();

    // The results screen of step 4: the hero appears as soon as a solve has
    // landed, exact or estimate. Before that the step only says that the city
    // is getting ready, and a failed solve shows the retry line instead.
    const hero = page.locator('.playhero b');
    const failure = page.locator('.playstatus.playwarn');
    const deadline = Date.now() + 30_000;
    let landed = false;
    while (Date.now() < deadline) {
      if ((await hero.count()) > 0 && (await hero.first().isVisible())) {
        landed = true;
        break;
      }
      if ((await failure.count()) > 0) break;
      await page.waitForTimeout(300);
    }
    const wallMs = Date.now() - t0;
    const heroText = landed ? ((await hero.first().textContent()) ?? '') : '';
    const estimated = (await page.locator('.playest').count()) > 0;

    test.info().annotations.push({ type: 'eval-wall-ms', description: String(wallMs) });
    test.info().annotations.push({ type: 'hero', description: `${heroText}${estimated ? ' (estimate)' : ''}` });
    test.info().annotations.push({ type: 'solver-requests', description: JSON.stringify(requests) });
    test.info().annotations.push({ type: 'worker-console-errors', description: JSON.stringify(workerErrors) });

    expect(landed, 'the run step showed a hero number').toBe(true);
    expect(heroText).toMatch(/\d/);

    // The three tiles of plan.md section 5, each carrying the visitor's own guess.
    await expect(page.locator('.playtile')).toHaveCount(3);
    await expect(page.locator('.playguess')).toHaveCount(3);
    // The trucks switch, the three marks of the served line and the losses strip.
    await expect(page.getByRole('button', { name: 'With service trucks' })).toBeVisible();
    await expect(page.locator('.playmark')).toHaveCount(3);
    await expect(page.locator('.playlosses')).toBeVisible();
    // No unfilled copy placeholder ever reaches the screen.
    expect(await page.locator('.playstep').innerText()).not.toMatch(/[{}]/);
  });
});

test.describe('play: persistence', () => {
  test('g. reload keeps step, placed stations and predictions', async ({ page }) => {
    await toBuild(page);
    await page.getByRole('button', { name: 'Place them for me' }).click();
    const placedText = await placedCountFromMeter(page).textContent();
    expect(placedText).not.toBe('0');

    await page.getByRole('button', { name: 'I am done placing' }).click();
    await expect(page.locator('.step-predict')).toBeVisible();
    await page.locator('.playoption').first().click();

    // Let the debounced localStorage save (SAVE_DEBOUNCE_MS = 250ms in
    // useGameSession.ts) flush before navigating away.
    await page.waitForTimeout(600);
    await page.reload();
    await expect(page.locator('.step-predict')).toBeVisible({ timeout: 10_000 });

    // The first poll should show as answered (its dot has class "done").
    await expect(page.locator('.playdot.done').first()).toBeVisible();

    // Going back to build should still show the same placed count.
    await page.goBack();
    await expect(page.locator('.step-build')).toBeVisible({ timeout: 10_000 });
    await expect(placedCountFromMeter(page)).toHaveText(placedText ?? '');
  });
});

test.describe('play: hash deep links and back', () => {
  test('h. #/step/build on a fresh session falls back; back returns to the previous step', async ({ page }) => {
    await page.goto(`${PLAY}#/step/build`);
    await expect(page.locator('.playapp')).toBeVisible();
    // build is not enterable without a budget: the hook should fall back to an allowed step (entry).
    await page.waitForTimeout(500);
    const hash = await page.evaluate(() => window.location.hash);
    test.info().annotations.push({ type: 'resolved-hash', description: hash });
    expect(hash).not.toBe('#/step/build');
    await expect(page.locator('.step-build')).toHaveCount(0);

    // Now walk forward normally and check browser back.
    await page.getByRole('button', { name: 'Take the job' }).click();
    await expect(page.locator('.step-budget')).toBeVisible();
    await page.locator('.scard', { hasText: 'Starter' }).getByRole('button', { name: 'Choose this budget' }).click();
    await page.getByRole('button', { name: 'Go and place the stations' }).click();
    await expect(page.locator('.step-build')).toBeVisible();

    await page.goBack();
    // Back from build should land on the previous step (budget).
    await expect(page.locator('.step-budget')).toBeVisible({ timeout: 5000 });
  });
});

test.describe('play: phone layout', () => {
  test('i. bottom sheet, tappable map, compact tracker, no horizontal scroll', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'phone', 'phone-only checks');
    await toBuild(page);

    await expect(page.locator('.playsheet')).toBeVisible();
    await expect(page.locator('.tracker.compact')).toBeVisible();
    await expect(page.locator('.trackpos')).toContainText('2 of 6');

    // Primary action visible within viewport.
    const primaryBtn = page.getByRole('button', { name: 'I am done placing' });
    await expect(primaryBtn).toBeVisible();
    const btnBox = await primaryBtn.boundingBox();
    const viewportSize = page.viewportSize();
    expect(btnBox).not.toBeNull();
    expect(viewportSize).not.toBeNull();
    expect(btnBox!.y).toBeGreaterThanOrEqual(0);
    expect(btnBox!.y + btnBox!.height).toBeLessThanOrEqual(viewportSize!.height + 1);

    // Tap a candidate via touchscreen.
    const before = await freeCandidates(page).count();
    const target = freeCandidates(page).first();
    const box = await target.boundingBox();
    expect(box).not.toBeNull();
    await page.touchscreen.tap(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await expect(placedCountFromMeter(page)).toHaveText('1');
    const after = await freeCandidates(page).count();
    expect(after).toBe(before - 1);

    const noHScroll = await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    );
    expect(noHScroll).toBe(true);
  });
});

test.describe('play: full demo still works', () => {
  test('j. base URL loads without console errors and links to play/', async ({ page }) => {
    const { pageErrors, consoleErrors } = collectPageErrors(page);
    const response = await page.goto('./');
    expect(response?.status()).toBeLessThan(400);
    await page.waitForTimeout(1000);
    test.info().annotations.push({ type: 'pageErrors', description: JSON.stringify(pageErrors) });
    test.info().annotations.push({ type: 'consoleErrors', description: JSON.stringify(consoleErrors) });
    expect(pageErrors, `page errors: ${pageErrors.join(' | ')}`).toEqual([]);
    expect(consoleErrors, `console errors: ${consoleErrors.join(' | ')}`).toEqual([]);

    const playLink = page.locator('a[href*="play"]').first();
    await expect(playLink).toHaveCount(1);
  });
});
