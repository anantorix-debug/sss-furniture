import { Controller, Delete, Get, HttpStatus, Param, ParseFilePipeBuilder, Patch, Post, Query, UploadedFile, UseGuards, UseInterceptors, Body } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { GalleryService } from './gallery.service';
import { UpdateGalleryImageDto } from './dto/update-gallery-image.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';

const MAX_IMAGE_BYTES = 1024 * 1024; // 1 MB - matches ProductsService's image cap

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('gallery')
export class GalleryController {
  constructor(private service: GalleryService) {}

  // Read/select is open to any authenticated role that can already reach
  // Customer Orders (ADMIN+) - upload/delete stay Super Admin only, per
  // spec. WhatsApp sending itself is separately gated (SUPERADMIN) by the
  // existing useWhatsApp() hook on the frontend, unchanged here.
  @Get()
  findAll(@Query('modelNo') modelNo?: string, @Query('page') page?: string, @Query('limit') limit?: string) {
    return this.service.findAll({
      modelNo,
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  // FileInterceptor with no `storage` option defaults to memory storage
  // (file.buffer, nothing written to disk) so the size/type validators
  // below run *before* anything is persisted - same pattern as
  // ProductsController.uploadImage.
  @Roles(Role.SUPERADMIN)
  @Post()
  @UseInterceptors(FileInterceptor('file'))
  upload(
    @UploadedFile(
      new ParseFilePipeBuilder()
        .addFileTypeValidator({ fileType: /^(image\/jpeg|image\/png|image\/webp)$/ })
        .addMaxSizeValidator({ maxSize: MAX_IMAGE_BYTES, message: 'Image size must be 1 MB or less.' })
        .build({ errorHttpStatusCode: HttpStatus.BAD_REQUEST }),
    )
    file: Express.Multer.File,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.upload(file, user.userId);
  }

  @Roles(Role.SUPERADMIN)
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateGalleryImageDto) {
    return this.service.update(id, dto);
  }

  // force=true bypasses the "in use on N orders" block - see
  // GalleryService.remove. This route is already SUPERADMIN-only, so
  // viewerRole here is always SUPERADMIN.
  @Roles(Role.SUPERADMIN)
  @Delete(':id')
  remove(@Param('id') id: string, @Query('force') force: string | undefined, @CurrentUser() user: AuthUser) {
    return this.service.remove(id, user.userId, force === 'true', user.role as Role);
  }
}
