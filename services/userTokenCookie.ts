const USER_TOKEN_COOKIE = 'reze_user_token';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 30;

export const getAttachedUserToken = (): string | null => {
  if (typeof document === 'undefined') return null;

  const parts = document.cookie.split(';');
  for (const part of parts) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    if (key !== USER_TOKEN_COOKIE) continue;
    return decodeURIComponent(part.slice(idx + 1).trim());
  }

  return null;
};

export const setAttachedUserToken = (token: string) => {
  if (typeof document === 'undefined') return;
  document.cookie = `${USER_TOKEN_COOKIE}=${encodeURIComponent(token)}; path=/; max-age=${COOKIE_MAX_AGE}; SameSite=Lax`;
};

export const clearAttachedUserToken = () => {
  if (typeof document === 'undefined') return;
  document.cookie = `${USER_TOKEN_COOKIE}=; path=/; max-age=0; SameSite=Lax`;
};
