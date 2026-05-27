import { createSign } from 'crypto';
import { readFileSync } from 'fs';

const SA = JSON.parse(readFileSync('C:/Users/Administrator/Desktop/my-project-99925-497603-969be8ba4ad7.json', 'utf8'));
const SHEET_ID = '1PCnqi6OiX4HmWZ1EcTnNXraYhkyDwvRo4oGxLDUOnBo';

async function getToken() {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    iss: SA.client_email,
    scope: 'https://www.googleapis.com/auth/spreadsheets.readonly',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now, exp: now + 3600,
  })).toString('base64url');
  const sign = createSign('RSA-SHA256');
  sign.update(`${header}.${payload}`);
  const sig = sign.sign(SA.private_key, 'base64url');
  const jwt = `${header}.${payload}.${sig}`;
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
  });
  const data = await res.json();
  return data.access_token;
}

const token = await getToken();
// Get all sheet names first
const metaRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}?fields=sheets.properties`, {
  headers: { Authorization: `Bearer ${token}` },
});
const meta = await metaRes.json();
console.log('SHEETS:', JSON.stringify(meta.sheets?.map(s => s.properties?.title)));

// Read first sheet
const dataRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/A1:Z200`, {
  headers: { Authorization: `Bearer ${token}` },
});
const data = await dataRes.json();
const rows = data.values || [];
console.log(`\nTotal rows: ${rows.length}`);
rows.slice(0, 5).forEach((r, i) => console.log(`Row${i}:`, JSON.stringify(r)));
console.log('\n--- All rows (col A = 岗位名称) ---');
rows.forEach((r, i) => {
  if (r[0] && i > 0) console.log(i, r[0], '|', r[1] || '', '|', r[2] || '');
});
