import { expect, test } from '@playwright/test';

import {
  actionTargetsVisiblePopup,
  installPopupGuard,
  popupGuardCheckpoint
} from '../src/popup-guard';

async function renderPageWithPopup(
  page: import('@playwright/test').Page
): Promise<void> {
  await page.setContent(`
    <button id="quiz-action" onclick="this.dataset.clicked = 'yes'">Далі</button>
    <dialog open class="ui-modal popup-leaving-page">
      <button aria-label="Close" onclick="this.closest('dialog').close()">×</button>
      <button id="popup-cta" onclick="this.dataset.clicked = 'yes'">
        Завершити бронювання
      </button>
    </dialog>
  `);
}

test('dismisses the known popup before a regular action and never clicks its CTA', async ({
  page
}) => {
  await renderPageWithPopup(page);
  let dismissals = 0;
  await installPopupGuard(page, () => {
    dismissals += 1;
  });

  await page.locator('#quiz-action').click();

  await expect(page.locator('dialog')).not.toBeVisible();
  await expect(page.locator('#quiz-action')).toHaveAttribute('data-clicked', 'yes');
  await expect(page.locator('#popup-cta')).not.toHaveAttribute(
    'data-clicked',
    'yes'
  );
  expect(dismissals).toBe(1);
});

test('checkpoint removes a popup before an accessibility snapshot is taken', async ({
  page
}) => {
  await renderPageWithPopup(page);
  await installPopupGuard(page);

  await popupGuardCheckpoint(page);

  await expect(page.locator('dialog')).not.toBeVisible();
});

test('dismisses a popup that appears while Playwright is waiting to act', async ({
  page
}) => {
  await page.setContent(`
    <button id="quiz-action" disabled onclick="this.dataset.clicked = 'yes'">
      Далі
    </button>
    <dialog class="ui-modal popup-leaving-page">
      <button aria-label="Close" onclick="this.closest('dialog').close()">×</button>
      <button id="popup-cta" onclick="this.dataset.clicked = 'yes'">
        Завершити бронювання
      </button>
    </dialog>
    <script>
      setTimeout(() => document.querySelector('dialog').showModal(), 30);
      setTimeout(() => document.querySelector('#quiz-action').disabled = false, 120);
    </script>
  `);
  await installPopupGuard(page);

  await page.locator('#quiz-action').click({ timeout: 2_000 });

  await expect(page.locator('dialog')).not.toBeVisible();
  await expect(page.locator('#quiz-action')).toHaveAttribute('data-clicked', 'yes');
  await expect(page.locator('#popup-cta')).not.toHaveAttribute(
    'data-clicked',
    'yes'
  );
});

test('recognizes when the agent selected a control inside the visible popup', async ({
  page
}) => {
  await renderPageWithPopup(page);

  await expect(
    actionTargetsVisiblePopup(page, 'role=button[name="Close"]')
  ).resolves.toBe(true);
  await expect(
    actionTargetsVisiblePopup(page, 'role=button[name="Далі"]')
  ).resolves.toBe(false);
});
