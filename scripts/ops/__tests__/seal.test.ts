import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { opsReportKey, seal, unseal } from '../seal.ts';

const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });

test('a sealed report opens with the private key only, and not when it was changed', () => {
	const text = 'private report شخص '.repeat(5000);
	const sealed = seal(text, publicKey);
	assert.equal(unseal(sealed, privateKey), text);
	assert.doesNotMatch(JSON.stringify(sealed), /private/);
	assert.notEqual(seal(text, publicKey).data, sealed.data);
	const other = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
	assert.throws(() => unseal(sealed, other));
	const data = Buffer.from(sealed.data, 'base64');
	data[0]! ^= 1;
	assert.throws(() => unseal({ ...sealed, data: data.toString('base64') }, privateKey));
	assert.throws(() => unseal({ ...sealed, iv: Buffer.alloc(8).toString('base64') }, privateKey), /not a sealed/);
	assert.throws(() => unseal({ ...sealed, tag: Buffer.alloc(4).toString('base64') }, privateKey));
});

test('the committed key is an RSA-4096 public key', () => {
	const key = opsReportKey();
	assert.equal(key.type, 'public');
	assert.equal(key.asymmetricKeyType, 'rsa');
	assert.equal(key.asymmetricKeyDetails?.modulusLength, 4096);
	assert.equal(seal('x').v, 1);
});
