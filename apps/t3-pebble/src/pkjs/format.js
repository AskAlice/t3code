var NORMAL = "\x01",
  BOLD = "\x02",
  CODE = "\x03",
  KEYWORD = "\x04",
  STRING = "\x05",
  NUMBER = "\x06",
  COMMENT = "\x07";
var keywords =
  /^(?:if|then|else|fi|for|in|do|done|while|case|esac|function|return|export|const|let|var|function|class|import|from|return|async|await|true|false|null|undefined|def|import|print|sudo|cd|git|bun|npm|node|echo|cat|mkdir|grep|rg|ls|curl)$/;
var MAX_BYTES = 900;

function truncate(text, maxBytes) {
  text = String(text == null ? "" : text);
  var bytes = 0,
    out = "";
  for (var i = 0; i < text.length;) {
    var code = text.charCodeAt(i),
      width = 1;
    if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) {
      var low = text.charCodeAt(i + 1);
      if (low >= 0xdc00 && low <= 0xdfff) {
        code = (code - 0xd800) * 0x400 + low - 0xdc00 + 0x10000;
        width = 2;
      }
    }
    var size = code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
    if (bytes + size > maxBytes) break;
    bytes += size;
    out += text.slice(i, i + width);
    i += width;
  }
  return out;
}

// The watcher caps messages in bytes, so the style reset must fit inside the budget too.
function cap(text) {
  var cut = truncate(text, MAX_BYTES);
  return cut === text ? cut : truncate(cut, MAX_BYTES - 1) + NORMAL;
}
function code(text) {
  return (
    CODE +
    text.replace(
      /(#[^\n]*|'[^'\n]*'|"(?:\\.|[^"\\])*"|\b\d+(?:\.\d+)?\b|\b[a-zA-Z_][\w-]*\b)/g,
      function (token) {
        var style =
          token[0] === "#"
            ? COMMENT
            : token[0] === "'" || token[0] === '"'
              ? STRING
              : /^\d/.test(token)
                ? NUMBER
                : keywords.test(token)
                  ? KEYWORD
                  : CODE;
        return style + token + CODE;
      }
    ) +
    NORMAL
  );
}
function inline(text) {
  return text.replace(
    /`([^`\n]+)`|\*\*([^*\n]+)\*\*|__([^_\n]+)__|\[([^\]]+)\]\([^)]+\)/g,
    function (_, codeText, bold, boldAlt, link) {
      return codeText ? code(codeText) : BOLD + (bold || boldAlt || link) + NORMAL;
    }
  );
}
function format(text, type) {
  text = String(text || "")
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/\r\n/g, "\n")
    .replace(/[^\n\r]*\r/g, "")
    .replace(/[\x01-\x07]/g, "");
  if (type === "command_execution") {
    text = text
      .split("\n")
      .filter(function (line) {
        return !/^\s*(?:N\/A|\d+(?:\.\d+)?)%\s*\[/.test(line);
      })
      .join("\n");
    return cap(code(text.slice(0, 900)));
  }
  text = text.slice(0, 900);
  var inCode = false;
  var lines = text.split("\n").map(function (line) {
    if (/^\s*```/.test(line)) {
      inCode = !inCode;
      return "";
    }
    if (inCode) return code(line);
    var heading = line.match(/^\s*#{1,6}\s+(.+)$/);
    if (heading) return BOLD + inline(heading[1]) + NORMAL;
    return inline(line.replace(/^\s*[-*]\s+/, "• "));
  });
  return cap(lines.join("\n"));
}
module.exports = format;
module.exports.truncate = truncate;
module.exports.cap = cap;
