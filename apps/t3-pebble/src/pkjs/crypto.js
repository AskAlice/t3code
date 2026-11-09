var ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

function base64url(bytes) {
  var out = "",
    i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    var n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out +=
      ALPHABET[(n >> 18) & 63] +
      ALPHABET[(n >> 12) & 63] +
      ALPHABET[(n >> 6) & 63] +
      ALPHABET[n & 63];
  }
  if (bytes.length - i === 1) {
    var one = bytes[i] << 16;
    out += ALPHABET[(one >> 18) & 63] + ALPHABET[(one >> 12) & 63];
  } else if (bytes.length - i === 2) {
    var two = (bytes[i] << 16) | (bytes[i + 1] << 8);
    out += ALPHABET[(two >> 18) & 63] + ALPHABET[(two >> 12) & 63] + ALPHABET[(two >> 6) & 63];
  }
  return out;
}

exports.base64url = base64url;

exports.random = function (length) {
  var bytes = new Uint8Array(length);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) crypto.getRandomValues(bytes);
  else
    for (var i = 0; i < length; i++)
      bytes[i] = Math.floor(Math.random() * 256) ^ (Date.now() >>> ((i % 4) * 8));
  return base64url(bytes);
};

exports.challenge = function (verifier, callback) {
  callback(null, base64url(sha256(bytesOf(verifier))));
};

// The phone WebView only exposes crypto.subtle on a secure origin, and T3's daemon serves plain
// HTTP on the tailnet, so PKCE hashes here instead. The verifier is base64url: ASCII only.
function bytesOf(text) {
  var bytes = new Uint8Array(text.length);
  for (var i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i) & 255;
  return bytes;
}

var K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
];

function rotr(value, bits) {
  return (value >>> bits) | (value << (32 - bits));
}

function sha256(bytes) {
  var h = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19
  ];
  var length = bytes.length;
  var total = ((length + 9 + 63) >> 6) << 6;
  var message = new Uint8Array(total);
  message.set(bytes);
  message[length] = 0x80;
  var bits = length * 8;
  message[total - 4] = (bits >>> 24) & 255;
  message[total - 3] = (bits >>> 16) & 255;
  message[total - 2] = (bits >>> 8) & 255;
  message[total - 1] = bits & 255;
  message[total - 8] = Math.floor(bits / 4294967296) & 255;
  var w = new Int32Array(64);
  for (var offset = 0; offset < total; offset += 64) {
    for (var t = 0; t < 16; t++) {
      var at = offset + 4 * t;
      w[t] =
        (message[at] << 24) | (message[at + 1] << 16) | (message[at + 2] << 8) | message[at + 3];
    }
    for (t = 16; t < 64; t++) {
      var s0 = rotr(w[t - 15], 7) ^ rotr(w[t - 15], 18) ^ (w[t - 15] >>> 3);
      var s1 = rotr(w[t - 2], 17) ^ rotr(w[t - 2], 19) ^ (w[t - 2] >>> 10);
      w[t] = (w[t - 16] + s0 + w[t - 7] + s1) | 0;
    }
    var a = h[0],
      b = h[1],
      c = h[2],
      d = h[3],
      e = h[4],
      f = h[5],
      g = h[6],
      k = h[7];
    for (t = 0; t < 64; t++) {
      var sum1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      var choose = (e & f) ^ (~e & g);
      var temp1 = (k + sum1 + choose + K[t] + w[t]) | 0;
      var sum0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      var majority = (a & b) ^ (a & c) ^ (b & c);
      var temp2 = (sum0 + majority) | 0;
      k = g;
      g = f;
      f = e;
      e = (d + temp1) | 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) | 0;
    }
    h[0] = (h[0] + a) | 0;
    h[1] = (h[1] + b) | 0;
    h[2] = (h[2] + c) | 0;
    h[3] = (h[3] + d) | 0;
    h[4] = (h[4] + e) | 0;
    h[5] = (h[5] + f) | 0;
    h[6] = (h[6] + g) | 0;
    h[7] = (h[7] + k) | 0;
  }
  var out = new Uint8Array(32);
  for (var i = 0; i < 8; i++) {
    out[4 * i] = (h[i] >>> 24) & 255;
    out[4 * i + 1] = (h[i] >>> 16) & 255;
    out[4 * i + 2] = (h[i] >>> 8) & 255;
    out[4 * i + 3] = h[i] & 255;
  }
  return out;
}
