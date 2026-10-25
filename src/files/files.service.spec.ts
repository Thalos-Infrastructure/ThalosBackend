import {
  ForbiddenException,
  NotFoundException,
  PayloadTooLargeException,
  ServiceUnavailableException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { FilesService, type UploadedFileLike } from './files.service';
import { SupabaseService } from '../supabase/supabase.service';
import { MAX_FILE_BYTES, STORAGE_BUCKET } from './files.constants';

const AGREEMENT = '11111111-1111-1111-1111-111111111111';
const USER = '22222222-2222-2222-2222-222222222222';
const WALLET = 'GWALLET00000000000000000000000000000000000000000000000000';

function png(overrides: Partial<UploadedFileLike> = {}): UploadedFileLike {
  return {
    originalname: 'screenshot.png',
    mimetype: 'image/png',
    size: 1024,
    buffer: Buffer.from('not really a png'),
    ...overrides,
  };
}

/**
 * A Supabase double covering only what FilesService touches: the agreement
 * lookup and participant check, the `files` table, and the storage bucket.
 */
function buildSupabase(options: { isParticipant?: boolean; uploadError?: string } = {}) {
  const { isParticipant = true, uploadError } = options;

  const uploaded: Array<{ path: string; contentType?: string }> = [];
  const removed: string[][] = [];
  const inserted: Array<Record<string, unknown>> = [];
  let filesInTable: Array<Record<string, unknown>> = [];

  const storage = {
    from: () => ({
      upload: (path: string, _body: Buffer, opts?: { contentType?: string }) => {
        if (uploadError) return Promise.resolve({ error: { message: uploadError } });
        uploaded.push({ path, contentType: opts?.contentType });
        return Promise.resolve({ error: null });
      },
      remove: (paths: string[]) => {
        removed.push(paths);
        return Promise.resolve({ error: null });
      },
      createSignedUrl: (path: string) =>
        Promise.resolve({ data: { signedUrl: `https://signed.example/${path}` }, error: null }),
    }),
  };

  const client = {
    storage,
    from: (table: string) => {
      if (table === 'agreements') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({ data: { id: AGREEMENT, created_by: 'GCREATOR' }, error: null }),
            }),
          }),
        };
      }
      if (table === 'files') {
        return {
          insert: (row: Record<string, unknown>) => {
            inserted.push(row);
            return {
              select: () => ({ single: () => Promise.resolve({ data: row, error: null }) }),
            };
          },
          select: () => ({
            in: (_col: string, ids: string[]) =>
              Promise.resolve({
                data: filesInTable.filter((f) => ids.includes(f.id as string)),
                error: null,
              }),
          }),
        };
      }
      // The three tables userCanAccessAgreement walks, in the exact shapes it
      // chains: user_wallets (.eq.order), auth_users (.eq.maybeSingle) and
      // agreement_participants (.eq.in.limit).
      if (table === 'user_wallets') {
        return {
          select: () => ({
            eq: () => ({
              order: () =>
                Promise.resolve({
                  data: [{ wallet_address: WALLET, is_primary: true }],
                  error: null,
                }),
            }),
          }),
        };
      }
      if (table === 'auth_users') {
        return {
          select: () => ({
            eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }),
          }),
        };
      }
      return {
        select: () => ({
          eq: () => ({
            in: () => ({
              limit: () =>
                Promise.resolve({
                  data: isParticipant ? [{ wallet_address: WALLET }] : [],
                  error: null,
                }),
            }),
          }),
        }),
      };
    },
  };

  return {
    service: new FilesService({ getClient: () => client } as unknown as SupabaseService),
    uploaded,
    removed,
    inserted,
    seedFiles: (rows: Array<Record<string, unknown>>) => {
      filesInTable = rows;
    },
  };
}

describe('FilesService — what it refuses to store', () => {
  it('refuses a file over the size cap', async () => {
    const { service } = buildSupabase();

    await expect(
      service.upload(USER, WALLET, AGREEMENT, png({ size: MAX_FILE_BYTES + 1 })),
    ).rejects.toThrow(PayloadTooLargeException);
  });

  it('refuses a type that is not on the allow-list', async () => {
    // Archives and executables are the ones that matter: an attachment arrives
    // inside the recipient's own agreement, so it reads as trustworthy.
    const { service } = buildSupabase();

    for (const mimetype of ['application/zip', 'application/x-msdownload', 'text/html']) {
      await expect(service.upload(USER, WALLET, AGREEMENT, png({ mimetype }))).rejects.toThrow(
        UnsupportedMediaTypeException,
      );
    }
  });

  it('refuses an empty file', async () => {
    const { service } = buildSupabase();

    await expect(
      service.upload(USER, WALLET, AGREEMENT, png({ buffer: Buffer.alloc(0) })),
    ).rejects.toThrow(/empty/);
  });

  it('refuses someone who is not in the agreement', async () => {
    const { service } = buildSupabase({ isParticipant: false });

    await expect(service.upload(USER, WALLET, AGREEMENT, png())).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('checks access before it spends an upload', async () => {
    const { service, uploaded } = buildSupabase({ isParticipant: false });

    await expect(service.upload(USER, WALLET, AGREEMENT, png())).rejects.toThrow();
    expect(uploaded).toHaveLength(0);
  });
});

describe('FilesService — storing a file', () => {
  it('names the object after its id, never after the uploaded filename', async () => {
    // The filename comes from a browser: it can hold '../', a null byte, or
    // 300 characters of unicode. It is kept for display only.
    const { service, uploaded, inserted } = buildSupabase();

    await service.upload(USER, WALLET, AGREEMENT, png({ originalname: '../../etc/passwd' }));

    expect(uploaded[0].path).toBe(`agreements/${AGREEMENT}/${inserted[0].id as string}`);
    expect(uploaded[0].path).not.toContain('..');
    expect(inserted[0].file_name).toBe('../../etc/passwd');
  });

  it('records who uploaded it and what it belongs to', async () => {
    const { service, inserted } = buildSupabase();

    await service.upload(USER, WALLET, AGREEMENT, png());

    expect(inserted[0]).toMatchObject({
      agreement_id: AGREEMENT,
      uploaded_by_user: USER,
      uploaded_by_wallet: WALLET,
      content_type: 'image/png',
      size_bytes: 1024,
    });
    expect(inserted[0].sha256_hex).toMatch(/^[a-f0-9]{64}$/);
  });

  it('says the bucket may be missing instead of blaming the upload', async () => {
    const { service } = buildSupabase({ uploadError: 'Bucket not found' });

    await expect(service.upload(USER, WALLET, AGREEMENT, png())).rejects.toThrow(
      new RegExp(STORAGE_BUCKET),
    );
    await expect(service.upload(USER, WALLET, AGREEMENT, png())).rejects.toThrow(
      ServiceUnavailableException,
    );
  });
});

describe('FilesService — reading files back', () => {
  const row = (id: string, agreementId: string | null = AGREEMENT) => ({
    id,
    storage_path: `agreements/${agreementId ?? 'unscoped'}/${id}`,
    file_name: 'screenshot.png',
    content_type: 'image/png',
    size_bytes: 1024,
    agreement_id: agreementId,
    uploaded_by_wallet: WALLET,
    created_at: '2026-10-24T00:00:00Z',
  });

  it('returns nothing for an empty request, without querying', async () => {
    const { service } = buildSupabase();

    await expect(service.readableFiles(USER, [])).resolves.toEqual([]);
  });

  it('refuses the whole batch when one id does not exist', async () => {
    // Partial success would let a caller attach a file that silently vanished.
    const { service, seedFiles } = buildSupabase();
    seedFiles([row('f1')]);

    await expect(service.readableFiles(USER, ['f1', 'missing'])).rejects.toThrow(NotFoundException);
  });

  it('refuses a file belonging to an agreement the caller is not in', async () => {
    const { service, seedFiles } = buildSupabase({ isParticipant: false });
    seedFiles([row('f1')]);

    await expect(service.readableFiles(USER, ['f1'])).rejects.toThrow(ForbiddenException);
  });

  it('mints a download link only after the access check', async () => {
    const { service, seedFiles } = buildSupabase();
    seedFiles([row('f1')]);

    const result = await service.signedUrl(USER, 'f1');

    expect(result.url).toContain(`agreements/${AGREEMENT}/f1`);
    expect(result.name).toBe('screenshot.png');
  });

  it('does not mint a link for someone outside the agreement', async () => {
    const { service, seedFiles } = buildSupabase({ isParticipant: false });
    seedFiles([row('f1')]);

    await expect(service.signedUrl(USER, 'f1')).rejects.toThrow(ForbiddenException);
  });
});
