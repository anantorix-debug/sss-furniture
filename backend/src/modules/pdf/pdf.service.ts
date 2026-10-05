import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const puppeteer = require('puppeteer');

// One shared headless browser, launched lazily and relaunched if it dies.
// Previously every PDF launched and tore down its own Chromium and waited
// for the network to go fully idle, so a single slow image stalled the
// request until the 30s navigation timeout.
@Injectable()
export class PdfService implements OnModuleDestroy {
  private readonly logger = new Logger(PdfService.name);
  private browserPromise: Promise<any> | null = null;

  constructor(private config: ConfigService) {}

  private getBrowser(): Promise<any> {
    if (this.browserPromise) return this.browserPromise;
    const launching: Promise<any> = puppeteer
      .launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
        executablePath: this.config.get<string>('PUPPETEER_EXECUTABLE_PATH') || undefined,
      })
      .then((browser: any) => {
        browser.on('disconnected', () => {
          this.browserPromise = null;
        });
        return browser;
      })
      .catch((err: unknown) => {
        this.browserPromise = null;
        throw err;
      });
    this.browserPromise = launching;
    return launching;
  }

  // pageNumbers is opt-in (default off) so every existing report keeps its
  // current output byte-for-byte - only reports that ask for it (long,
  // multi-page statements) get a "Page X of Y" footer.
  async renderHtmlToPdf(html: string, options?: { pageNumbers?: boolean }): Promise<Buffer> {
    const browser = await this.getBrowser();
    const page = await browser.newPage();
    page.setDefaultTimeout(20000);
    try {
      // domcontentloaded is enough for our inline HTML; any remote images
      // get a short bounded wait below instead of blocking on full idle.
      await page.setContent(html, { waitUntil: 'domcontentloaded' });
      await page.waitForNetworkIdle({ idleTime: 500, timeout: 8000 }).catch(() => undefined);
      const pdf = await page.pdf({
        format: 'A4',
        printBackground: true,
        margin: { top: '16mm', bottom: options?.pageNumbers ? '12mm' : '16mm', left: '14mm', right: '14mm' },
        ...(options?.pageNumbers
          ? {
              displayHeaderFooter: true,
              headerTemplate: '<span></span>',
              footerTemplate:
                '<div style="width:100%;font-size:9px;color:#9ca3af;text-align:center;font-family:&quot;Noto Sans&quot;,Arial,Helvetica,sans-serif;">Page <span class="pageNumber"></span> of <span class="totalPages"></span></div>',
            }
          : {}),
      });
      return Buffer.from(pdf);
    } catch (err) {
      this.logger.error(`Failed to render PDF: ${(err as Error).message}`);
      throw err;
    } finally {
      await page.close().catch(() => undefined);
    }
  }

  async onModuleDestroy() {
    if (!this.browserPromise) return;
    const browser = await this.browserPromise.catch(() => null);
    await browser?.close().catch(() => undefined);
    this.browserPromise = null;
  }
}
