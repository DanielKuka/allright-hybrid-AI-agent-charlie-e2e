import type { Page } from '@playwright/test';

import { sanitizeForArtifact } from './artifacts';

const JSON_API_MEDIA_TYPE = 'application/vnd.api+json';
const TEST_ACCOUNT_DELETION_REASON_ID = 1;

interface CleanupResponse {
  status: number;
  ok: boolean;
  body: unknown;
}

export interface UserCleanupResult {
  userId: string;
  status: number;
}

export class AllRightApiClient {
  constructor(private readonly page: Page) {}

  async markUserDeleted(
    userId: string,
    accessToken: string
  ): Promise<UserCleanupResult> {
    const encodedUserId = encodeURIComponent(userId);
    const path = `/api/v1/users/${encodedUserId}/?fields[user]=is_deleted,deletion_reason`;
    const request = {
      path,
      method: 'PATCH' as const,
      headers: {
        Accept: JSON_API_MEDIA_TYPE,
        'Content-Type': JSON_API_MEDIA_TYPE,
        Authorization: `Bearer ${accessToken}`
      },
      body: {
        data: {
          type: 'users',
          id: userId,
          attributes: {
            'is-deleted': true,
            'deletion-reason': TEST_ACCOUNT_DELETION_REASON_ID
          }
        }
      }
    };

    const result = await this.page.evaluate<CleanupResponse, typeof request>(
      async (cleanupRequest) => {
        const response = await fetch(cleanupRequest.path, {
          method: cleanupRequest.method,
          credentials: 'include',
          headers: cleanupRequest.headers,
          body: JSON.stringify(cleanupRequest.body)
        });
        let body: unknown = null;
        if (!response.ok) {
          try {
            body = (await response.json()) as unknown;
          } catch {
            body = await response.text().catch(() => null);
          }
        }
        return { status: response.status, ok: response.ok, body };
      },
      request
    );

    if (!result.ok) {
      const safeBody = JSON.stringify(sanitizeForArtifact(result.body));
      throw new Error(
        `PATCH ${path} returned HTTP ${result.status}${
          safeBody && safeBody !== 'null' ? `: ${safeBody}` : ''
        }`
      );
    }
    return { userId, status: result.status };
  }
}
