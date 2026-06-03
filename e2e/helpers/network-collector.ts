import type { Page, Request, Response } from '@playwright/test';

export type NetworkEntry = {
  phase?: string;
  url: string;
  method: string;
  status?: number;
  requestBody?: unknown;
  responseBody?: unknown;
  failure?: string;
};

export class NetworkCollector {
  readonly entries: NetworkEntry[] = [];

  attach(page: Page) {
    page.on('requestfailed', (req: Request) => {
      if (!req.url().includes('/api/')) return;
      this.entries.push({
        phase: 'request_failed',
        url: req.url(),
        method: req.method(),
        failure: req.failure()?.errorText,
      });
    });

    page.on('response', async (res: Response) => {
      const url = res.url();
      if (!url.includes('/api/')) return;
      const req = res.request();
      let responseBody: unknown = null;
      try {
        const ct = res.headers()['content-type'] || '';
        if (ct.includes('json')) responseBody = await res.json();
        else responseBody = { raw: (await res.text()).slice(0, 400) };
      } catch {
        responseBody = null;
      }
      let requestBody: unknown = null;
      try {
        const raw = req.postDataJSON?.();
        if (raw && typeof raw === 'object') {
          requestBody = {
            ...raw,
            password: (raw as { password?: string }).password ? '***' : undefined,
          };
        }
      } catch {
        requestBody = null;
      }
      this.entries.push({
        url,
        method: req.method(),
        status: res.status(),
        requestBody,
        responseBody,
      });
    });
  }

  record(entry: NetworkEntry) {
    this.entries.push(entry);
  }
}
