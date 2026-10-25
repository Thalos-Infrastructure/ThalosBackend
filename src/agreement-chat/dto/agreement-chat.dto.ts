import { ArrayMaxSize, IsArray, IsNotEmpty, IsOptional, IsString, IsUUID } from 'class-validator';
import { MAX_FILES_PER_MESSAGE } from '../../files/files.constants';

export class SendMessageDto {
  @IsUUID()
  @IsNotEmpty()
  agreement_id: string;

  @IsString()
  @IsNotEmpty()
  sender_wallet: string;

  /**
   * Allowed to be empty when the message carries attachments: a screenshot
   * sent on its own is a message. The service enforces that one of the two is
   * present.
   */
  @IsString()
  message: string;

  /** Ids returned by POST /v1/files, in the order they should be shown. */
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  @ArrayMaxSize(MAX_FILES_PER_MESSAGE)
  attachment_ids?: string[];
}
