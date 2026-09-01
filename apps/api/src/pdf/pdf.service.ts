import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const puppeteer = require('puppeteer');

@Injectable()
export class PdfService {
  private readonly logger = new Logger(PdfService.name);

  constructor(private config: ConfigService) {}

  async renderHtmlToPdf(html: string): Promise<Buffer> {
    const browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
      executablePath: this.config.get<string>('PUPPETEER_EXECUTABLE_PATH') || undefined,
    });
    try {
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: 'networkidle0' });
      const pdf = await page.pdf({ format: 'A4', printBackground: true, margin: { top: '16mm', bottom: '16mm', left: '14mm', right: '14mm' } });
      return Buffer.from(pdf);
    } catch (err) {
      this.logger.error(`Failed to render PDF: ${(err as Error).message}`);
      throw err;
    } finally {
      await browser.close().catch(() => undefined);
    }
  }
}
