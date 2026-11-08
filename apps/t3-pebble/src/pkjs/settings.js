var storage = require("./storage.js");
var ACCESS = ["read-only", "auto", "full-access"];

function esc(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// The phone app hosts no settings server; this page travels inside the app as a data: URL.
function settingsUrl() {
  var html =
    '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<meta name="color-scheme" content="dark"><title>T3 Code settings</title><style>' +
    "*{box-sizing:border-box}body{margin:0;background:#171717;color:#f4f4f5;font:16px system-ui,sans-serif}" +
    "main{max-width:560px;margin:auto;padding:24px 20px 48px}h1{font-size:25px;margin:0 0 8px}" +
    "p{color:#b9b9bf;line-height:1.45;margin:0 0 18px}section{background:#242426;border:1px solid #404044;" +
    "border-radius:14px;padding:18px;margin:16px 0}h2{font-size:18px;margin:0 0 8px}label{display:block;font-weight:600;" +
    "margin:18px 0 8px}input,select{width:100%;min-height:48px;padding:12px;border:1px solid #777780;border-radius:8px;" +
    "background:#151517;color:#fff;font:inherit}input:focus,select:focus{outline:2px solid #ff806b;outline-offset:2px}" +
    "label.check{display:flex;gap:10px;align-items:center;font-weight:500;margin-top:14px}" +
    "input[type=checkbox]{width:22px;min-height:22px;flex:none;margin:0}" +
    "button{min-height:44px;border:0;border-radius:8px;background:#ef5a47;color:white;font:600 16px system-ui;" +
    "padding:10px 18px;margin-top:12px;width:100%}small{display:block;color:#b9b9bf;line-height:1.4;margin-top:8px}" +
    "</style></head><body><main><h1>T3 Code</h1><p>Connect your watch and choose a voice.</p>" +
    '<form id="settings"><section><h2>Connect to T3 Code</h2>' +
    "<p>Create a pairing link in T3 Code under Settings &rarr; Sharing &amp; access, then paste the full URL.</p>" +
    '<label for="url">Pairing URL</label><input id="url" type="text" autocomplete="off" autocapitalize="none" ' +
    'placeholder="https://...">' +
    "<small>" +
    (storage.origin()
      ? "Connected to " + esc(storage.origin()) + ". Leave blank to keep it."
      : "No server paired yet.") +
    "</small>" +
    '<label for="access">Watch access</label><select id="access">' +
    '<option value="read-only">Read-only</option>' +
    '<option value="auto" selected>Operator</option>' +
    '<option value="full-access">Full access</option></select>' +
    "<small>Used for the next pairing. Operator can read and message threads.</small>" +
    '<label class="check"><input id="unpair" type="checkbox">Unpair this watch</label>' +
    "</section>" +
    "<section><h2>Spoken responses</h2><p>Use ElevenLabs to read new replies aloud on your watch.</p>" +
    '<label for="key">ElevenLabs API key</label><input id="key" type="password" autocomplete="off" autocapitalize="none">' +
    "<small>" +
    (storage.elevenKey()
      ? "A key is already saved. Leave blank to keep it."
      : "Optional. Stored on this phone only.") +
    "</small>" +
    '<label class="check"><input id="clearKey" type="checkbox">Remove saved key</label>' +
    "</section><button>Save</button></form></main><script>" +
    'document.getElementById("settings").onsubmit=function(event){event.preventDefault();' +
    'location.href="pebblejs://close#"+encodeURIComponent(JSON.stringify({' +
    'url:document.getElementById("url").value.trim(),key:document.getElementById("key").value.trim(),' +
    'access:document.getElementById("access").value,' +
    'clearKey:document.getElementById("clearKey").checked,' +
    'unpair:document.getElementById("unpair").checked}))};' +
    "</script></body></html>";
  return "data:text/html;charset=utf-8," + encodeURIComponent(html);
}

function parseSettings(response) {
  if (!response) return null;
  try {
    var body = JSON.parse(decodeURIComponent(response));
    return {
      url: typeof body.url === "string" ? body.url.trim() : "",
      key: typeof body.key === "string" ? body.key.trim() : "",
      access: ACCESS.indexOf(body.access) >= 0 ? body.access : "auto",
      clearKey: body.clearKey === true,
      unpair: body.unpair === true
    };
  } catch (_error) {
    return null;
  }
}

module.exports = settingsUrl;
module.exports.parse = parseSettings;
