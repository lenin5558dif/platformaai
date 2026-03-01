import crypto from "crypto";

const CIPHER_ALGO = "aes-256-gcm";
const IV_LENGTH = 12;

function deriveKeyFromString(value: string) {
  return crypto.createHash("sha256").update(value).digest();
}

function getEncryptionKey() {
  const fromEnv = process.env.ADMIN_SECRETS_ENCRYPTION_KEY?.trim();

  if (fromEnv) {
    const maybeBase64 = Buffer.from(fromEnv, "base64");
    if (maybeBase64.length === 32) {
      return maybeBase64;
    }

    if (fromEnv.length === 64) {
      try {
        const maybeHex = Buffer.from(fromEnv, "hex");
        if (maybeHex.length === 32) {
          return maybeHex;
        }
      } catch {
        // ignore and fallback to derivation
      }
    }

    return deriveKeyFromString(fromEnv);
  }

  const fallback = process.env.AUTH_SECRET?.trim();
  if (!fallback) {
    throw new Error("ADMIN_SECRETS_ENCRYPTION_KEY (or AUTH_SECRET) is not set");
  }

  return deriveKeyFromString(fallback);
}

export function encryptSecret(plainText: string) {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(CIPHER_ALGO, key, iv);

  const encrypted = Buffer.concat([
    cipher.update(plainText, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return [
    iv.toString("base64url"),
    authTag.toString("base64url"),
    encrypted.toString("base64url"),
  ].join(".");
}

export function decryptSecret(payload: string) {
  const [ivRaw, authTagRaw, encryptedRaw] = payload.split(".");
  if (!ivRaw || !authTagRaw || !encryptedRaw) {
    throw new Error("Invalid encrypted payload format");
  }

  const key = getEncryptionKey();
  const iv = Buffer.from(ivRaw, "base64url");
  const authTag = Buffer.from(authTagRaw, "base64url");
  const encrypted = Buffer.from(encryptedRaw, "base64url");

  const decipher = crypto.createDecipheriv(CIPHER_ALGO, key, iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([
    decipher.update(encrypted),
    decipher.final(),
  ]);

  return decrypted.toString("utf8");
}

export function secretFingerprint(value: string) {
  return crypto.createHash("sha256").update(value).digest("hex").slice(0, 12);
}

export function maskSecretByFingerprint(fingerprint: string | null | undefined) {
  if (!fingerprint) return "—";
  return `***${fingerprint.slice(-6)}`;
}
