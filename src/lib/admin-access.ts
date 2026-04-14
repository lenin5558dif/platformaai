type SessionLike = {
  user?: {
    email?: string | null;
  } | null;
} | null;

type UserLike = {
  email?: string | null;
} | null;

function parseCsvList(value?: string) {
  if (!value) {
    return [];
  }

  return value
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

export function getGlobalAdminEmails(
  env: Record<string, string | undefined> = process.env
) {
  return parseCsvList(env.GLOBAL_ADMIN_EMAILS);
}

export function isGlobalAdminEmail(
  email?: string | null,
  env: Record<string, string | undefined> = process.env
) {
  const normalizedEmail = email?.trim().toLowerCase();
  if (!normalizedEmail) {
    return false;
  }

  return getGlobalAdminEmails(env).includes(normalizedEmail);
}

export function isGlobalAdminUser(
  user: UserLike,
  env: Record<string, string | undefined> = process.env
) {
  return isGlobalAdminEmail(user?.email, env);
}

export function isGlobalAdminSession(
  session: SessionLike,
  env: Record<string, string | undefined> = process.env
) {
  return isGlobalAdminEmail(session?.user?.email, env);
}
