const encoder = new TextEncoder(), decoder = new TextDecoder();
export const encode64 = bytes => { let s = ''; for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode(...bytes.subarray(i,i+8192)); return btoa(s); };
export const decode64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
export async function deriveKey(passphrase, salt) {
  if(!crypto.subtle)throw new Error('Encrypted mail requires HTTPS, localhost, or the desktop app.');
  if (passphrase.length < 12) throw new Error('Use a vault passphrase of at least 12 characters.');
  const base = await crypto.subtle.importKey('raw', encoder.encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({name:'PBKDF2', salt, iterations:310000, hash:'SHA-256'}, base, {name:'AES-GCM', length:256}, false, ['encrypt','decrypt']);
}
export async function seal(value, key, salt) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const body = await crypto.subtle.encrypt({name:'AES-GCM', iv, additionalData:encoder.encode('mail-wizard:1')}, key, encoder.encode(JSON.stringify(value)));
  return {format:'mail-wizard-vault', version:1, salt:encode64(salt), iv:encode64(iv), data:encode64(new Uint8Array(body))};
}
export async function unseal(envelope, passphrase) {
  if (envelope.format !== 'mail-wizard-vault' || envelope.version !== 1) throw new Error('Unsupported vault format.');
  try {
    const salt = decode64(envelope.salt), key = await deriveKey(passphrase, salt);
    const raw = await crypto.subtle.decrypt({name:'AES-GCM', iv:decode64(envelope.iv), additionalData:encoder.encode('mail-wizard:1')}, key, decode64(envelope.data));
    return {value:JSON.parse(decoder.decode(raw)), key, salt};
  } catch { throw new Error('The passphrase is incorrect, or this vault is damaged.'); }
}
let database;
async function db() {
  if (database) return database;
  database = await new Promise((resolve,reject) => {
    const request = indexedDB.open('mail-wizard', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('state');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return database;
}
export async function readStore() {
  const d = await db();
  return new Promise((resolve,reject) => { const r=d.transaction('state').objectStore('state').get('snapshot'); r.onsuccess=()=>resolve(r.result); r.onerror=()=>reject(r.error); });
}
export async function writeStore(value) {
  const d = await db();
  return new Promise((resolve,reject) => { const tx=d.transaction('state','readwrite'); tx.objectStore('state').put(value,'snapshot'); tx.oncomplete=resolve; tx.onerror=()=>reject(tx.error); tx.onabort=()=>reject(tx.error || new Error('Storage write was interrupted.')); });
}
