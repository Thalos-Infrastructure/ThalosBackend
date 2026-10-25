import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  PayloadTooLargeException,
  ServiceUnavailableException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { SupabaseService } from '../supabase/supabase.service';
import { userCanAccessAgreement } from '../common/wallets/resolve-user-wallets';
import {
  MAX_FILE_BYTES,
  SIGNED_URL_TTL_SECONDS,
  STORAGE_BUCKET,
  isAllowedContentType,
  storagePathFor,
} from './files.constants';

/**
 * The shape of a multipart upload, narrowed to what this service reads.
 *
 * Declared here rather than pulling in `@types/multer` for four fields: the
 * package is types-only and this is the single place that touches them.
 */
export interface UploadedFileLike {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

export interface StoredFile {
  id: string;
  /** Object name inside the bucket. Never leaves the backend. */
  storage_path: string;
  file_name: string;
  content_type: string;
  size_bytes: number;
  agreement_id: string | null;
  uploaded_by_wallet: string;
  created_at: string;
  sha256_hex: string | null;
}

/** What a client needs to render an attachment, with no path or bucket leaked. */
export interface PublicFile {
  id: string;
  name: string;
  contentType: string;
  sizeBytes: number;
  sha256: string | null;
}

export function toPublicFile(file: StoredFile): PublicFile {
  return {
    id: file.id,
    name: file.file_name,
    contentType: file.content_type,
    sizeBytes: file.size_bytes,
    sha256: file.sha256_hex,
  };
}

/**
 * Uploads and reads back the files Thalos stores.
 *
 * Objects live in a **private** Supabase Storage bucket. Nothing is ever
 * served from a public URL: a caller asks for a file, this service checks they
 * belong to the agreement it is scoped to, and only then mints a short-lived
 * signed URL. An attachment is evidence inside someone's agreement, so a
 * guessable permanent link would be the whole access control.
 */
@Injectable()
export class FilesService {
  private readonly logger = new Logger(FilesService.name);

  constructor(private readonly supabase: SupabaseService) {}

  /** Refuse what the bucket should never hold, before spending an upload on it. */
  private assertAcceptable(file: UploadedFileLike): void {
    if (!file?.buffer?.length) {
      throw new BadRequestException('The uploaded file is empty');
    }
    if (file.size > MAX_FILE_BYTES) {
      throw new PayloadTooLargeException(
        `Files must be ${Math.round(MAX_FILE_BYTES / (1024 * 1024))} MB or smaller`,
      );
    }
    if (!isAllowedContentType(file.mimetype)) {
      throw new UnsupportedMediaTypeException(`Files of type ${file.mimetype} are not accepted`);
    }
  }

  async upload(
    userId: string,
    uploaderWallet: string,
    agreementId: string | null,
    file: UploadedFileLike,
  ): Promise<StoredFile> {
    this.assertAcceptable(file);

    if (agreementId) {
      await this.assertAgreementAccess(userId, agreementId);
    }

    const client = this.supabase.getClient();
    const id = randomUUID();
    const path = storagePathFor(agreementId, id);
    const sha256_hex = createHash('sha256').update(file.buffer).digest('hex');

    const { error: uploadError } = await client.storage
      .from(STORAGE_BUCKET)
      .upload(path, file.buffer, { contentType: file.mimetype, upsert: false });

    if (uploadError) {
      // A missing bucket is a deployment problem, not a bad request: say so
      // plainly instead of blaming the upload.
      this.logger.error(`Upload to ${STORAGE_BUCKET}/${path} failed: ${uploadError.message}`);
      throw new ServiceUnavailableException(
        `Could not store the file. If this persists, check that the "${STORAGE_BUCKET}" storage bucket exists.`,
      );
    }

    // Typed through the result object rather than destructured: the Supabase
    // client has no schema, so a destructured `data` is `any`.
    const insert = await client
      .from('files')
      .insert({
        id,
        storage_path: path,
        file_name: file.originalname,
        content_type: file.mimetype,
        size_bytes: file.size,
        agreement_id: agreementId,
        uploaded_by_user: userId,
        uploaded_by_wallet: uploaderWallet,
        sha256_hex,
      })
      .select()
      .single();

    const error = insert.error;
    const data = insert.data as StoredFile | null;

    if (error || !data) {
      // The object is already in the bucket; without its row nothing can ever
      // reach it, so take it back out rather than leave it orphaned.
      await client.storage
        .from(STORAGE_BUCKET)
        .remove([path])
        .catch(() => undefined);
      throw new BadRequestException(`Could not record the file: ${error?.message ?? 'unknown'}`);
    }

    return data;
  }

  /** Files by id, in one query, with every one checked against the caller. */
  async readableFiles(userId: string, fileIds: string[]): Promise<StoredFile[]> {
    const unique = [...new Set(fileIds.filter(Boolean))];
    if (unique.length === 0) return [];

    const { data, error } = await this.supabase
      .getClient()
      .from('files')
      .select('*')
      .in('id', unique);

    if (error) throw new BadRequestException(`Could not read the files: ${error.message}`);

    const files = (data ?? []) as StoredFile[];
    const missing = unique.filter((id) => !files.some((f) => f.id === id));
    if (missing.length > 0) {
      throw new NotFoundException(`No such file: ${missing.join(', ')}`);
    }

    for (const file of files) {
      if (file.agreement_id) await this.assertAgreementAccess(userId, file.agreement_id);
    }
    return files;
  }

  /**
   * A link the browser can follow, valid for a few minutes.
   *
   * Short-lived on purpose: a signed URL carries its own authorisation, so a
   * long-lived one forwarded in an email would outlive the access check that
   * produced it.
   */
  async signedUrl(userId: string, fileId: string): Promise<{ url: string; name: string }> {
    const [file] = await this.readableFiles(userId, [fileId]);

    const { data, error } = await this.supabase
      .getClient()
      .storage.from(STORAGE_BUCKET)
      .createSignedUrl(file.storage_path, SIGNED_URL_TTL_SECONDS, {
        download: file.file_name,
      });

    if (error || !data?.signedUrl) {
      throw new ServiceUnavailableException(
        `Could not create a download link: ${error?.message ?? 'unknown'}`,
      );
    }

    return { url: data.signedUrl, name: file.file_name };
  }

  private async assertAgreementAccess(userId: string, agreementId: string): Promise<void> {
    const client = this.supabase.getClient();

    const { data: agreement, error } = await client
      .from('agreements')
      .select('id, created_by')
      .eq('id', agreementId)
      .maybeSingle();
    if (error || !agreement) throw new NotFoundException('Agreement not found');

    const createdBy = (agreement as { created_by: string }).created_by;
    const allowed = await userCanAccessAgreement(client, userId, agreementId, createdBy);
    if (!allowed) throw new ForbiddenException('Not a participant of this agreement');
  }
}
