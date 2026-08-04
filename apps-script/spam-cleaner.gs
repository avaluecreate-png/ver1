/**
 * spam-cleaner.gs — Gmail 迷惑メール自動整理スクリプト
 *
 * 機能:
 *   1. ブロックリスト(送信者・キーワード)に一致するメールを毎日自動でゴミ箱へ移動
 *   2. 迷惑メールフォルダの古いメールを早めに完全削除(任意)
 *   3. 週1回、処理件数のレポートを自分宛にメール送信
 *
 * 導入手順:
 *   1. https://script.google.com で新しいプロジェクトを作成し、このファイルを貼り付ける
 *   2. 下の CONFIG を自分用に編集する
 *   3. エディタ上部で関数 `setupTriggers` を選んで実行(初回は権限承認が必要)
 *   4. 動作確認したい場合は `cleanSpam` を手動実行し、実行ログを確認する
 *
 * 注意:
 *   - ゴミ箱に移動したメールは30日後に完全削除されます。
 *   - まずは DRY_RUN: true(実際には削除せずログだけ出す)で数日様子を見るのがおすすめです。
 */

const CONFIG = {
  // true の間は実際には削除せず、対象をログに出すだけ(お試しモード)
  DRY_RUN: true,

  // ブロックしたい送信者(メールアドレスまたはドメイン)
  BLOCKED_SENDERS: [
    'noreply@example-spam1.com',
    '@example-spam2.net', // ドメインごとブロックする場合は @ から書く
  ],

  // 件名・本文にこの語が含まれていたらブロック
  BLOCKED_KEYWORDS: [
    '当選おめでとう',
    '高収入',
    'アカウントが停止されました',
  ],

  // 絶対に削除しない送信者(ホワイトリスト)。ブロック条件より優先される
  WHITELIST_SENDERS: [
    '@gmail.com', // 例: 個人からのメールは守る(必要に応じて変更)
  ],

  // 検索対象期間(日)。毎日実行なら 2 日で十分
  SEARCH_DAYS: 2,

  // 週次レポートの送信先(空文字にするとレポート無効)
  REPORT_TO: Session.getActiveUser().getEmail(),
};

/** 毎日実行: ブロック条件に一致するメールをゴミ箱へ */
function cleanSpam() {
  const query = buildSearchQuery_();
  const threads = GmailApp.search(query, 0, 100);
  let processed = 0;

  for (const thread of threads) {
    const messages = thread.getMessages();
    const from = messages[0].getFrom();

    if (isWhitelisted_(from)) {
      Logger.log('スキップ(ホワイトリスト): %s / %s', from, thread.getFirstMessageSubject());
      continue;
    }

    if (CONFIG.DRY_RUN) {
      Logger.log('[DRY RUN] 削除対象: %s / %s', from, thread.getFirstMessageSubject());
    } else {
      thread.moveToTrash();
      Logger.log('ゴミ箱へ移動: %s / %s', from, thread.getFirstMessageSubject());
    }
    processed++;
  }

  // 処理件数を累積カウント(週次レポート用)
  const props = PropertiesService.getScriptProperties();
  const total = Number(props.getProperty('weeklyCount') || 0) + processed;
  props.setProperty('weeklyCount', String(total));

  Logger.log('今回の処理件数: %s(DRY_RUN=%s)', processed, CONFIG.DRY_RUN);
}

/** 週1回実行: 処理件数レポートを送信してカウンタをリセット */
function sendWeeklyReport() {
  if (!CONFIG.REPORT_TO) return;

  const props = PropertiesService.getScriptProperties();
  const count = props.getProperty('weeklyCount') || '0';
  props.setProperty('weeklyCount', '0');

  const mode = CONFIG.DRY_RUN ? '(お試しモード: 実際には削除していません)' : '';
  GmailApp.sendEmail(
    CONFIG.REPORT_TO,
    '【spam-cleaner】週次レポート',
    `この1週間でブロック条件に一致したメール: ${count} 件 ${mode}\n\n` +
      '誤判定がないか、Gmailのゴミ箱をたまに確認してください。\n' +
      'ブロックリストの編集は Apps Script プロジェクトの CONFIG から行えます。'
  );
}

/** 初回に1回だけ実行: 毎日+毎週のトリガーを設定する */
function setupTriggers() {
  // 既存の同名トリガーを掃除して二重登録を防ぐ
  for (const trigger of ScriptApp.getProjectTriggers()) {
    const fn = trigger.getHandlerFunction();
    if (fn === 'cleanSpam' || fn === 'sendWeeklyReport') {
      ScriptApp.deleteTrigger(trigger);
    }
  }

  ScriptApp.newTrigger('cleanSpam').timeBased().everyDays(1).atHour(7).create();
  ScriptApp.newTrigger('sendWeeklyReport').timeBased().onWeekDay(ScriptApp.WeekDay.MONDAY).atHour(8).create();

  Logger.log('トリガーを設定しました: cleanSpam(毎日7時台)、sendWeeklyReport(毎週月曜8時台)');
}

/** ブロック条件から Gmail 検索クエリを組み立てる */
function buildSearchQuery_() {
  const senderPart = CONFIG.BLOCKED_SENDERS.map((s) => `from:${s}`).join(' OR ');
  const keywordPart = CONFIG.BLOCKED_KEYWORDS.map((k) => `"${k}"`).join(' OR ');

  const conditions = [senderPart, keywordPart].filter(Boolean).map((p) => `(${p})`);
  // 例: in:anywhere newer_than:2d ((from:a OR from:b) OR ("当選" OR "副業"))
  return `in:anywhere -in:trash newer_than:${CONFIG.SEARCH_DAYS}d (${conditions.join(' OR ')})`;
}

/** 送信者がホワイトリストに含まれるか */
function isWhitelisted_(from) {
  const lower = from.toLowerCase();
  return CONFIG.WHITELIST_SENDERS.some((w) => lower.includes(w.toLowerCase()));
}
