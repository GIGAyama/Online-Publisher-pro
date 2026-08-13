/**
 * オンライン出版社 Pro - GIGA Edition
 * サーバーサイドスクリプト (コード.gs)
 *
 * 共通URL・教師別データベース対応版。
 * Webアプリは必ず「ウェブアプリにアクセスしているユーザー」として実行する。
 */

const SHEET_DRAFTS = '作文データ';
const SHEET_COMMENTS = '交流コメントデータ';
const TENANT_REGISTRY_PREFIX = 'TENANT_';
const CONTEXT_SECRET_KEY = 'CONTEXT_SIGNING_SECRET';
const CONTEXT_TTL_SECONDS = 12 * 60 * 60;
const CLASS_CODE_CHARS = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

// カラム定義: 作文データシート
const COL_DRAFTS = {
  ID: 1, TITLE: 2, CLASS: 3, NAME: 4, CONTENT: 5,
  STATUS: 6, ILLUSTRATIONS: 7, CORRECTION: 8, TEACHER_CMT: 9,
  CREATED_AT: 10, UPDATED_AT: 11, DELETED_AT: 12, OWNER_KEY: 13
};

// カラム定義: 交流コメントシート
const COL_COMMENTS = {
  COMMENT_ID: 1, DRAFT_ID: 2, NAME: 3, TEXT: 4, CREATED_AT: 5
};

/**
 * Webアプリのエントリーポイント
 */
function doGet(e) {
  const template = HtmlService.createTemplateFromFile('index');
  try {
    const params = (e && e.parameter) || {};
    const requestedMode = String(params.mode || '').toLowerCase();
    const classCode = normalizeClassCode_(params.class || params.code || '');
    const entryUrl = sanitizeEntryUrl_(params.entry || '');
    const user = getActiveUser_();
    let tenant;
    let role;

    if (requestedMode === 'teacher') {
      tenant = initTeacherTenant_(user);
      role = 'teacher';
    } else {
      if (!classCode) throw new Error('学級コードが指定されていません。共通入口から入り直してください。');
      tenant = getTenantByCode_(classCode);
      assertSameDomain_(user.domain, tenant.domain);
      assertTenantAccessible_(tenant);
      role = user.emailHash === tenant.ownerHash ? 'teacher' : 'student';
    }

    template.appContextJson = safeJson_({
      status: 'success',
      role: role,
      classCode: tenant.classCode,
      domain: tenant.domain,
      spreadsheetUrl: role === 'teacher' ? buildSpreadsheetUrl_(tenant) : '',
      studentEntryUrl: role === 'teacher' ? buildStudentEntryUrl_(entryUrl, tenant.classCode) : '',
      token: createContextToken_(tenant, role, user.emailHash)
    });
  } catch (error) {
    template.appContextJson = safeJson_({
      status: 'error',
      message: error && error.message ? error.message : '初期化に失敗しました。'
    });
  }

  return template.evaluate()
      .setTitle('オンライン出版社 Pro')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1.0, viewport-fit=cover, interactive-widget=resizes-content')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
      .setFaviconUrl('https://drive.google.com/uc?id=1A5yDOUvaYCU6qMJM_ZuKye7ClqQQHzYT&.png');
}

/**
 * 教師アカウント用のテナントを初期化・自己修復する。
 */
function initTeacherTenant_(user) {
  const userProps = PropertiesService.getUserProperties();
  let classCode = normalizeClassCode_(userProps.getProperty('CLASS_CODE') || '');
  let spreadsheetId = userProps.getProperty('SPREADSHEET_ID');
  let folderId = userProps.getProperty('IMAGE_FOLDER_ID');
  let folder;
  let ss;

  if (spreadsheetId) {
    try { ss = SpreadsheetApp.openById(spreadsheetId); } catch (e) { spreadsheetId = null; }
  }
  if (!spreadsheetId) {
    ss = SpreadsheetApp.create('オンライン出版社Pro_データベース');
    spreadsheetId = ss.getId();
    userProps.setProperty('SPREADSHEET_ID', spreadsheetId);
  }

  if (folderId) {
    try { folder = DriveApp.getFolderById(folderId); } catch(e) { folderId = null; }
  }
  if (!folderId) {
    folder = DriveApp.createFolder('オンライン出版社Pro_画像データ');
    folderId = folder.getId();
    userProps.setProperty('IMAGE_FOLDER_ID', folderId);
  }

  ensureDatabaseSheets_(ss);
  const sharing = shareTenantStorage_(spreadsheetId, folder, user.domain);

  if (!classCode) {
    classCode = createUniqueClassCode_();
    userProps.setProperty('CLASS_CODE', classCode);
  }

  const tenant = {
    classCode: classCode,
    spreadsheetId: spreadsheetId,
    folderId: folderId,
    spreadsheetResourceKey: sharing.spreadsheetResourceKey,
    folderResourceKey: sharing.folderResourceKey,
    sharingMode: sharing.sharingMode,
    ownerHash: user.emailHash,
    domain: user.domain,
    updatedAt: new Date().toISOString()
  };
  PropertiesService.getScriptProperties().setProperty(TENANT_REGISTRY_PREFIX + classCode, JSON.stringify(tenant));
  return tenant;
}

function ensureDatabaseSheets_(ss) {
  let draftSheet = ss.getSheetByName(SHEET_DRAFTS);
  if (!draftSheet) {
    draftSheet = ss.insertSheet(SHEET_DRAFTS);
    const headers = ['作品ID', '題名', '学年・クラス', '氏名', '本文', 'ステータス', '挿絵データ', '添削データ', '先生コメント', '作成日時', '更新日時', '削除日時', '作者キー'];
    const range = draftSheet.getRange(1, 1, 1, headers.length);
    range.setValues([headers]);
    range.setFontWeight('bold').setBackground('#e67e22').setFontColor('#ffffff').setHorizontalAlignment('center');
    draftSheet.setFrozenRows(1);
    draftSheet.setColumnWidth(COL_DRAFTS.ID, 120);
    draftSheet.setColumnWidth(COL_DRAFTS.TITLE, 150);
    draftSheet.setColumnWidth(COL_DRAFTS.CONTENT, 300);
    draftSheet.getRange(2, 1, 999, headers.length).applyRowBanding(SpreadsheetApp.BandingTheme.LIGHT_GREY);

    const defaultSheet = ss.getSheetByName('シート1');
    if (defaultSheet) ss.deleteSheet(defaultSheet);
  }

  if (!draftSheet.getRange(1, COL_DRAFTS.OWNER_KEY).getValue()) {
    draftSheet.getRange(1, COL_DRAFTS.OWNER_KEY).setValue('作者キー');
  }
  draftSheet.hideColumns(COL_DRAFTS.OWNER_KEY);

  let commentSheet = ss.getSheetByName(SHEET_COMMENTS);
  if (!commentSheet) {
    commentSheet = ss.insertSheet(SHEET_COMMENTS);
    const headers = ['コメントID', '作品ID', '投稿者名', 'コメント本文', '投稿日時'];
    const range = commentSheet.getRange(1, 1, 1, headers.length);
    range.setValues([headers]);
    range.setFontWeight('bold').setBackground('#27ae60').setFontColor('#ffffff').setHorizontalAlignment('center');
    commentSheet.setFrozenRows(1);
    commentSheet.getRange(2, 1, 999, headers.length).applyRowBanding(SpreadsheetApp.BandingTheme.LIGHT_GREY);
  }

}

function shareTenantStorage_(spreadsheetId, folder, domain) {
  const spreadsheetFile = DriveApp.getFileById(spreadsheetId);
  const personalAccount = isConsumerGoogleDomain_(domain);
  let sharingMode = personalAccount ? 'link' : 'domain';

  try {
    const access = personalAccount ? DriveApp.Access.ANYONE_WITH_LINK : DriveApp.Access.DOMAIN_WITH_LINK;
    spreadsheetFile.setSharing(access, DriveApp.Permission.EDIT);
    folder.setSharing(access, DriveApp.Permission.EDIT);
  } catch (error) {
    if (personalAccount) {
      throw new Error('個人用Googleアカウントのリンク共有設定に失敗しました。Google Driveの共有設定を確認してください。');
    }

    // Workspace管理者が「ドメイン内リンク共有」を無効にしている環境では、
    // 通常のリンク共有を試す。こちらも禁止されている場合は管理者の許可が必要。
    try {
      spreadsheetFile.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.EDIT);
      folder.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.EDIT);
      sharingMode = 'link';
    } catch (fallbackError) {
      throw new Error('学級データの共有設定に失敗しました。Google Workspace管理者に、Driveのリンク共有を許可してもらってください。');
    }
  }

  return {
    sharingMode: sharingMode,
    spreadsheetResourceKey: String(spreadsheetFile.getResourceKey() || ''),
    folderResourceKey: String(folder.getResourceKey() || '')
  };
}

function buildSpreadsheetUrl_(tenant) {
  let url = 'https://docs.google.com/spreadsheets/d/' + encodeURIComponent(tenant.spreadsheetId) + '/edit';
  if (tenant.spreadsheetResourceKey) {
    url += '?resourcekey=' + encodeURIComponent(tenant.spreadsheetResourceKey);
  }
  return url;
}

function openTenantSpreadsheet_(tenant) {
  return SpreadsheetApp.openByUrl(buildSpreadsheetUrl_(tenant));
}

function openTenantFolder_(tenant) {
  if (tenant.folderResourceKey) {
    return DriveApp.getFolderByIdAndResourceKey(tenant.folderId, tenant.folderResourceKey);
  }
  return DriveApp.getFolderById(tenant.folderId);
}


// --- API Methods (フロントエンドから呼び出される関数) ---

/**
 * 挿絵画像をDriveに保存し、公開URLを返す
 * @param {string} base64Data - 画像のBase64文字列
 * @param {string} filename - 保存するファイル名
 */
function uploadIllustration(base64Data, filename, contextToken) {
  try {
    const context = verifyContext_(contextToken);
    const folder = openTenantFolder_(context.tenant);
    if (typeof base64Data !== 'string' || base64Data.length > 2 * 1024 * 1024) {
      throw new Error('画像サイズが大きすぎます。');
    }
    
    // Base64データからBlobを生成
    const split = base64Data.split(',');
    const type = split[0].split(';')[0].replace('data:', '');
    if (['image/jpeg', 'image/png', 'image/webp'].indexOf(type) < 0) throw new Error('対応していない画像形式です。');
    const bytes = Utilities.base64Decode(split[1]);
    
    const safeFilename = String(filename || ('img_' + new Date().getTime() + '.jpg')).replace(/[^\w.\-ぁ-んァ-ヶ一-龠]/g, '_').slice(0, 120);
    const blob = Utilities.newBlob(bytes, type, safeFilename);
    const file = folder.createFile(blob);
    
    // HTMLの<img>タグで直接読み込めるURL形式
    const directUrl = 'https://lh3.googleusercontent.com/d/' + file.getId();    
    return { status: 'success', url: directUrl };
  } catch (e) {
    return { status: 'error', message: '画像の保存に失敗しました: ' + e.message };
  }
}

/**
 * 作文データの保存・提出
 */
function saveOrSubmitDraft(draftData, isSubmit, contextToken) {
  const context = verifyContext_(contextToken);
  draftData = normalizeDraftInput_(draftData);
  const lock = LockService.getScriptLock();
  try { lock.waitLock(10000); } catch (e) { return { status: 'error', message: 'サーバー混雑中' }; }

  try {
    const ss = openTenantSpreadsheet_(context.tenant);
    const sheet = ss.getSheetByName(SHEET_DRAFTS);
    const now = new Date();
    
    let status = draftData.status || 'draft';
    if (context.role !== 'teacher') {
      status = isSubmit ? 'submitted' : (status === 'rework' ? 'rework' : 'draft');
    }

    // JSON変換 (スプレッドシートのセルに保存するため)
    const illustStr = typeof draftData.illustrations === 'string' ? draftData.illustrations : JSON.stringify(draftData.illustrations || []);
    const correctionStr = typeof draftData.correction === 'string' ? draftData.correction : JSON.stringify(draftData.correction || []);

    if (draftData.id) {
      const foundRow = findRowById_(sheet, draftData.id);
      if (foundRow > 0) {
        const rowData = sheet.getRange(foundRow, 1, 1, COL_DRAFTS.OWNER_KEY).getValues()[0];
        if (rowData[COL_DRAFTS.DELETED_AT - 1]) return { status: 'error', message: '削除されています' };
        const ownerKey = rowData[COL_DRAFTS.OWNER_KEY - 1];
        if (context.role !== 'teacher' && ownerKey !== context.userHash) {
          return { status: 'error', message: 'この作品を編集する権限がありません。' };
        }

        sheet.getRange(foundRow, COL_DRAFTS.TITLE).setValue(draftData.title);
        sheet.getRange(foundRow, COL_DRAFTS.CLASS).setValue(draftData.class);
        sheet.getRange(foundRow, COL_DRAFTS.NAME).setValue(draftData.name);
        sheet.getRange(foundRow, COL_DRAFTS.CONTENT).setValue(draftData.content);
        sheet.getRange(foundRow, COL_DRAFTS.STATUS).setValue(status);
        sheet.getRange(foundRow, COL_DRAFTS.ILLUSTRATIONS).setValue(illustStr);
        sheet.getRange(foundRow, COL_DRAFTS.CORRECTION).setValue(correctionStr);
        sheet.getRange(foundRow, COL_DRAFTS.UPDATED_AT).setValue(now);

        if (!ownerKey && context.role === 'teacher') sheet.getRange(foundRow, COL_DRAFTS.OWNER_KEY).setValue(context.userHash);
        if (context.role === 'teacher' && draftData.teacherCmt !== undefined) sheet.getRange(foundRow, COL_DRAFTS.TEACHER_CMT).setValue(draftData.teacherCmt);

        return { status: 'success', message: isSubmit ? '提出しました！' : '保存しました。', id: draftData.id, docStatus: status };
      }
    }
    
    // 新規作成
    const newId = Utilities.getUuid();
    sheet.appendRow([
      newId, draftData.title, draftData.class, draftData.name, draftData.content,
      status, illustStr, correctionStr, '', now, now, '', context.userHash
    ]);
    return { status: 'success', message: isSubmit ? '提出しました！' : '保存しました。', id: newId, docStatus: status };

  } catch (e) {
    return { status: 'error', message: 'エラー: ' + e.message };
  } finally {
    lock.releaseLock(); 
  }
}

/**
 * リストとコメントを一括取得する
 */
function getDraftList(mode, contextToken) {
  try {
    const context = verifyContext_(contextToken, mode === 'teacher' ? 'teacher' : null);

    const ss = openTenantSpreadsheet_(context.tenant);
    
    // 1. 作文データの取得
    const draftSheet = ss.getSheetByName(SHEET_DRAFTS);
    const dLastRow = draftSheet.getLastRow();
    let drafts = [];
    if (dLastRow >= 2) {
      const dValues = draftSheet.getRange(2, 1, dLastRow - 1, COL_DRAFTS.OWNER_KEY).getValues();
      drafts = dValues
        .filter(row => row[COL_DRAFTS.DELETED_AT - 1] === '')
        .filter(row => {
          if (mode === 'student') {
            const ownerKey = row[COL_DRAFTS.OWNER_KEY - 1];
            return ownerKey === context.userHash;
          }
          if (mode === 'gallery') {
            const st = row[COL_DRAFTS.STATUS - 1];
            return st === 'submitted' || st === 'completed';
          }
          // 先生モードの場合は下書き以外を表示
          const st = row[COL_DRAFTS.STATUS - 1];
          return st === 'submitted' || st === 'rework' || st === 'completed';
        })
        .map(row => ({
          id: row[COL_DRAFTS.ID - 1],
          title: row[COL_DRAFTS.TITLE - 1],
          class: row[COL_DRAFTS.CLASS - 1],
          name: row[COL_DRAFTS.NAME - 1],
          content: row[COL_DRAFTS.CONTENT - 1],
          status: row[COL_DRAFTS.STATUS - 1] || 'draft',
          illustrations: parseJSON_(row[COL_DRAFTS.ILLUSTRATIONS - 1], []),
          correction: parseJSON_(row[COL_DRAFTS.CORRECTION - 1], []),
          teacherCmt: row[COL_DRAFTS.TEACHER_CMT - 1],
          updatedAtRaw: new Date(row[COL_DRAFTS.UPDATED_AT - 1]),
          comments: [] // 初期化（後で結合）
        }));
    }

    // 2. 交流コメントの取得と結合
    const commentSheet = ss.getSheetByName(SHEET_COMMENTS);
    const cLastRow = commentSheet.getLastRow();
    if (cLastRow >= 2) {
      const cValues = commentSheet.getRange(2, 1, cLastRow - 1, 5).getValues();
      const commentsMap = {};
      
      cValues.forEach(row => {
        const cId = row[COL_COMMENTS.COMMENT_ID - 1];
        const draftId = row[COL_COMMENTS.DRAFT_ID - 1];
        const cName = row[COL_COMMENTS.NAME - 1];
        const cText = row[COL_COMMENTS.TEXT - 1];
        const cCreated = row[COL_COMMENTS.CREATED_AT - 1];
        
        if (!commentsMap[draftId]) commentsMap[draftId] = [];
        commentsMap[draftId].push({
          id: cId,
          name: cName,
          text: cText,
          createdAt: Utilities.formatDate(new Date(cCreated), 'Asia/Tokyo', 'yyyy/MM/dd HH:mm')
        });
      });

      // 作品データにコメントを紐付け
      drafts.forEach(d => {
        if (commentsMap[d.id]) {
          d.comments = commentsMap[d.id];
        }
      });
    }

    // 降順ソート
    drafts.sort((a, b) => b.updatedAtRaw - a.updatedAtRaw);

    const formatted = drafts.map(d => ({
      ...d,
      updatedAt: Utilities.formatDate(d.updatedAtRaw, 'Asia/Tokyo', 'yyyy/MM/dd HH:mm'),
      updatedAtRaw: undefined
    }));

    return { status: 'success', data: formatted };

  } catch (e) {
    return { status: 'error', message: 'リスト取得失敗: ' + e.message };
  }
}

/**
 * 交流コメントを別シートに追加する
 */
function addGalleryComment(draftId, commentData, contextToken) {
  const context = verifyContext_(contextToken);
  const lock = LockService.getScriptLock();
  try { lock.waitLock(5000); } catch (e) { return { status: 'error', message: 'サーバー混雑中' }; }

  try {
    const ss = openTenantSpreadsheet_(context.tenant);
    const draftSheet = ss.getSheetByName(SHEET_DRAFTS);
    const draftRow = findRowById_(draftSheet, draftId);
    if (draftRow < 2) throw new Error('作品が見つかりません。');
    const draftStatus = draftSheet.getRange(draftRow, COL_DRAFTS.STATUS).getValue();
    if (draftStatus !== 'submitted' && draftStatus !== 'completed') throw new Error('公開されていない作品には感想を送れません。');
    const commentSheet = ss.getSheetByName(SHEET_COMMENTS);
    const now = new Date();
    
    const newId = Utilities.getUuid();
    commentSheet.appendRow([
      newId,
      draftId,
      safeCellText_(commentData && commentData.name || '名無し', 80),
      safeCellText_(commentData && commentData.text, 1000),
      now
    ]);
    
    return { 
      status: 'success', 
      message: 'コメントを追加しました', 
      data: {
        id: newId,
        name: safeCellText_(commentData && commentData.name || '名無し', 80),
        text: safeCellText_(commentData && commentData.text, 1000),
        createdAt: Utilities.formatDate(now, 'Asia/Tokyo', 'yyyy/MM/dd HH:mm')
      }
    };
  } catch (e) {
    return { status: 'error', message: 'エラー: ' + e.message };
  } finally {
    lock.releaseLock();
  }
}

// --- ヘルパー関数 ---
function findRowById_(sheet, id) {
  const textFinder = sheet.getRange("A:A").createTextFinder(id);
  const match = textFinder.matchEntireCell(true).findNext();
  return match ? match.getRow() : -1;
}

function parseJSON_(str, defaultVal) {
  if (!str) return defaultVal;
  try { return JSON.parse(str); } catch (e) { return defaultVal; }
}

function safeCellText_(value, maxLength) {
  let text = String(value == null ? '' : value).replace(/\u0000/g, '').slice(0, maxLength);
  if (/^[=+\-@]/.test(text)) text = "'" + text;
  return text;
}

function normalizeDraftInput_(draftData) {
  if (!draftData || typeof draftData !== 'object') throw new Error('作品データが正しくありません。');
  const illustrations = Array.isArray(draftData.illustrations) ? draftData.illustrations : parseJSON_(draftData.illustrations, []);
  const correction = typeof draftData.correction === 'string' ? draftData.correction : JSON.stringify(draftData.correction || []);
  if (illustrations.length > 20) throw new Error('挿絵は20枚までです。');
  if (JSON.stringify(illustrations).length > 200000) throw new Error('挿絵データが大きすぎます。');
  if (correction.length > 45000) throw new Error('添削データが大きすぎます。');
  return {
    id: safeCellText_(draftData.id, 80),
    title: safeCellText_(draftData.title, 200),
    class: safeCellText_(draftData.class, 100),
    name: safeCellText_(draftData.name, 100),
    content: safeCellText_(draftData.content, 50000),
    status: ['draft', 'submitted', 'rework', 'completed'].indexOf(String(draftData.status)) >= 0 ? String(draftData.status) : 'draft',
    illustrations: illustrations,
    correction: correction,
    teacherCmt: draftData.teacherCmt === undefined ? undefined : safeCellText_(draftData.teacherCmt, 5000)
  };
}

function normalizeClassCode_(value) {
  return String(value || '').toUpperCase().replace(/[^2-9A-HJ-NP-Z]/g, '').slice(0, 8);
}

function sanitizeEntryUrl_(value) {
  const url = String(value || '').trim().slice(0, 500).split(/[?#]/)[0];
  if (!/^https:\/\/[a-z0-9.-]+(?::\d{2,5})?(?:\/[a-z0-9._~!$&'()*+,;=:@%\/-]*)?$/i.test(url)) return '';
  return url;
}

function buildStudentEntryUrl_(entryUrl, classCode) {
  const safeEntryUrl = sanitizeEntryUrl_(entryUrl);
  const safeClassCode = normalizeClassCode_(classCode);
  if (!safeEntryUrl || safeClassCode.length !== 8) return '';
  return safeEntryUrl + '?class=' + encodeURIComponent(safeClassCode);
}

function getActiveUser_() {
  const email = String(Session.getActiveUser().getEmail() || '').trim().toLowerCase();
  if (!email || email.indexOf('@') < 1) {
    throw new Error('Googleアカウントを確認できません。Googleにログインし、アクセスを許可してください。');
  }
  return {
    emailHash: hashText_(email),
    domain: email.split('@').pop()
  };
}

function hashText_(value) {
  const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(value), Utilities.Charset.UTF_8);
  return digest.map(function(byte) {
    const normalized = byte < 0 ? byte + 256 : byte;
    return ('0' + normalized.toString(16)).slice(-2);
  }).join('');
}

function createUniqueClassCode_() {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const props = PropertiesService.getScriptProperties();
    for (let attempt = 0; attempt < 20; attempt++) {
      let code = '';
      for (let i = 0; i < 8; i++) {
        code += CLASS_CODE_CHARS.charAt(Math.floor(Math.random() * CLASS_CODE_CHARS.length));
      }
      if (!props.getProperty(TENANT_REGISTRY_PREFIX + code)) {
        props.setProperty(TENANT_REGISTRY_PREFIX + code, JSON.stringify({ pending: true }));
        return code;
      }
    }
    throw new Error('学級コードを発行できませんでした。もう一度お試しください。');
  } finally {
    lock.releaseLock();
  }
}

function getTenantByCode_(classCode) {
  const code = normalizeClassCode_(classCode);
  const raw = PropertiesService.getScriptProperties().getProperty(TENANT_REGISTRY_PREFIX + code);
  if (!raw) throw new Error('学級コードが見つかりません。先生にコードを確認してください。');
  const tenant = parseJSON_(raw, null);
  if (!tenant || tenant.pending || !tenant.spreadsheetId || !tenant.folderId) {
    throw new Error('この学級は準備中です。しばらくしてからもう一度お試しください。');
  }
  return tenant;
}

function assertSameDomain_(actualDomain, expectedDomain) {
  if (!actualDomain || normalizeGoogleDomain_(actualDomain) !== normalizeGoogleDomain_(expectedDomain)) {
    throw new Error('この学級は ' + expectedDomain + ' のGoogleアカウント専用です。正しいアカウントに切り替えてください。');
  }
}

function normalizeGoogleDomain_(domain) {
  const normalized = String(domain || '').trim().toLowerCase();
  return normalized === 'googlemail.com' ? 'gmail.com' : normalized;
}

function isConsumerGoogleDomain_(domain) {
  return normalizeGoogleDomain_(domain) === 'gmail.com';
}

function assertTenantAccessible_(tenant) {
  try {
    openTenantSpreadsheet_(tenant).getId();
    openTenantFolder_(tenant).getId();
  } catch (error) {
    throw new Error('学級データへのアクセス権がありません。先生に共通入口から学級を開き直してもらい、その後もう一度参加してください。');
  }
}

function getContextSecret_() {
  const props = PropertiesService.getScriptProperties();
  let secret = props.getProperty(CONTEXT_SECRET_KEY);
  if (!secret) {
    const lock = LockService.getScriptLock();
    lock.waitLock(10000);
    try {
      secret = props.getProperty(CONTEXT_SECRET_KEY);
      if (!secret) {
        secret = Utilities.getUuid() + Utilities.getUuid();
        props.setProperty(CONTEXT_SECRET_KEY, secret);
      }
    } finally {
      lock.releaseLock();
    }
  }
  return secret;
}

function createContextToken_(tenant, role, userHash) {
  const payload = {
    c: tenant.classCode,
    r: role,
    u: userHash,
    exp: Math.floor(Date.now() / 1000) + CONTEXT_TTL_SECONDS
  };
  const encoded = Utilities.base64EncodeWebSafe(JSON.stringify(payload), Utilities.Charset.UTF_8);
  const signature = Utilities.base64EncodeWebSafe(
    Utilities.computeHmacSha256Signature(encoded, getContextSecret_(), Utilities.Charset.UTF_8)
  );
  return encoded + '.' + signature;
}

function verifyContext_(token, requiredRole) {
  if (!token || typeof token !== 'string') throw new Error('セッション情報がありません。共通入口から入り直してください。');
  const parts = token.split('.');
  if (parts.length !== 2) throw new Error('セッション情報が正しくありません。');
  const expected = Utilities.base64EncodeWebSafe(
    Utilities.computeHmacSha256Signature(parts[0], getContextSecret_(), Utilities.Charset.UTF_8)
  );
  if (expected !== parts[1]) throw new Error('セッション情報を確認できません。');

  let payload;
  try {
    payload = JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(parts[0])).getDataAsString('UTF-8'));
  } catch (error) {
    throw new Error('セッション情報を読み取れません。');
  }
  if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) {
    throw new Error('セッションの有効期限が切れました。共通入口から入り直してください。');
  }

  const user = getActiveUser_();
  if (payload.u !== user.emailHash) throw new Error('ログイン中のアカウントが変わりました。入り直してください。');
  const tenant = getTenantByCode_(payload.c);
  assertSameDomain_(user.domain, tenant.domain);
  if (payload.r === 'teacher' && user.emailHash !== tenant.ownerHash) throw new Error('教師用機能を利用する権限がありません。');
  if (requiredRole === 'teacher' && payload.r !== 'teacher') throw new Error('この操作は先生のみ利用できます。');

  return { tenant: tenant, role: payload.r, userHash: user.emailHash };
}

function safeJson_(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

// --- 設定およびAI機能 ---

/**
 * Gemini APIキーを教師ごとのプロパティに保存する。
 */
function setGeminiApiKey(apiKey, contextToken) {
  verifyContext_(contextToken, 'teacher');
  PropertiesService.getUserProperties().setProperty('GEMINI_API_KEY', apiKey);
  return { status: 'success' };
}

/**
 * Gemini APIを使用して作文をAI添削する（要・教師アカウント）
 */
function analyzeEssayWithGemini(title, className, content, contextToken) {
  verifyContext_(contextToken, 'teacher');
  const props = PropertiesService.getUserProperties();
  const apiKey = props.getProperty('GEMINI_API_KEY');
  
  if (!apiKey) {
    throw new Error('システム設定から Gemini APIキー を設定してください。');
  }

  if (!content || content.trim() === '') {
    throw new Error('本文が入力されていません。');
  }

  // 軽量かつ高速な gemini-2.5-flash モデルを使用
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

  const prompt = `あなたは小学校の先生です。児童の作文を添削してください。
以下の作文を読み、誤字脱字、表現の改善点、良い点などを指摘してください。
小学生に伝わるよう、優しく丁寧な言葉遣い（〜ですね、〜しましょう等）で書いてください。

結果は必ず以下のJSON配列形式で返してください。それ以外のテキストは絶対に含めないでください。

[
  { "quote": "原文の中で指摘したい部分の正確な文字列", "comment": "添削内容やアドバイス" }
]

【児童の作品情報】
題名: ${title || '無題'}
学年・クラス: ${className || '不明'}

【本文】
${content}`;

  const payload = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      responseMimeType: "application/json"
    }
  };

  const options = {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  try {
    const response = UrlFetchApp.fetch(url, options);
    const responseCode = response.getResponseCode();
    const responseText = response.getContentText();

    if (responseCode !== 200) {
      console.error("Gemini API Error:", responseText);
      throw new Error('AIの添削中にエラーが発生しました。');
    }

    const json = JSON.parse(responseText);
    const textResponse = json.candidates[0].content.parts[0].text;
    
    return JSON.parse(textResponse);
  } catch (e) {
    console.error("AI Correction Error:", e);
    throw new Error('AI添削の実行に失敗しました: ' + e.message);
  }
}
