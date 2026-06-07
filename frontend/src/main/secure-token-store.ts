import Store from 'electron-store';
import { safeStorage } from 'electron';

interface AuthSessionStoreShape {
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number | null;
}

function encrypt(value: string): string {
  if (!safeStorage.isEncryptionAvailable()) {
    return value;
  }
  return safeStorage.encryptString(value).toString('base64');
}

function decrypt(value: string | undefined): string | undefined {
  if (!value) return undefined;
  if (!safeStorage.isEncryptionAvailable()) {
    return value;
  }
  return safeStorage.decryptString(Buffer.from(value, 'base64'));
}

export class SecureTokenStore {
  private readonly store = new Store<AuthSessionStoreShape>({
    name: 'auth-session',
  });

  getSession() {
    return {
      accessToken: decrypt(this.store.get('accessToken')),
      refreshToken: decrypt(this.store.get('refreshToken')),
      expiresAt: this.store.get('expiresAt') ?? null,
    };
  }

  setSession(input: { accessToken: string; refreshToken?: string; expiresAt?: number | null }) {
    this.store.set('accessToken', encrypt(input.accessToken));
    if (input.refreshToken) {
      this.store.set('refreshToken', encrypt(input.refreshToken));
    }
    this.store.set('expiresAt', input.expiresAt ?? null);
    return this.getSession();
  }

  clearSession() {
    this.store.delete('accessToken');
    this.store.delete('refreshToken');
    this.store.delete('expiresAt');
    return { ok: true };
  }
}
