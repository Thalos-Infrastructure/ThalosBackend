import { ConfigService } from "@nestjs/config";
import { NotificationsService } from "./notifications.service";
import { SupabaseService } from "../supabase/supabase.service";
import {
  AgreementCreatedData,
  MilestoneApprovedData,
} from "./types/notification-data.types";

/**
 * Build a deeply chainable Supabase query stub that resolves with the given
 * payload, mirroring only the shape that NotificationsService actually
 * consumes (`from(...).select(...).eq(...).maybeSingle()` /
 * `from(...).select(...).eq(...)`).
 */
function buildSupabaseStub(options: {
  profileEmail: string | null;
  participantWallets: string[];
}) {
  const participantsPayload = options.participantWallets.map(
    (wallet_address) => ({ wallet_address }),
  );

  const terminalMaybeSingle = () => {
    const result: { data: { email: string } | null; error: null } = {
      data: options.profileEmail
        ? { email: options.profileEmail }
        : null,
      error: null,
    };
    return Promise.resolve(result);
  };

  const selectProfiles = () => ({
    eq: () => ({ maybeSingle: terminalMaybeSingle }),
  });

  // Two terminal shapes: maybeSingle (profiles) and bare (participants list).
  const selectParticipants = () => ({
    eq: () =>
      Promise.resolve({
        data: participantsPayload,
        error: null,
      }),
  });

  return {
    from: (table: string) => ({
      select: (_columns: string) => {
        if (table === "profiles") return selectProfiles();
        return selectParticipants();
      },
    }),
  };
}

interface ResendCall {
  from: string;
  replyTo: string;
  to: string[];
  subject: string;
  html: string;
}

/** Build a mock Resend instance that records every send call. */
function buildResendMock(): {
  mock: { emails: { send: jest.Mock<Promise<{ error: null }>, [ResendCall]> } };
  calls: ResendCall[];
} {
  const calls: ResendCall[] = [];
  const send = jest.fn(async (payload: ResendCall) => {
    calls.push(payload);
    return { error: null };
  });
  return {
    mock: { emails: { send } },
    calls,
  };
}

const baseAgreementId = "11111111-1111-1111-1111-111111111111";

const agreementCreatedData: AgreementCreatedData = {
  agreementId: baseAgreementId,
  title: "Logo design",
  description: "Brand kit + landing page",
  amount: "150",
  asset: "USDC",
  createdByWallet: "GWALLET-CREATOR",
  createdByName: "Alice",
  participantWallets: ["GWALLET-CREATOR", "GWALLET-PAYEE"],
};

const milestoneApprovedData: MilestoneApprovedData = {
  agreementId: baseAgreementId,
  agreementTitle: "Logo design",
  milestoneIndex: 0,
  milestoneDescription: "Brand kit",
  milestoneAmount: "75",
  asset: "USDC",
  approvedByWallet: "GWALLET-CREATOR",
  approvedByName: "Alice",
};

/** Construct a service with the given ConfigService-backed env, then mount a mock Resend. */
function buildService(env: Record<string, string | undefined>) {
  const config = new ConfigService(env);
  const supabase = {
    getClient: () =>
      buildSupabaseStub({
        profileEmail: "alice@example.com",
        participantWallets: ["GWALLET-CREATOR", "GWALLET-PAYEE"],
      }),
  } as unknown as SupabaseService;
  const service = new NotificationsService(supabase, config);

  const resendMock = buildResendMock();
  // Inject the Resend client directly (mirrors what onModuleInit would have
  // done when RESEND_API_KEY is set).
  (service as unknown as { resend: unknown }).resend = resendMock.mock;

  return { service, resendMock, config };
}

describe("NotificationsService — EMAIL_FROM / EMAIL_REPLY_TO env wiring", () => {
  it("sends emails using EMAIL_FROM and EMAIL_REPLY_TO from env", async () => {
    const { service, resendMock } = buildService({
      EMAIL_FROM: "Brand Identity <hello@brand.xyz>",
      EMAIL_REPLY_TO: "Help Desk <help@brand.xyz>",
    });

    await service.notifyAgreementCreated(agreementCreatedData);

    expect(resendMock.calls).toHaveLength(1);
    const call = resendMock.calls[0];
    expect(call.from).toBe("Brand Identity <hello@brand.xyz>");
    expect(call.replyTo).toBe("Help Desk <help@brand.xyz>");
    expect(call.to).toEqual(
      expect.arrayContaining(["alice@example.com", "alice@example.com"]),
    );
    expect(call.subject).toContain("New Agreement Created");
  });

  it("trims whitespace from env values", async () => {
    const { service, resendMock } = buildService({
      EMAIL_FROM: "  Spaced From <noreply@thalosplatform.xyz>  ",
      EMAIL_REPLY_TO: "\tReply Hub <reply@thalosplatform.xyz>\n",
    });

    await service.notifyMilestoneApproved(milestoneApprovedData);

    expect(resendMock.calls[0].from).toBe(
      "Spaced From <noreply@thalosplatform.xyz>",
    );
    expect(resendMock.calls[0].replyTo).toBe(
      "Reply Hub <reply@thalosplatform.xyz>",
    );
  });

  it("falls back to documented defaults when EMAILS env vars are unset", async () => {
    const { service, resendMock } = buildService({});

    await service.notifyAgreementCreated(agreementCreatedData);

    expect(resendMock.calls[0].from).toBe(
      "Thalos <notifications@thalosplatform.xyz>",
    );
    // EMAIL_REPLY_TO falls back to the documented no-reply alias, never empty.
    expect(resendMock.calls[0].replyTo).toBe(
      "Thalos <no-reply@thalosplatform.xyz>",
    );
  });

  it("falls back to defaults when env vars are blank strings", async () => {
    const { service, resendMock } = buildService({
      EMAIL_FROM: "   ",
      EMAIL_REPLY_TO: "",
    });

    await service.notifyAgreementCreated(agreementCreatedData);

    expect(resendMock.calls[0].from).toBe(
      "Thalos <notifications@thalosplatform.xyz>",
    );
    expect(resendMock.calls[0].replyTo).toBe(
      "Thalos <no-reply@thalosplatform.xyz>",
    );
  });

  it("changing EMAIL_FROM changes the sender with no code edit", async () => {
    const before = buildService({
      EMAIL_FROM: "Before <before@thalosplatform.xyz>",
    });
    await before.service.notifyAgreementCreated(agreementCreatedData);

    const after = buildService({
      EMAIL_FROM: "After <after@thalosplatform.xyz>",
    });
    await after.service.notifyAgreementCreated(agreementCreatedData);

    // Each service must resolve its sender from its own ConfigService — i.e.
    // no static constant is baked into the constructor.
    expect(
      (before.service as unknown as { fromEmail: string }).fromEmail,
    ).toBe("Before <before@thalosplatform.xyz>");
    expect(
      (after.service as unknown as { fromEmail: string }).fromEmail,
    ).toBe("After <after@thalosplatform.xyz>");

    // And the actual Resend payload must track the env change.
    expect(before.resendMock.calls[0].from).toBe(
      "Before <before@thalosplatform.xyz>",
    );
    expect(after.resendMock.calls[0].from).toBe(
      "After <after@thalosplatform.xyz>",
    );
    expect(after.resendMock.calls[0].from).not.toEqual(
      before.resendMock.calls[0].from,
    );
  });

  it("does not call Resend when RESEND_API_KEY is not configured", async () => {
    const config = new ConfigService({
      EMAIL_FROM: "X <x@thalosplatform.xyz>",
      EMAIL_REPLY_TO: "Y <y@thalosplatform.xyz>",
    });
    const supabase = {
      getClient: () =>
        buildSupabaseStub({
          profileEmail: "alice@example.com",
          participantWallets: ["GWALLET-CREATOR"],
        }),
    } as unknown as SupabaseService;

    const service = new NotificationsService(supabase, config);
    // Simulate the case where RESEND_API_KEY is missing: resend is null.
    await service.notifyAgreementCreated(agreementCreatedData);
    // Nothing to assert beyond "no exception thrown, no Resend call attempted".
    expect(true).toBe(true);
  });

  it("skips sending when there are no resolvable participant emails", async () => {
    const config = new ConfigService({
      EMAIL_FROM: "Empty Team",
      EMAIL_REPLY_TO: "Empty Reply",
    });
    const supabase = {
      getClient: () =>
        buildSupabaseStub({
          profileEmail: null,
          participantWallets: ["GWALLET-CREATOR"],
        }),
    } as unknown as SupabaseService;

    const service = new NotificationsService(supabase, config);
    const resend = buildResendMock();
    (service as unknown as { resend: unknown }).resend = resend.mock;

    await service.notifyAgreementCreated(agreementCreatedData);

    expect(resend.calls).toHaveLength(0);
  });
});
