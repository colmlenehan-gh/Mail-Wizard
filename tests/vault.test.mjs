import test from 'node:test';
import assert from 'node:assert/strict';
import {deriveKey,seal,unseal,encode64,decode64} from '../dist/modules/vault.js';
const pass='a long synthetic vault passphrase';
test('AES-GCM vault round-trips credentials, Unicode and attachment data',async()=>{
  const salt=crypto.getRandomValues(new Uint8Array(16)),key=await deriveKey(pass,salt),data={secret:'provider-token-fixture',body:'Grüße ☕',attachment:encode64(new Uint8Array([0,1,2,255]))};
  const envelope=await seal(data,key,salt);assert(!JSON.stringify(envelope).includes(data.secret));assert.deepEqual((await unseal(envelope,pass)).value,data);assert.deepEqual(decode64(data.attachment),new Uint8Array([0,1,2,255]));
});
test('wrong passphrase and modified authenticated ciphertext are rejected',async()=>{const salt=crypto.getRandomValues(new Uint8Array(16)),key=await deriveKey(pass,salt),env=await seal({hello:'world'},key,salt);await assert.rejects(unseal(env,'another sufficiently long password'));const b=decode64(env.data);b[0]^=1;await assert.rejects(unseal({...env,data:encode64(b)},pass));});
test('each write has a fresh IV and weak passphrases are rejected',async()=>{const salt=crypto.getRandomValues(new Uint8Array(16)),key=await deriveKey(pass,salt);assert.notEqual((await seal({},key,salt)).iv,(await seal({},key,salt)).iv);await assert.rejects(deriveKey('short',salt));});
