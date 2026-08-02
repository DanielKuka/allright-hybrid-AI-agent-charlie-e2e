import type { Locator, Page } from '@playwright/test';

const POPUP_SELECTOR = 'dialog.popup-leaving-page';
const CLOSE_BUTTON_NAME = /^(?:Close|Закрити)$/i;
const GUARD_TIMEOUT = 3_000;

export async function installPopupGuard(
  page: Page,
  onDismiss?: () => void
): Promise<void> {
  const popup = page.locator(POPUP_SELECTOR);

  await page.addLocatorHandler(popup, async (visiblePopup) => {
    await dismissPopup(visiblePopup);
    onDismiss?.();
  });
}

/**
 * Triggers Playwright's actionability checks without changing page state.
 * This makes an already-visible popup disappear before the snapshot is sent
 * to the AI. A popup that appears later is still handled automatically before
 * or during the next real Playwright action.
 */
export async function popupGuardCheckpoint(page: Page): Promise<void> {
  await page.locator('body').click({
    trial: true,
    timeout: GUARD_TIMEOUT,
    position: { x: 0, y: 0 }
  });
}

export async function actionTargetsVisiblePopup(
  page: Page,
  selector: string
): Promise<boolean> {
  const popup = page.locator(POPUP_SELECTOR).filter({ visible: true }).last();
  if (!(await popup.isVisible())) return false;

  return popup.locator(selector).first().isVisible().catch(() => false);
}

async function dismissPopup(popup: Locator): Promise<void> {
  const closeButtons = popup.getByRole('button', { name: CLOSE_BUTTON_NAME });
  if ((await closeButtons.count()) !== 1) {
    throw new Error(
      'PopupGuard found popup-leaving-page without exactly one safe Close button'
    );
  }

  await closeButtons.click({ timeout: GUARD_TIMEOUT });
}
