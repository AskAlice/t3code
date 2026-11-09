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
      .map(function (item) {
        var grouped = item.type === "work_group";
        return {
          type: item.type,
          text: grouped ? item.text : format(item.text || item.title || "", item.type),
          item: format.truncate(grouped ? item.item : item.itemId || "", 150),
          summary: format.truncate(grouped ? item.summary : summary(item), 150),
          status: item.status || ""
        };
      })
      // Empty placeholders and empty work groups would render as bare "Agent" bubbles.
      .filter(function (entry) {
        return entry.text;
      })
      .slice(-8);
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
var wizard = null,
  wizardGeneration = 0;
function wizardGuard(state) {
  return wizard === state && state.generation === wizardGeneration;
}
function wizardError(state, error) {
  if (!wizardGuard(state)) return;
  send({ action: "wizard_error", title: format.truncate("New thread failed" + reason(error), 60) });
}
function wizardTarget(state, args) {
  if (state.environmentId && state.environmentId !== state.currentEnvironmentId)
    args.environmentId = state.environmentId;
  return args;
}
function wizardShow(state, step, header, rows) {
  if (!wizardGuard(state)) return;
  state.step = step;
  send({ action: "wizard_step", thread: step, title: header });
  rows.forEach(function (row) {
    send({
      action: "wizard_row",
      title: format.truncate(row.title, 40),
      item: row.item,
      harness: row.harness || ""
    });
  });
  send({ action: "wizard_show" });
}
function wizardMachines(state) {
  mcp.call("t3_environment_read", {}, function (error, current) {
    if (!wizardGuard(state)) return;
    if (error) return wizardError(state, error);
    state.currentEnvironmentId = current.environmentId || "";
    var rows = [{ title: current.label || "This machine", item: state.currentEnvironmentId }];
    mcp.call("t3_environment_links", {}, function (error, linked) {
      if (!wizardGuard(state)) return;
      if (!error)
        (linked.links || []).forEach(function (link) {
          if (link.status === "reachable" && link.environmentId !== state.currentEnvironmentId)
            rows.push({ title: link.label || link.environmentId, item: link.environmentId });
        });
      wizardShow(state, "machine", "Machine", rows);
    });
  });
}
function wizardProjects(state) {
  var rows = [{ title: "No directory", item: "__scratch__" }];
  function page(cursor) {
    mcp.call(
      "t3_project_list",
      wizardTarget(state, { cursor: cursor, limit: 100 }),
      function (error, result) {
        if (!wizardGuard(state)) return;
        if (error) return wizardError(state, error);
        var projects = result.projects || [];
        for (var i = 0; i < projects.length && rows.length < 21; i++)
          rows.push({
            title:
              (projects[i].workspaceRoot || "").replace(/\/$/, "").split("/").pop() ||
              projects[i].title ||
              projects[i].id,
            item: projects[i].id
          });
        if (result.nextCursor != null && rows.length < 21) return page(result.nextCursor);
        wizardShow(state, "dir", "Project", rows);
      }
    );
  }
  page(0);
}
function wizardProvider(state) {
  var providers = (state.capabilities && state.capabilities.providers) || [];
  for (var i = 0; i < providers.length; i++)
    if (providers[i].providerInstanceId === state.providerInstanceId) return providers[i];
  return null;
}
function wizardProviders(state) {
  mcp.call("orchestrator_capabilities", wizardTarget(state, {}), function (error, result) {
    if (!wizardGuard(state)) return;
    if (error) return wizardError(state, error);
    state.capabilities = result || {};
    var providers = result.providers || [];
    var rows = providers.map(function (provider) {
      return {
        title: provider.displayName || provider.driverKind,
        item: provider.providerInstanceId,
        harness: provider.driverKind
      };
    });
    wizardShow(state, "provider", "Provider", rows);
  });
}
function wizardModels(state) {
  var provider = wizardProvider(state),
    models = (provider && provider.models) || [],
    rows = [];
  for (var i = 0; i < models.length && i < 20; i++)
    rows.push({ title: models[i].label || models[i].id, item: models[i].id });
  wizardShow(state, "model", "Model", rows);
}
function wizardEffortOption(state) {
  var provider = wizardProvider(state),
    models = (provider && provider.models) || [];
  for (var i = 0; i < models.length; i++) {
    if (models[i].id !== state.model) continue;
    var options = models[i].options || [];
    for (var j = 0; j < options.length; j++) if (/effort/i.test(options[j].id)) return options[j];
  }
  return null;
}
function wizardEfforts(state) {
  var option = wizardEffortOption(state);
  if (!option) return wizardLaunch(state);
  state.effortOptionId = option.id;
  var rows = (option.values || []).map(function (value) {
    return { title: String(value), item: String(value) };
  });
  wizardShow(state, "effort", "Effort", rows);
}
function wizardLaunch(state) {
  if (!wizardGuard(state) || state.launching) return;
  state.launching = true;
  var selection = { instanceId: state.providerInstanceId, model: state.model };
  if (state.effortOptionId) selection.options = [{ id: state.effortOptionId, value: state.effort }];
  var args = wizardTarget(state, {
    title: "New thread",
    modelSelection: selection,
    // A retried pick must not create a second thread.
    clientRequestId: "pebble-wizard-" + state.generation
  });
  if (state.dir === "__scratch__") args.scratch = true;
  else args.projectId = state.dir;
  mcp.call("t3_thread_launch", args, function (error, result) {
    if (!wizardGuard(state)) return;
    if (error) {
      state.launching = false;
      return wizardError(state, error);
    }
    wizard = null;
    wizardGeneration++;
    send({ action: "open_thread", thread: result.threadId, title: "New thread" });
    list();
  });
}
function wizardStart() {
  wizardGeneration++;
  wizard = {
    generation: wizardGeneration,
    step: "",
    currentEnvironmentId: "",
    environmentId: "",
    dir: "",
    providerInstanceId: "",
    driverKind: "",
    model: "",
    effortOptionId: "",
    effort: "",
    launching: false,
    capabilities: null
  };
  wizardMachines(wizard);
}
function wizardPick(step, item) {
  var state = wizard;
  if (!state || state.step !== step) return;
  if (step === "machine") {
    state.environmentId = item;
    wizardProjects(state);
  } else if (step === "dir") {
    state.dir = item;
    wizardProviders(state);
  } else if (step === "provider") {
    var provider = null,
      original = state.providerInstanceId;
    state.providerInstanceId = item;
    provider = wizardProvider(state);
    state.driverKind = (provider && provider.driverKind) || "";
    if (!provider) state.providerInstanceId = original;
    wizardModels(state);
  } else if (step === "model") {
    state.model = item;
    wizardEfforts(state);
  } else if (step === "effort") {
    state.effort = item;
    wizardLaunch(state);
  }
}

Pebble.addEventListener("ready", function () {
  connect();
  list();
});
Pebble.addEventListener("appmessage", function (event) {
  var data = event.payload;
  if (data.action === "new") wizardStart();
  if (data.action === "wizard_pick") wizardPick(data.thread, data.item);
  if (data.action === "close_wizard") {
    wizardGeneration++;
    wizard = null;
  }
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
