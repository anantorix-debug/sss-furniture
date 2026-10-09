import { Body, Controller, HttpStatus, Param, ParseFilePipeBuilder, Post, Query, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiParam, ApiQuery, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { ImportsService } from './imports.service';
import { CheckImportDto, CommitImportDto } from './dto/commit-import.dto';

const MAX_IMPORT_BYTES = 10 * 1024 * 1024; // 10 MB

const KINDS = [
  'customer-orders',
  'party-orders',
  'products',
  'raw-materials',
  'suppliers',
  'purchases',
  'supplier-purchases',
  'supplier-payments',
  'production-work',
  'worker-work',
  'worker-payments',
  'payments',
  'expenses',
];

// Bulk upload / "Add Multiple" for every page. Admin at minimum; kinds whose
// page is Super Admin only (Payments, Expenses, old work entries) re-check
// that in ImportsService. Worker-page kinds take ?carpenterId=, supplier-page
// kinds take ?supplierId=.
@ApiTags('Bulk Import')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
@Controller('imports')
export class ImportsController {
  constructor(private service: ImportsService) {}

  private buildScope(carpenterId?: string, supplierId?: string): Record<string, string> {
    const scope: Record<string, string> = {};
    if (carpenterId) scope.carpenterId = carpenterId;
    if (supplierId) scope.supplierId = supplierId;
    return scope;
  }

  // Upload a PDF / .xlsx / .csv -> rows for review. Saves nothing.
  @Post(':kind/preview')
  @ApiParam({ name: 'kind', enum: KINDS })
  @ApiQuery({ name: 'carpenterId', required: false })
  @ApiQuery({ name: 'supplierId', required: false })
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } } })
  @UseInterceptors(FileInterceptor('file'))
  preview(
    @Param('kind') kind: string,
    @UploadedFile(new ParseFilePipeBuilder().addMaxSizeValidator({ maxSize: MAX_IMPORT_BYTES, message: 'File must be 10 MB or less.' }).build({ errorHttpStatusCode: HttpStatus.BAD_REQUEST }))
    file: Express.Multer.File,
    @CurrentUser() user: AuthUser,
    @Query('carpenterId') carpenterId?: string,
    @Query('supplierId') supplierId?: string,
  ) {
    return this.service.preview(kind, file, { userId: user.userId, role: user.role as Role }, this.buildScope(carpenterId, supplierId));
  }

  // Duplicate check for rows typed into the grid by hand. Saves nothing.
  @Post(':kind/check')
  @ApiParam({ name: 'kind', enum: KINDS })
  @ApiQuery({ name: 'carpenterId', required: false })
  @ApiQuery({ name: 'supplierId', required: false })
  check(
    @Param('kind') kind: string,
    @Body() dto: CheckImportDto,
    @CurrentUser() user: AuthUser,
    @Query('carpenterId') carpenterId?: string,
    @Query('supplierId') supplierId?: string,
  ) {
    return this.service.check(kind, dto.items, { userId: user.userId, role: user.role as Role }, this.buildScope(carpenterId, supplierId));
  }

  // Save reviewed rows. Duplicates are refused unless listed in
  // confirmDuplicates; each row reports its own result.
  @Post(':kind/commit')
  @ApiParam({ name: 'kind', enum: KINDS })
  @ApiQuery({ name: 'carpenterId', required: false })
  @ApiQuery({ name: 'supplierId', required: false })
  commit(
    @Param('kind') kind: string,
    @Body() dto: CommitImportDto,
    @CurrentUser() user: AuthUser,
    @Query('carpenterId') carpenterId?: string,
    @Query('supplierId') supplierId?: string,
  ) {
    return this.service.commit(kind, dto, { userId: user.userId, role: user.role as Role }, this.buildScope(carpenterId, supplierId));
  }
}
