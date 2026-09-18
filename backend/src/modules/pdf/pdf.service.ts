import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const puppeteer = require('puppeteer');

@Injectable()
export class PdfService {
  private readonly logger = new Logger(PdfService.name);

  constructor(private config: ConfigService) {}

  // pageNumbers is opt-in (default off) so every existing report keeps its
  // current output byte-for-byte - only reports that ask for it (long,
  // multi-page statements) get a "Page X of Y" footer.
  async renderHtmlToPdf(html: string, options?: { pageNumbers?: boolean }): Promise<Buffer> {
    const browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
      executablePath: this.config.get<string>('PUPPETEER_EXECUTABLE_PATH') || undefined,
    });
    try {
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: 'networkidle0' });
      const pdf = await page.pdf({
        format: 'A4',
        printBackground: true,
        margin: { top: '16mm', bottom: options?.pageNumbers ? '12mm' : '16mm', left: '14mm', right: '14mm' },
        ...(options?.pageNumbers
          ? {
              displayHeaderFooter: true,
              headerTemplate: '<span></span>',
              footerTemplate:
                '<div style="width:100%;font-size:9px;color:#9ca3af;text-align:center;font-family:Arial,Helvetica,sans-serif;">Page <span class="pageNumber"></span> of <span class="totalPages"></span></div>',
            }
          : {}),
      });
      return Buffer.from(pdf);
    } catch (err) {
      this.logger.error(`Failed to render PDF: ${(err as Error).message}`);
      throw err;
    } finally {
      await browser.close().catch(() => undefined);
    }
  }
}
