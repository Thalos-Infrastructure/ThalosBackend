import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Length,
  Min,
} from "class-validator";

/**
 * Updates a single milestone inside an agreement.
 *
 * Existing callers that only send `milestone_index`, `status` and `actor_wallet`
 * are unaffected - the new fields are all optional and are required only when
 * the caller wants to attach evidence (description and/or URL) to the milestone,
 * which in turn triggers the `evidence.submitted` event from
 * `AgreementsService.updateMilestone()`.
 */
export class UpdateMilestoneDto {
  @IsInt()
  @Min(0)
  milestone_index: number;

  @IsString()
  @IsIn(["pending", "approved", "released"])
  status: "pending" | "approved" | "released";

  @IsString()
  actor_wallet: string;

  /**
   * Free-form evidence description shown to the other participants and used
   * as the body of the `evidence.submitted` email notification.
   * Optional: existing callers that only want to change `status` keep working.
   */
  @IsOptional()
  @IsString()
  @Length(1, 2000)
  evidence_description?: string;

  /**
   * Optional URL pointing at uploaded evidence (IPFS link, file on S3, etc.).
   * Validated as a URL when supplied.
   */
  @IsOptional()
  @IsUrl({ require_protocol: true }, { message: "evidence_url must be a valid URL" })
  evidence_url?: string;

  /**
   * Display name of the submitter (looked up from `profiles.display_name` by
   * the caller, when available). Optional - falls back to a truncated wallet
   * address in the email template.
   */
  @IsOptional()
  @IsString()
  @Length(1, 120)
  submitter_name?: string;
}
