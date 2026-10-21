export const uid = () => {
  if(crypto.randomUUID)return crypto.randomUUID();
  const bytes=crypto.getRandomValues(new Uint8Array(16));bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;
  const h=Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
};
export const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const initials = name => String(name || '?').split(/[\s@]+/).filter(Boolean).slice(0, 2).map(p => p[0]).join('').toUpperCase();
export function addresses(value) {
  if (!String(value || '').trim()) return [];
  return String(value).split(/[,;]+/).map(v => v.trim()).filter(Boolean).map(v => {
    const m = v.match(/^(.*?)<([^<>\s]+@[^<>\s]+)>$/);
    const email = (m ? m[2] : v).trim();
    if (!/^[^\s<>@,;]+@[^\s<>@,;]+\.[^\s<>@,;]+$/.test(email) || /[\r\n]/.test(v)) throw new Error('Enter a valid email address: ' + v);
    return {name: m ? m[1].trim().replace(/^"|"$/g, '') : '', email};
  });
}
export function bytes(n) { return n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB'; }
export function folderMatch(m, folder, now = Date.now()) {
  if (folder === 'snoozed') return m.snoozeUntil > now && m.folder !== 'trash';
  if (m.snoozeUntil > now && folder === 'inbox') return false;
  if (folder === 'starred') return m.starred && m.folder !== 'trash';
  if (folder.startsWith('label:')) return m.labels?.includes(folder.slice(6)) && m.folder !== 'trash';
  if (folder === 'all') return m.folder !== 'trash' && m.folder !== 'drafts';
  return m.folder === folder;
}
export function matchesSearch(m, query) {
  const tokens = String(query).match(/(?:[^\s"]+|"[^"]*")+/g) || [];
  return tokens.every(raw => {
    const negate = raw.startsWith('-'), token = (negate ? raw.slice(1) : raw).replaceAll('"', '').toLowerCase();
    const colon = token.indexOf(':'), field = colon > 0 ? token.slice(0, colon) : '', val = token.slice(colon + 1);
    const from = [m.from?.name, m.from?.email].join(' ').toLowerCase();
    let result;
    if (field === 'from') result = from.includes(val);
    else if (field === 'to') result = (m.to || []).some(a => (a.email + ' ' + a.name).toLowerCase().includes(val));
    else if (field === 'subject') result = m.subject.toLowerCase().includes(val);
    else if (field === 'is' && val === 'unread') result = !m.read;
    else if (field === 'is' && val === 'read') result = m.read;
    else if (field === 'is' && val === 'starred') result = m.starred;
    else if (field === 'has' && val === 'attachment') result = Boolean(m.attachments?.length);
    else if (field === 'in') result = m.folder === val;
    else if (field === 'label') result = (m.labels || []).some(l => l.toLowerCase() === val);
    else if (field === 'before') result = new Date(m.date).getTime() < new Date(val).getTime();
    else if (field === 'after') result = new Date(m.date).getTime() > new Date(val).getTime();
    else result = [from, m.subject, m.body, ...(m.labels || [])].join(' ').toLowerCase().includes(token);
    return negate ? !result : Boolean(result);
  });
}
export function visibleMessages(messages, {folder = 'inbox', query = '', unreadOnly = false} = {}) {
  return messages.filter(m => (query ? m.folder !== 'trash' || query.includes('in:trash') : folderMatch(m, folder)) && (!unreadOnly || !m.read) && matchesSearch(m, query)).sort((a,b) => new Date(b.date) - new Date(a.date));
}
export function groupThreads(messages) {
  const groups = new Map();
  for (const m of messages) {
    const key = m.threadId || m.id;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(m);
  }
  return [...groups.values()].map(list => ({...list[0], members:list, read:list.every(m => m.read), starred:list.some(m => m.starred)}));
}
export function safeHTTPS(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.hash) throw new Error('A secure HTTPS address without embedded credentials is required.');
  return url;
}
export const pointerEscape = s => String(s).replaceAll('~','~0').replaceAll('/','~1');
export function htmlToText(html) {
  return String(html).replace(/<(script|style|head)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,'').replace(/<(br|\/p|\/div|\/li|\/tr)\b[^>]*>/gi,'\n').replace(/<[^>]*>/g,'').replace(/&(#\d+|#x[0-9a-f]+|amp|lt|gt|quot|apos|nbsp);/gi,(_,v)=> {
    if (v[0]==='#') { const n=v[1].toLowerCase()==='x'?parseInt(v.slice(2),16):Number(v.slice(1)); return n>0 && n<=0x10ffff?String.fromCodePoint(n):''; }
    return ({amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' '})[v.toLowerCase()] || '';
  }).replace(/\n{4,}/g,'\n\n').trim();
}
export function validateSnapshot(data) {
  if (!data || !Array.isArray(data.messages) || data.messages.length > 20000) throw new Error('This is not a supported Mail Wizard backup.');
  if (data.schema !== 1) throw new Error('This backup uses an unsupported format.');
  if(!['demo','jmap','imap'].includes(data.mode) || !data.account || typeof data.account.name!=='string' || typeof data.account.email!=='string' || !data.settings || typeof data.settings.signature!=='string' || ![8,15,30].includes(Number(data.settings.undoSeconds)))throw new Error('This backup has invalid workspace settings.');
  if(data.collections && (!Array.isArray(data.collections) || data.collections.some(l=>typeof l!=='string'||l.length>60)))throw new Error('This backup has invalid collections.');
  if(data.contacts && (!Array.isArray(data.contacts)||data.contacts.some(a=>!a||typeof a.name!=='string'||typeof a.email!=='string')))throw new Error('This backup has invalid contacts.');
  if(data.mode!=='demo' && (!data.connection || data.connection.type!==data.mode))throw new Error('This backup has an invalid account connection.');
  if(data.mode==='jmap') {safeHTTPS(data.connection.sessionURL);if(typeof data.connection.token!=='string')throw new Error('This backup has an invalid provider token.');}
  for (const m of data.messages) {
    if (!m || typeof m.id !== 'string' || typeof m.subject !== 'string' || typeof m.body !== 'string' || !m.from || typeof m.from.email !== 'string' || !Array.isArray(m.to) || !Array.isArray(m.attachments) || !['inbox','sent','drafts','archive','trash','spam'].includes(m.folder) || !Number.isFinite(Date.parse(m.date))) throw new Error('This backup contains an invalid message.');
    for(const list of [m.to,m.cc || [],m.bcc || []])if(!Array.isArray(list)||list.some(a=>!a||typeof a.email!=='string'||(a.name!==undefined&&typeof a.name!=='string')))throw new Error('This backup contains an invalid address.');
    if(m.labels && (!Array.isArray(m.labels)||m.labels.some(l=>typeof l!=='string')))throw new Error('This backup contains an invalid label.');
    if(m.attachments.some(a=>!a||typeof a.name!=='string'||(a.data!==undefined&&(typeof a.data!=='string'||!/^[A-Za-z0-9+/]*={0,2}$/.test(a.data)))))throw new Error('This backup contains an invalid attachment.');
  }
  return data;
}
