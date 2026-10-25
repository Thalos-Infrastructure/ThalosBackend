import {
  BadRequestException,
  Controller,
  Get,
  Param,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  Body,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, type AuthUserCtx } from '../auth/current-user.decorator';
import { FilesService, toPublicFile, type UploadedFileLike } from './files.service';
import { MAX_FILE_BYTES } from './files.constants';
import { UploadFileDto } from './dto/upload-file.dto';

@ApiTags('files')
@ApiBearerAuth('bearer')
@Controller('files')
@UseGuards(JwtAuthGuard)
export class FilesController {
  constructor(private readonly files: FilesService) {}

  /**
   * POST /v1/files — store one file and return its id.
   *
   * Upload and use are separate steps: the client uploads, gets ids back, and
   * then sends them with the message. A single call that did both would mean
   * re-uploading every file whenever the send failed.
   *
   * `limits.fileSize` makes multer stop reading at the cap instead of buffering
   * a 2 GB body into memory first and rejecting it afterwards.
   */
  @Post()
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Subir un archivo (devuelve su id)' })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_FILE_BYTES } }))
  async upload(
    @CurrentUser() user: AuthUserCtx,
    @UploadedFile() file: UploadedFileLike,
    @Body() dto: UploadFileDto,
  ) {
    if (!file) throw new BadRequestException('No file was uploaded');

    const stored = await this.files.upload(
      user.userId,
      dto.uploader_wallet,
      dto.agreement_id ?? null,
      file,
    );
    return { file: toPublicFile(stored), error: null };
  }

  /**
   * GET /v1/files/:id/url — a short-lived download link.
   *
   * The bucket is private, so this is the only way to the bytes, and it
   * re-checks access on every request rather than handing out a lasting link.
   */
  @Get(':id/url')
  @ApiOperation({ summary: 'Link de descarga temporal para un archivo' })
  async downloadUrl(@CurrentUser() user: AuthUserCtx, @Param('id') id: string) {
    const { url, name } = await this.files.signedUrl(user.userId, id);
    return { url, name, error: null };
  }
}
