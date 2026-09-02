import { Body, Controller, Delete, Get, HttpStatus, Param, ParseFilePipeBuilder, Patch, Post, Query, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ProductsService } from './products.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../../common/decorators/roles.decorator';
import { Role } from '../../../common/enums/role.enum';
import { CurrentUser, AuthUser } from '../../../common/decorators/current-user.decorator';

const MAX_IMAGE_BYTES = 1024 * 1024; // 1 MB

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('products')
export class ProductsController {
  constructor(private service: ProductsService) {}

  @Get()
  findAll(
    @Query('search') search?: string,
    @Query('category') category?: string,
    @Query('modelNo') modelNo?: string,
    @CurrentUser() user?: AuthUser,
  ) {
    return this.service.findAll({ search, category, modelNo, viewerRole: user?.role as Role });
  }

  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() user?: AuthUser) {
    return this.service.findOne(id, user?.role as Role);
  }

  @Roles(Role.ADMIN)
  @Post()
  create(@Body() dto: CreateProductDto) {
    return this.service.create(dto);
  }

  @Roles(Role.ADMIN)
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateProductDto, @CurrentUser() user: AuthUser) {
    return this.service.update(id, dto, user.userId);
  }

  @Roles(Role.ADMIN)
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }

  // FileInterceptor with no `storage` option defaults to memory storage
  // (file.buffer, nothing written to disk) so the size/type validators
  // below run *before* anything is persisted - an oversized or wrong-type
  // upload never touches disk.
  @Roles(Role.ADMIN)
  @Post(':id/images')
  @UseInterceptors(FileInterceptor('file'))
  uploadImage(
    @Param('id') id: string,
    @UploadedFile(
      new ParseFilePipeBuilder()
        .addFileTypeValidator({ fileType: /^(image\/jpeg|image\/png|image\/webp)$/ })
        .addMaxSizeValidator({ maxSize: MAX_IMAGE_BYTES, message: 'Image size must be 1 MB or less.' })
        .build({ errorHttpStatusCode: HttpStatus.BAD_REQUEST }),
    )
    file: Express.Multer.File,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.addImage(id, file, user.userId);
  }

  @Roles(Role.ADMIN)
  @Delete(':id/images/:imageId')
  removeImage(@Param('id') id: string, @Param('imageId') imageId: string, @CurrentUser() user: AuthUser) {
    return this.service.removeImage(id, imageId, user.userId);
  }

  @Roles(Role.ADMIN)
  @Patch(':id/images/:imageId/primary')
  setPrimaryImage(@Param('id') id: string, @Param('imageId') imageId: string) {
    return this.service.setPrimaryImage(id, imageId);
  }
}
