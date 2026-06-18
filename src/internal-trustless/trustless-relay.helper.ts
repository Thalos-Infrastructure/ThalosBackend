import { BadRequestException } from "@nestjs/common";

const ALLOWED_PREFIXES = ["deployer/", "escrow/", "helper/"];

function getBaseUrl(): string {
  const u = process.env.TRUSTLESSWORK_API_URL;
  if (!u) throw new BadRequestException("TRUSTLESSWORK_API_URL not set");
  return u.replace(/\/$/, "");
}

function assertAllowedPath(path: string): void {
  const normalized = path.replace(/^\/+/, "");
  if (!ALLOWED_PREFIXES.some((p) => normalized.startsWith(p))) {
    throw new BadRequestException("Path not allowed for Trustless relay");
  }
}

export async function relayToTrustless(
  method: "GET" | "POST",
  path: string,
  query?: Record<string, string | number | boolean>,
  body?: unknown,
): Promise<{ status: number; data: unknown }> {
  assertAllowedPath(path);
  const base = getBaseUrl();
  const url = new URL(`${base}/${path.replace(/^\/+/, "")}`);
  if (method === "GET" && query) {
    Object.entries(query).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== "") {
        url.searchParams.set(k, String(v));
      }
    });
  }

  const res = await fetch(url.toString(), {
    method,
    headers: { "Content-Type": "application/json" },
    body: method === "POST" ? JSON.stringify(body ?? {}) : undefined,
  });

  const text = await res.text();
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { status: res.status, data };
}
