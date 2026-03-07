/**
 * オンライン出版社 Pro - GIGA Edition
 * サーバーサイドスクリプト (コード.gs)
 *
 * 【管理者向け設定方法】
 * 教師パスワードはスクリプトプロパティで管理します。
 * 初回は自動で 'admin' が設定されます。変更する場合:
 * GASエディタ → プロジェクト設定 → スクリプトプロパティ
 * → TEACHER_PASSWORD の値を書き換えてください。
 */

const SHEET_DRAFTS = '作文データ';
const SHEET_COMMENTS = '交流コメントデータ';
const DEFAULT_PASSWORD = 'admin';

// カラム定義: 作文データシート
const COL_DRAFTS = {
  ID: 1, TITLE: 2, CLASS: 3, NAME: 4, CONTENT: 5,
  STATUS: 6, ILLUSTRATIONS: 7, CORRECTION: 8, TEACHER_CMT: 9,
  CREATED_AT: 10, UPDATED_AT: 11, DELETED_AT: 12
};

// カラム定義: 交流コメントシート
const COL_COMMENTS = {
  COMMENT_ID: 1, DRAFT_ID: 2, NAME: 3, TEXT: 4, CREATED_AT: 5
};

/**
 * 教師パスワードを取得
 */
function getTeacherPassword_() {
  const props = PropertiesService.getScriptProperties();
  let pw = props.getProperty('TEACHER_PASSWORD');
  if (!pw) {
    props.setProperty('TEACHER_PASSWORD', DEFAULT_PASSWORD);
    pw = DEFAULT_PASSWORD;
  }
  return pw;
}

/**
 * Webアプリのエントリーポイント
 */
function doGet() {
  initDatabase(); // フォルダ・DB初期化チェック
  
  return HtmlService.createTemplateFromFile('index')
      .evaluate()
      .setTitle('オンライン出版社 Pro')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1.0')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
      .setFaviconUrl('https://drive.google.com/uc?id=1A5yDOUvaYCU6qMJM_ZuKye7ClqQQHzYT&.png');
}

/**
 * データベース・画像フォルダの初期化・自己修復
 */
function initDatabase() {
  const props = PropertiesService.getScriptProperties();
  
  // 1. 挿絵保存用フォルダの自己修復
  let folderId = props.getProperty('IMAGE_FOLDER_ID');
  let folder;
  if (folderId) {
    try { folder = DriveApp.getFolderById(folderId); } catch(e) { folderId = null; }
  }
  if (!folderId) {
    folder = DriveApp.createFolder('オンライン出版社Pro_画像データ');
    // アプリ上のimgタグで読み込めるように「リンクを知っている全員が閲覧可」に設定
    folder.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    props.setProperty('IMAGE_FOLDER_ID', folder.getId());
  }

  // 2. スプレッドシートの自己修復
  let ssId = props.getProperty('SPREADSHEET_ID');
  let ss;
  if (ssId) {
    try { ss = SpreadsheetApp.openById(ssId); } catch(e) { ssId = null; }
  }
  if (!ssId) {
    ss = SpreadsheetApp.create('オンライン出版社Pro_データベース');
    props.setProperty('SPREADSHEET_ID', ss.getId());
  }

  // 3. 作文データシートの自己修復
  let draftSheet = ss.getSheetByName(SHEET_DRAFTS);
  if (!draftSheet) {
    draftSheet = ss.insertSheet(SHEET_DRAFTS);
    const headers = ['作品ID', '題名', '学年・クラス', '氏名', '本文', 'ステータス', '挿絵データ', '添削データ', '先生コメント', '作成日時', '更新日時', '削除日時'];
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

  // 4. 交流コメントシートの自己修復
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

  return { ssId: ss.getId(), folderId: folder.getId() };
}


// --- API Methods (フロントエンドから呼び出される関数) ---

/**
 * 挿絵画像をDriveに保存し、公開URLを返す
 * @param {string} base64Data - 画像のBase64文字列
 * @param {string} filename - 保存するファイル名
 */
function uploadIllustration(base64Data, filename) {
  try {
    const props = PropertiesService.getScriptProperties();
    const folderId = props.getProperty('IMAGE_FOLDER_ID');
    if (!folderId) throw new Error('画像保存フォルダが存在しません。');

    const folder = DriveApp.getFolderById(folderId);
    
    // Base64データからBlobを生成
    const split = base64Data.split(',');
    const type = split[0].split(';')[0].replace('data:', '');
    const bytes = Utilities.base64Decode(split[1]);
    
    const safeFilename = filename || ('img_' + new Date().getTime() + '.jpg');
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
function saveOrSubmitDraft(draftData, isSubmit = false) {
  const lock = LockService.getScriptLock();
  try { lock.waitLock(10000); } catch (e) { return { status: 'error', message: 'サーバー混雑中' }; }

  try {
    const props = PropertiesService.getScriptProperties();
    const ss = SpreadsheetApp.openById(props.getProperty('SPREADSHEET_ID'));
    const sheet = ss.getSheetByName(SHEET_DRAFTS);
    const now = new Date();
    
    let status = draftData.status || 'draft';
    if (isSubmit && status === 'draft') status = 'submitted';

    // JSON変換 (スプレッドシートのセルに保存するため)
    const illustStr = typeof draftData.illustrations === 'string' ? draftData.illustrations : JSON.stringify(draftData.illustrations || []);
    const correctionStr = typeof draftData.correction === 'string' ? draftData.correction : JSON.stringify(draftData.correction || []);

    if (draftData.id) {
      const foundRow = findRowById_(sheet, draftData.id);
      if (foundRow > 0) {
        const rowData = sheet.getRange(foundRow, 1, 1, 12).getValues()[0];
        if (rowData[COL_DRAFTS.DELETED_AT - 1]) return { status: 'error', message: '削除されています' };

        sheet.getRange(foundRow, COL_DRAFTS.TITLE).setValue(draftData.title);
        sheet.getRange(foundRow, COL_DRAFTS.CLASS).setValue(draftData.class);
        sheet.getRange(foundRow, COL_DRAFTS.NAME).setValue(draftData.name);
        sheet.getRange(foundRow, COL_DRAFTS.CONTENT).setValue(draftData.content);
        sheet.getRange(foundRow, COL_DRAFTS.STATUS).setValue(status);
        sheet.getRange(foundRow, COL_DRAFTS.ILLUSTRATIONS).setValue(illustStr);
        sheet.getRange(foundRow, COL_DRAFTS.CORRECTION).setValue(correctionStr);
        sheet.getRange(foundRow, COL_DRAFTS.UPDATED_AT).setValue(now);

        if (draftData.teacherCmt !== undefined) sheet.getRange(foundRow, COL_DRAFTS.TEACHER_CMT).setValue(draftData.teacherCmt);

        return { status: 'success', message: isSubmit ? '提出しました！' : '保存しました。', id: draftData.id, docStatus: status };
      }
    }
    
    // 新規作成
    const newId = Utilities.getUuid();
    sheet.appendRow([
      newId, draftData.title, draftData.class, draftData.name, draftData.content,
      status, illustStr, correctionStr, '', now, now, ''
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
function getDraftList(mode = 'student', password = '', criteria = null) {
  try {
    if (mode === 'teacher' && password !== getTeacherPassword_()) return { status: 'error', message: 'パスワードが違います。' };

    const props = PropertiesService.getScriptProperties();
    const ss = SpreadsheetApp.openById(props.getProperty('SPREADSHEET_ID'));
    
    // 1. 作文データの取得
    const draftSheet = ss.getSheetByName(SHEET_DRAFTS);
    const dLastRow = draftSheet.getLastRow();
    let drafts = [];
    if (dLastRow >= 2) {
      const dValues = draftSheet.getRange(2, 1, dLastRow - 1, 12).getValues();
      drafts = dValues
        .filter(row => row[COL_DRAFTS.DELETED_AT - 1] === '')
        .filter(row => {
          if (mode === 'student' || mode === 'gallery') return true;
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
function addGalleryComment(draftId, commentData) {
  const lock = LockService.getScriptLock();
  try { lock.waitLock(5000); } catch (e) { return { status: 'error', message: 'サーバー混雑中' }; }

  try {
    const props = PropertiesService.getScriptProperties();
    const ss = SpreadsheetApp.openById(props.getProperty('SPREADSHEET_ID'));
    const commentSheet = ss.getSheetByName(SHEET_COMMENTS);
    const now = new Date();
    
    const newId = Utilities.getUuid();
    commentSheet.appendRow([
      newId,
      draftId,
      commentData.name || '名無し',
      commentData.text,
      now
    ]);
    
    return { 
      status: 'success', 
      message: 'コメントを追加しました', 
      data: {
        id: newId,
        name: commentData.name || '名無し',
        text: commentData.text,
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

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

// --- 設定およびAI機能 ---

/**
 * Gemini APIキーをプロパティに保存
 */
function setGeminiApiKey(apiKey) {
  PropertiesService.getScriptProperties().setProperty('GEMINI_API_KEY', apiKey);
}

/**
 * 教師用パスワードの更新
 */
function updateTeacherPassword(password) {
  PropertiesService.getScriptProperties().setProperty('TEACHER_PASSWORD', password);
}

/**
 * Gemini APIを使用して作文をAI添削する
 */
function analyzeEssayWithGemini(title, className, content) {
  const props = PropertiesService.getScriptProperties();
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
