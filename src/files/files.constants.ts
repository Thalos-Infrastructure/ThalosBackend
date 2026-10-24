/**
 * What Thalos accepts as an upload.
 *
 * The allow-list is deliberately short. Everything on it either renders in the
 * browser or opens in a viewer; archives and executables are left off because
 * an attachment people are told to trust — it arrives inside their own
 * agreement — is the wrong place to hand someone a `.zip` or an `.exe`.
 */

/** Per file. Chat attachments are evidence and screenshots, not deliverables. */
export const MAX_FILE_BYTES = 10 * 1024 * 1024;

/** Per message, so one send cannot queue an unbounded number of uploads. */
export const MAX_FILES_PER_MESSAGE = 5;

export const ALLOWED_CONTENT_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'application/pdf',
  'text/plain',
  'text/csv',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
] as const;

/** The private bucket holding every uploaded object. Created by hand — see the README. */
export const STORAGE_BUCKET = process.env.SUPABASE_STORAGE_BUCKET || 'attachments';

/** How long a download link stays valid. Long enough to click, short enough not to be a share link. */
export const SIGNED_URL_TTL_SECONDS = 5 * 60;

export function isAllowedContentType(contentType: string): boolean {
  return (ALLOWED_CONTENT_TYPES as readonly string[]).includes(contentType);
}

/**
 * A safe object name, built from the file's id rather than its name.
 *
 * The uploaded filename is attacker-controlled: it can contain '../', a null
 * byte, or 300 characters of unicode. It is kept in the database for display
 * and for the download filename, and never used to address storage.
 */
export function storagePathFor(agreementId: string | null, fileId: string): string {
  const scope = agreementId ? `agreements/${agreementId}` : 'unscoped';
  return `${scope}/${fileId}`;
}
