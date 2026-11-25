/**
 * The full ops reports (prod-errors, media-diagnostics) are encrypted on the runner: their log, summary
 * and artifacts are public. Hybrid, node crypto only: a random AES-256-GCM key per report, wrapped with
 * RSA-OAEP (SHA-256) to the public key below. The private key is kept outside every repository and is
 * never on a runner; scripts/ops/open-report.ts opens a report with it.
 */
import { createCipheriv, createDecipheriv, createPublicKey, constants, privateDecrypt, publicEncrypt, randomBytes, type KeyLike } from 'node:crypto';

/** SPKI (base64) of the reports' RSA-4096 key. */
const OPS_REPORT_PUBLIC_KEY =
	'MIICIjANBgkqhkiG9w0BAQEFAAOCAg8AMIICCgKCAgEAv0R5u7FXEkGDBtRHuJ8QoyuGz/kjZy7W9ULRa57pTCXeU5+9ygeDygM3AYsv0LzPdBwZVIKtYlyKdknkuG38S/YIVaoUU4Y7BEndwwgSgIdLIbT2jqjXXNCIOQ8mnVSdjdNVeotYRs6aEOMdmNNW3NCW97XsIsMg/8BVe/eVGDxRJ8NXa75HWMXUkmJU6hSaxlXK76d0Oq9tqSgoK2SgXyQvAXrCkgsjKHz/jsIxj2cr2DyPRl5/2B70M0s1aR1j+tBy+X8cfoTWKoZUWdcmjSOMnpjKpBhxYDnkVo4DPWBe3JUX80kttI2POX3XXslPZ1VpITHl8ENCVe0n1wFSY5ABzCGWma97SB/5krpwznSLbEiZog6Xg9IZp9gz5ZRSa75aV4VmN/V/qwJ/Qt9+w+hXx2WiroPN/uQiFIyy1Ia4pHsazljbSDn0wc5UPalVqZ/x5yJRVJZeiuOU2QCwIq1qrYStdJonsycdu3FMC2+l7XtwnvuUVcxmEBtQx6ksMrZ5Dy22Iu9ctNOjHO+11SDEMTbYG4SP7ZXHRvZK6YaxSpRXXR43CSvt9qlUod6LQzTGQ5GkN34UDDZn0Ldei3gULuj4NQQnvVBClL44Iu6Vs7IU3MgkUMIyQOcoKnX9+Vo5yblKmLLDKrTbyIQayE1SM4RJU2LpyQWMNc7pPZ0CAwEAAQ==';

export const opsReportKey = () => createPublicKey({ key: Buffer.from(OPS_REPORT_PUBLIC_KEY, 'base64'), format: 'der', type: 'spki' });

export interface SealedReport {
	v: 1;
	alg: 'RSA-OAEP-256+A256GCM';
	key: string;
	iv: string;
	tag: string;
	data: string;
}

const oaep = (key: KeyLike) => ({ key, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' });
const ALG = 'RSA-OAEP-256+A256GCM' as const;

export function seal(text: string, publicKey: KeyLike = opsReportKey()): SealedReport {
	const key = randomBytes(32);
	const iv = randomBytes(12);
	const cipher = createCipheriv('aes-256-gcm', key, iv);
	cipher.setAAD(Buffer.from(ALG));
	const data = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
	return { v: 1, alg: ALG, key: publicEncrypt(oaep(publicKey), key).toString('base64'), iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') };
}

export function unseal(sealed: SealedReport, privateKey: KeyLike): string {
	if (sealed.v !== 1 || sealed.alg !== ALG) throw new Error('not a sealed ops report');
	const key = privateDecrypt(oaep(privateKey), Buffer.from(sealed.key, 'base64'));
	const tag = Buffer.from(sealed.tag, 'base64');
	if (tag.length !== 16) throw new Error('not a sealed ops report');
	const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(sealed.iv, 'base64'), { authTagLength: 16 });
	decipher.setAAD(Buffer.from(ALG));
	decipher.setAuthTag(tag);
	return Buffer.concat([decipher.update(Buffer.from(sealed.data, 'base64')), decipher.final()]).toString('utf8');
}
