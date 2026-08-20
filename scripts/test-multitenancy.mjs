import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import vm from 'node:vm';

const scriptProperties = new Map();
const userProperties = new Map();
let activeEmail = 'teacher@school.example.jp';

const propertyStore = (map) => ({
  getProperty: (key) => map.get(key) ?? null,
  setProperty: (key, value) => { map.set(key, String(value)); return propertyStore(map); },
  deleteProperty: (key) => map.delete(key)
});

const toSignedBytes = (buffer) => [...buffer].map((value) => value > 127 ? value - 256 : value);
const base64WebSafe = (value) => Buffer.from(value).toString('base64url') + (Buffer.from(value).toString('base64').endsWith('==') ? '==' : Buffer.from(value).toString('base64').endsWith('=') ? '=' : '');

const sandbox = {
  console,
  Date,
  Math,
  JSON,
  String,
  Error,
  PropertiesService: {
    getScriptProperties: () => propertyStore(scriptProperties),
    getUserProperties: () => propertyStore(userProperties)
  },
  Session: {
    getActiveUser: () => ({ getEmail: () => activeEmail })
  },
  LockService: {
    getScriptLock: () => ({ waitLock() {}, releaseLock() {} })
  },
  Utilities: {
    Charset: { UTF_8: 'UTF-8' },
    DigestAlgorithm: { SHA_256: 'SHA_256' },
    computeDigest: (_algorithm, value) => toSignedBytes(crypto.createHash('sha256').update(String(value)).digest()),
    computeHmacSha256Signature: (value, secret) => toSignedBytes(crypto.createHmac('sha256', String(secret)).update(String(value)).digest()),
    base64EncodeWebSafe: (value) => base64WebSafe(typeof value === 'string' ? Buffer.from(value) : Buffer.from(value.map((byte) => byte < 0 ? byte + 256 : byte))),
    base64DecodeWebSafe: (value) => [...Buffer.from(value, 'base64url')],
    newBlob: (bytes) => ({ getDataAsString: () => Buffer.from(bytes).toString('utf8') }),
    getUuid: () => crypto.randomUUID()
  }
};

vm.createContext(sandbox);
const serverSource = fs.readFileSync(new URL('../code.gs', import.meta.url), 'utf8');
const appSource = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const pwaSource = fs.readFileSync(new URL('../pwa/index.html', import.meta.url), 'utf8');
vm.runInContext(serverSource, sandbox, { filename: 'code.gs' });

const teacher = sandbox.getActiveUser_();
const tenant = {
  classCode: '7K3M9P2R',
  spreadsheetId: 'sheet-1',
  folderId: 'folder-1',
  ownerHash: teacher.emailHash,
  domain: teacher.domain
};
scriptProperties.set('TENANT_' + tenant.classCode, JSON.stringify(tenant));

const teacherToken = sandbox.createContextToken_(tenant, 'teacher', teacher.emailHash);
assert.equal(sandbox.verifyContext_(teacherToken, 'teacher').tenant.spreadsheetId, 'sheet-1');

activeEmail = 'student@school.example.jp';
const student = sandbox.getActiveUser_();
const studentToken = sandbox.createContextToken_(tenant, 'student', student.emailHash);
assert.equal(sandbox.verifyContext_(studentToken).role, 'student');
assert.throws(() => sandbox.verifyContext_(studentToken, 'teacher'), /先生のみ/);

activeEmail = 'student@other-school.example.jp';
assert.throws(() => sandbox.verifyContext_(studentToken), /アカウントが変わりました|学校アカウント専用/);

activeEmail = 'student@school.example.jp';
const tamperedToken = teacherToken.slice(0, -1) + (teacherToken.endsWith('A') ? 'B' : 'A');
assert.throws(() => sandbox.verifyContext_(tamperedToken), /確認できません/);

assert.equal(sandbox.normalizeClassCode_(' 7k3m-9p2r '), '7K3M9P2R');
assert.equal(
  sandbox.buildStudentEntryUrl_('https://online-publisher-pro.giga-school.com/pwa/?source=pwa', '7K3M9P2R'),
  'https://online-publisher-pro.giga-school.com/pwa/?class=7K3M9P2R'
);
assert.equal(sandbox.buildStudentEntryUrl_('javascript:alert(1)', '7K3M9P2R'), '');
assert.equal(sandbox.safeCellText_('=IMPORTXML("x")', 100).startsWith("'="), true);
assert.equal(sandbox.isConsumerGoogleDomain_('gmail.com'), true);
assert.equal(sandbox.isConsumerGoogleDomain_('googlemail.com'), true);
assert.doesNotThrow(() => sandbox.assertSameDomain_('googlemail.com', 'gmail.com'));
assert.equal(
  sandbox.buildSpreadsheetUrl_({ spreadsheetId: 'sheet-1', spreadsheetResourceKey: 'key+1' }),
  'https://docs.google.com/spreadsheets/d/sheet-1/edit?resourcekey=key%2B1'
);

const sharingCalls = [];
const spreadsheetFile = {
  setSharing: (access, permission) => sharingCalls.push(['file', access, permission]),
  getResourceKey: () => 'sheet-key'
};
const imageFolder = {
  setSharing: (access, permission) => sharingCalls.push(['folder', access, permission]),
  getResourceKey: () => 'folder-key'
};
sandbox.DriveApp = {
  Access: { ANYONE_WITH_LINK: 'anyone-link', DOMAIN_WITH_LINK: 'domain-link' },
  Permission: { EDIT: 'edit' },
  getFileById: () => spreadsheetFile
};

const personalSharing = sandbox.shareTenantStorage_('sheet-1', imageFolder, 'gmail.com');
assert.deepEqual(sharingCalls, [
  ['file', 'anyone-link', 'edit'],
  ['folder', 'anyone-link', 'edit']
]);
assert.equal(personalSharing.spreadsheetResourceKey, 'sheet-key');
assert.equal(personalSharing.folderResourceKey, 'folder-key');
assert.equal(personalSharing.sharingMode, 'link');

assert.match(pwaSource, /searchParams\.set\('entry', location\.origin \+ location\.pathname\)/);
assert.match(appSource, /児童を招待/);
assert.match(appSource, /qrcodejs\/1\.0\.0\/qrcode\.min\.js/);

console.log('multi-tenant security tests: ok');
