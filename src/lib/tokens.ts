import crypto from "crypto";

export function generateToken(length = 24) {
  return crypto.randomBytes(length).toString("hex");
}
