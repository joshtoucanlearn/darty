// DARTY log inbox (Joshua's Google account). Receives a playtest log exported from DARTY and saves
// it as a JSON file in the "DARTY logs" folder of Joshua's Drive. Gameplay logs only.
const FOLDER_NAME = 'DARTY logs';
const MAX_BYTES = 8000000;
function folder_() {
  const found = DriveApp.getFoldersByName(FOLDER_NAME);
  return found.hasNext() ? found.next() : DriveApp.createFolder(FOLDER_NAME);
}
function reply_(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}
function doPost(e) {
  try {
    const raw = e && e.postData && e.postData.contents || '';
    if (!raw || raw.length > MAX_BYTES) return reply_({ ok: false });
    const cache = CacheService.getScriptCache();
    const count = Number(cache.get('uploads') || 0);
    if (count >= 60) return reply_({ ok: false });
    cache.put('uploads', String(count + 1), 3600);
    const payload = JSON.parse(raw);
    if (!payload || payload.kind !== 'darty-playtest-log' || !payload.report || typeof payload.report !== 'object') return reply_({ ok: false });
    const id = String(payload.playtestId || 'log').replace(/[^A-Za-z0-9-]/g, '').slice(0, 40) || 'log';
    const stamp = Utilities.formatDate(new Date(), 'Europe/London', 'yyyy-MM-dd HH-mm');
    folder_().createFile(`DARTY log ${stamp} ${id}.json`, JSON.stringify(payload.report, null, 2), MimeType.PLAIN_TEXT);
    return reply_({ ok: true });
  } catch (error) {
    return reply_({ ok: false });
  }
}
function doGet() { return reply_({ ok: true, service: 'darty-log-inbox' }); }
