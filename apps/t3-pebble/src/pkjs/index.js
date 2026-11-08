var keys = require("message_keys");
var format = require("./format.js");
var summary = require("./summary.js");
var groups = require("./groups.js");
var storage = require("./storage.js");
var mcp = require("./mcp.js");
var eleven = require("./eleven.js");
var settings = require("./settings.js");
var pairing = require("./pairing.js");
var page = 0,
  pages = [0],
  nextPage = null;
var queue = [],
  busy = false,
  focused = null,
  timer = null,
  lastItem = null,
  audio = null,
  audioOffset = 0,
  blockEnd = 0,
  blockStart = 0,
  retries = 0,
  readGeneration = 0,
  reading = false,
  speechGeneration = 0,
  listGeneration = 0,
  lastTimeline = "";
var TRANSFER = ["audio", "audio_start", "audio_play"];
var namespaces = {};
function send(payload) {
  queue.push(payload);
  flush();
}
function abortAudio() {
  audio = null;
  retries = 0;
  queue = queue.filter(function (packet) {
    return TRANSFER.indexOf(packet.action) < 0;
  });
}
function flush() {
  if (busy || !queue.length) return;
  busy = true;
  var packet = queue[0],
    attempts = 0;
  function deliver() {
    Pebble.sendAppMessage(
      packet,
      function () {
        queue.shift();
        busy = false;
        flush();
      },
      function () {
        if (attempts++ < 2) return deliver();
        queue.shift();
        if (TRANSFER.indexOf(packet.action) >= 0) abortAudio();
        busy = false;
        flush();
      }
    );
  }
  deliver();
}
// Server text is short and stripped of URLs and token-shaped runs before it reaches the watch.
function reason(error) {
  var text = String((error && error.message) || "")
    .replace(/[?#]\S*/g, "")
    .replace(/\b[A-Za-z0-9_-]{24,}\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return text ? ": " + format.truncate(text, 80) : "";
}
function connect() {
  listGeneration++;
  mcp.configure({ origin: storage.origin(), token: storage.token() });
}
function notify(title, body) {
  try {
    Pebble.showSimpleNotificationOnPebble(title, body);
  } catch (_error) {}
}
function age(updatedAt) {
  var seconds = Math.max(0, Math.floor((Date.now() - Date.parse(updatedAt)) / 1000));
  if (!isFinite(seconds)) return "";
  if (seconds < 60) return "now";
  if (seconds < 3600) return Math.floor(seconds / 60) + "m";
  if (seconds < 86400) return Math.floor(seconds / 3600) + "h";
  if (seconds < 604800) return Math.floor(seconds / 86400) + "d";
  return Math.floor(seconds / 604800) + "w";
}
function list() {
  var generation = ++listGeneration;
  if (!storage.token()) {
    send({ action: "clear" });
    send({ action: "thread", thread: "", title: "Pair in phone settings" });
    send({ action: "list" });
    return;
  }
  mcp.threads(pages[page], function (err, result) {
    if (generation !== listGeneration || focused) return;
    send({ action: "clear" });
    if (err) send({ action: "thread", thread: "", title: "Connection failed" + reason(err) });
    else {
      if (page) send({ action: "thread", thread: "__previous", title: "Previous page" });
      groups(result.threads).forEach(function (group) {
        send({ action: "section", title: group.title });
        group.threads.forEach(function (t) {
          var path = (t.directory || "").replace(/\/$/, "").split("/").pop();
          namespaces[t.threadId] = [path, t.providerInstanceId || "", t.machine || ""]
            .join("/")
            .slice(0, 100);
          send({
            action: "thread",
            thread: t.threadId,
            title: t.title.slice(0, 24),
            machine: (t.machine || "").slice(0, 14),
            directory: (path || "").slice(0, 16),
            harness: (t.providerInstanceId || "").slice(0, 16),
            age: age(t.updatedAt)
          });
        });
      });
      nextPage = result.nextCursor;
      if (nextPage != null) send({ action: "thread", thread: "__next", title: "Next page" });
    }
    send({ action: "list" });
  });
}
function mulaw(sample) {
  var sign = sample < 0 ? 128 : 0;
  sample = Math.min(Math.abs(sample), 32635) + 132;
  var exponent = 7;
  for (var mask = 0x4000; exponent > 0 && !(sample & mask); mask >>= 1) exponent--;
  return ~(sign | (exponent << 4) | ((sample >> (exponent + 3)) & 15)) & 255;
}
function speak(text, thread) {
  var generation = ++speechGeneration;
  audio = null;
  retries = 0;
  eleven.speak(text.slice(0, 4000), function (err, data) {
    if (generation !== speechGeneration || err || focused !== thread || !data) return;
    var pcm = new DataView(data);
    audio = new Uint8Array(Math.floor(pcm.byteLength / 2));
    for (var i = 0; i < audio.length; i++) audio[i] = mulaw(pcm.getInt16(i * 2, true));
    audioOffset = 0;
    retries = 0;
    startBlock();
  });
}
function startBlock() {
  if (!audio || !focused) return;
  blockStart = audioOffset;
  blockEnd = Math.min(blockStart + 60000, audio.length);
  var checksum = 2166136261;
  for (var i = blockStart; i < blockEnd; i++)
    checksum = Math.imul(checksum ^ audio[i], 16777619) >>> 0;
  send({ action: "audio_start", size: blockEnd - blockStart, checksum: checksum });
  nextAudio();
}
function nextAudio() {
  if (!audio || !focused) return;
  if (audioOffset >= blockEnd) {
    send({ action: "audio_play" });
    return;
  }
  var end = Math.min(audioOffset + 900, blockEnd);
  var packet = { action: "audio" };
  packet[keys.bytes] = Array.prototype.slice.call(audio, audioOffset, end);
  send(packet);
  audioOffset = end;
}
function read(thread, baseline) {
  if (reading) return;
  reading = true;
  var generation = readGeneration;
  mcp.read(thread, function (err, result) {
    if (generation !== readGeneration || focused !== thread) return;
    reading = false;
    if (err) {
      send({
        action: "detail",
        thread: thread,
        message: "Connection failed" + reason(err)
      });
      return;
    }
    var messages = result.items.filter(function (item) {
      return item.type === "assistant_message" || item.type === "user_message";
    });
    var last = messages[messages.length - 1];
    var entries = summary
      .group(
        result.items.filter(function (item) {
          return (
            [
              "user_message",
              "assistant_message",
              "reasoning",
              "command_execution",
              "file_change",
              "file_read",
              "file_search",
              "web_search",
              "dynamic_tool"
            ].indexOf(item.type) >= 0
          );
        }),
        format,
        namespaces[thread] || ""
      )
      .slice(-8)
      .map(function (item) {
        var grouped = item.type === "work_group";
        return {
          type: item.type,
          text: grouped ? item.text : format(item.text || item.title || "", item.type),
          item: format.truncate(grouped ? item.item : item.itemId || "", 150),
          summary: format.truncate(grouped ? item.summary : summary(item), 150),
          status: item.status || ""
        };
      });
    if (
      result.thread &&
      ["running", "starting", "preparing"].indexOf(result.thread.status) >= 0 &&
      (!entries.length || entries[entries.length - 1].type === "user_message")
    )
      entries.push({
        type: "reasoning",
        text: "Thinking",
        item: "",
        summary: "Thinking",
        status: "running"
      });
    var timeline = JSON.stringify(entries);
    if (timeline !== lastTimeline) {
      lastTimeline = timeline;
      send({ action: "chat_clear", thread: thread });
      entries.forEach(function (entry) {
        send({
          action: "chat_item",
          thread: thread,
          title: entry.type,
          message: entry.text,
          item: entry.item,
          summary: entry.summary,
          status: entry.status
        });
      });
      send({ action: "chat_show", thread: thread });
    }
    if (last && last.type === "assistant_message" && last.status === "completed") {
      if (!baseline && lastItem !== last.itemId && last.text) speak(last.text, thread);
      lastItem = last.itemId;
    } else if (baseline) lastItem = "";
  });
}
Pebble.addEventListener("ready", function () {
  connect();
  list();
});
Pebble.addEventListener("appmessage", function (event) {
  var data = event.payload;
  if (data.action === "list") list();
  if (data.action === "next" && nextPage != null) {
    pages[++page] = nextPage;
    list();
  }
  if (data.action === "previous" && page) {
    page--;
    list();
  }
  if (data.action === "read" && data.thread) {
    focused = data.thread;
    lastItem = null;
    lastTimeline = "";
    audio = null;
    speechGeneration++;
    readGeneration++;
    reading = false;
    if (timer) clearInterval(timer);
    read(focused, true);
    timer = setInterval(function () {
      if (focused) read(focused, false);
    }, 5000);
  }
  if (data.action === "close") {
    focused = null;
    audio = null;
    speechGeneration++;
    readGeneration++;
    reading = false;
    if (timer) clearInterval(timer);
    timer = null;
    list();
  }
  if (data.action === "audio_ack") nextAudio();
  if (data.action === "audio_done" && audio) {
    if (audioOffset < audio.length) {
      retries = 0;
      startBlock();
    } else audio = null;
  }
  if (data.action === "audio_retry" && audio && retries++ < 2) {
    audioOffset = blockStart;
    startBlock();
  }
  if (data.action === "send" && data.thread && data.message) {
    mcp.send(data.thread, data.message, function (err) {
      if (err && focused === data.thread)
        send({
          action: "detail",
          thread: data.thread,
          message: "Could not send message" + reason(err)
        });
      else if (focused === data.thread) read(focused, false);
    });
  }
});

Pebble.addEventListener("showConfiguration", function () {
  Pebble.openURL(settings());
});
Pebble.addEventListener("webviewclosed", function (event) {
  var result = settings.parse(event.response);
  if (!result) return;
  if (result.clearKey) storage.saveElevenKey("");
  if (result.key) storage.saveElevenKey(result.key);
  if (result.unpair) {
    focused = null;
    audio = null;
    speechGeneration++;
    readGeneration++;
    reading = false;
    if (timer) clearInterval(timer);
    timer = null;
    storage.savePairing("", "");
    connect();
    list();
    return;
  }
  if (!result.url) return;
  var parsed = pairing.parse(result.url);
  if (!parsed) {
    notify("Pairing failed", "Paste the full pairing URL.");
    return;
  }
  pairing.pair(parsed.origin, parsed.code, result.access, function (err, token) {
    if (err) {
      notify("Pairing failed", "Check the URL and its permissions.");
      return;
    }
    storage.savePairing(parsed.origin, token);
    connect();
    notify("Paired", "T3 Code is connected.");
    list();
  });
});
