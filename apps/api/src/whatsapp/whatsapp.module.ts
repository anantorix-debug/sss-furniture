import { Global, Module } from '@nestjs/common';
import { WhatsappService } from './whatsapp.service';
import { WhatsappController } from './whatsapp.controller';
import { WhatsappClientWrapper } from './whatsapp-client';
import { WhatsappQueue } from './whatsapp-queue';

@Global()
@Module({
  controllers: [WhatsappController],
  providers: [WhatsappService, WhatsappClientWrapper, WhatsappQueue],
  exports: [WhatsappService],
})
export class WhatsappModule {}
