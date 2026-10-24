import { IsOptional, IsString, IsUUID } from 'class-validator';

export class UploadFileDto {
  /**
   * What the file belongs to. Optional so the endpoint stays usable by the
   * next feature that needs an upload, but when present it is also what
   * decides who may read the file back.
   */
  @IsOptional()
  @IsUUID()
  agreement_id?: string;

  /** Wallet the uploader is acting as. Recorded for display next to the file. */
  @IsString()
  uploader_wallet: string;
}
