import type { VaultConfig } from "./types";

const CHECK_PLAINTEXT = "VAULTSTREAM_E2EE_V2";

export function base64ToUint8Array(b64: string): Uint8Array {
  const binary = window.atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return window.btoa(binary);
}

export async function createVaultConfig(
  passphrase: string
): Promise<{ config: VaultConfig; masterKey: CryptoKey }> {
  const saltBytes = window.crypto.getRandomValues(new Uint8Array(16));
  const saltBase64 = uint8ArrayToBase64(saltBytes);
  const iterations = 100000;
  const masterKey = await deriveMasterKey(passphrase, saltBase64, iterations);
  const checkBytes = await encryptAesGcmText(CHECK_PLAINTEXT, masterKey);
  const config: VaultConfig = {
    version: 2,
    kdf: "PBKDF2-SHA256",
    iterations,
    salt: saltBase64,
    check: uint8ArrayToBase64(checkBytes),
  };
  return { config, masterKey };
}

export async function deriveMasterKey(
  passphrase: string,
  saltBase64: string,
  iterations = 100000
): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const keyMaterial = await window.crypto.subtle.importKey(
    "raw",
    enc.encode(passphrase),
    { name: "PBKDF2" },
    false,
    ["deriveKey"]
  );

  const saltBytes = base64ToUint8Array(saltBase64);
  const saltBuffer = saltBytes.buffer.slice(
    saltBytes.byteOffset,
    saltBytes.byteOffset + saltBytes.byteLength
  ) as ArrayBuffer;

  return window.crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: saltBuffer,
      iterations,
      hash: "SHA-256",
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

export async function encryptAesGcmBytes(
  plainBytes: Uint8Array,
  masterKey: CryptoKey
): Promise<Uint8Array> {
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const plainBuffer = plainBytes.buffer.slice(
    plainBytes.byteOffset,
    plainBytes.byteOffset + plainBytes.byteLength
  ) as ArrayBuffer;
  const cipherBuffer = await window.crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    masterKey,
    plainBuffer
  );
  const cipherBytes = new Uint8Array(cipherBuffer);
  const combined = new Uint8Array(12 + cipherBytes.byteLength);
  combined.set(iv, 0);
  combined.set(cipherBytes, 12);
  return combined;
}

export async function encryptAesGcmText(
  plainText: string,
  masterKey: CryptoKey
): Promise<Uint8Array> {
  return encryptAesGcmBytes(new TextEncoder().encode(plainText), masterKey);
}

export async function decryptAesGcmBytes(
  encryptedPayload: Uint8Array,
  masterKey: CryptoKey
): Promise<Uint8Array> {
  if (encryptedPayload.byteLength < 28) {
    throw new Error("暗号化データが破損しています");
  }
  const iv = encryptedPayload.slice(0, 12);
  const ciphertext = encryptedPayload.slice(12);

  const plainBuffer = await window.crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    masterKey,
    ciphertext
  );
  return new Uint8Array(plainBuffer);
}

export async function decryptAesGcmText(
  encryptedPayload: Uint8Array,
  masterKey: CryptoKey
): Promise<string> {
  const plainBytes = await decryptAesGcmBytes(encryptedPayload, masterKey);
  return new TextDecoder("utf-8").decode(plainBytes);
}

export async function unlockVaultWithPassphrase(
  passphrase: string,
  config: VaultConfig
): Promise<CryptoKey> {
  const key = await deriveMasterKey(
    passphrase,
    config.salt,
    config.iterations || 100000
  );
  try {
    const checkBytes = base64ToUint8Array(config.check);
    const decoded = await decryptAesGcmText(checkBytes, key);
    if (decoded !== CHECK_PLAINTEXT) {
      throw new Error("INVALID_PASSPHRASE");
    }
    return key;
  } catch {
    throw new Error("パスワードが正しくありません。");
  }
}
