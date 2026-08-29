import {
  GetSecretValueCommand,
  SecretsManagerClient,
} from "@aws-sdk/client-secrets-manager";

let cached: string | null = null;

/**
 * Resolves the HMAC signing key for greader credentials: from Secrets Manager
 * (prod, via SECRET_ARN) or GREADER_HMAC_KEY (local/tests). Cached per
 * execution environment.
 */
export async function getHmacKey(): Promise<string> {
  if (cached) return cached;
  const arn = process.env.HMAC_SECRET_ARN;
  if (arn) {
    const client = new SecretsManagerClient({});
    const result = await client.send(
      new GetSecretValueCommand({ SecretId: arn }),
    );
    cached = result.SecretString ?? "";
  } else if (process.env.GREADER_HMAC_KEY) {
    cached = process.env.GREADER_HMAC_KEY;
  }
  if (!cached) throw new Error("greader auth not configured (no HMAC key)");
  return cached;
}
