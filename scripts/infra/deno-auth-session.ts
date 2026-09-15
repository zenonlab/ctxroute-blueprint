import { z } from "npm:zod@4.5.4";

const authorizationStartSchema = z.object({
  code: z.string().min(1),
  exchangeToken: z.string().min(1),
});
const authorizationExchangeSchema = z.object({
  token: z.string().min(1),
  user: z.object({ name: z.string().min(1) }),
});
const authorizationErrorSchema = z.object({
  code: z.string().optional(),
  message: z.string().optional(),
});

const endpoint = "https://console.deno.com";
const verifier = crypto.randomUUID();
const verifierBytes = new TextEncoder().encode(verifier);
const digest = new Uint8Array(
  await crypto.subtle.digest("SHA-256", verifierBytes),
);

let binaryDigest = "";
for (const byte of digest) {
  binaryDigest += String.fromCharCode(byte);
}

const startResponse = await fetch("https://console.deno.com/auth/interactive", {
  method: "POST",
  body: JSON.stringify({ challenge: btoa(binaryDigest) }),
});

if (!startResponse.ok) {
  throw new Error(`Deno authorization start failed: ${startResponse.status}`);
}

const startBody: unknown = await startResponse.json();
const { code, exchangeToken } = authorizationStartSchema.parse(startBody);

console.error(
  "Visit " + endpoint + "/auth?code=" + code + " to authorize Deno Deploy.",
);

const deadline = Date.now() + 10 * 60_000;
while (Date.now() < deadline) {
  const exchangeResponse = await fetch("https://console.deno.com/auth/exchange", {
    method: "POST",
    body: JSON.stringify({ exchangeToken, verifier }),
  });

  if (exchangeResponse.ok) {
    const exchangeBody = authorizationExchangeSchema.parse(
      await exchangeResponse.json(),
    );
    console.error("Authorization successful as " + exchangeBody.user.name + ".");

    const command = new Deno.Command("/bin/zsh", {
      args: ["-f"],
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
      env: {
        ...Deno.env.toObject(),
        DENO_DEPLOY_TOKEN: exchangeBody.token,
        TOBIRINK_DENO_AUTH: "memory-only",
      },
    });
    const status = await command.spawn().status;
    Deno.exit(status.code);
  }

  const body = authorizationErrorSchema.parse(
    await exchangeResponse.json().catch(() => ({})),
  );
  const errorCode = body.code;
  const errorMessage = body.message;
  if (errorCode !== "AUTHORIZATION_PENDING") {
    throw new Error(
      errorMessage ??
        `Deno authorization exchange failed: ${exchangeResponse.status}`,
    );
  }

  await new Promise((resolve) => setTimeout(resolve, 2_000));
}

throw new Error("Deno authorization timed out.");
