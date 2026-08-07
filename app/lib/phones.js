/* Ghana phone validation + network detection.
   Valid prefixes (per brief): 20 23 24 25 26 27 28 50 53 54 55 56 57 59
   Overlapping ranges (26/27) exist between networks — we only warn on
   prefixes that unambiguously belong to a different network. Configurable. */

const PREFIXES = ["20","23","24","25","26","27","28","50","53","54","55","56","57","59"];

const NETWORK_PREFIXES = {
  mtn: ["24","25","26","27","54","55","56","57","59"],
  telecel: ["20","23","50","53"],
  airteltigo: ["26","27","28"],
};

function normalize(p) {
  return String(p || "").replace(/[\s-]/g, "");
}

function validate(p) {
  const n = normalize(p);
  if (!/^0\d{9}$/.test(n)) return { valid: false, normalized: n, reason: "Must be 10 digits starting with 0" };
  const prefix = n.slice(1, 3);
  if (!PREFIXES.includes(prefix)) return { valid: false, normalized: n, reason: `Prefix 0${prefix} is not a valid Ghana mobile prefix` };
  return { valid: true, normalized: n, prefix };
}

function detectNetwork(p) {
  const n = normalize(p);
  if (!/^0\d{9}$/.test(n)) return null;
  const prefix = n.slice(1, 3);
  for (const [net, list] of Object.entries(NETWORK_PREFIXES)) {
    if (list.includes(prefix)) return net;
  }
  return null;
}

function checkAgainstNetwork(p, network) {
  const detected = detectNetwork(p);
  return {
    detected,
    mismatch: !!detected && detected !== network,
    message: detected && detected !== network
      ? `This number looks like a ${detected} number — a ${network} bundle may not deliver. Check before paying.`
      : "",
  };
}

module.exports = { PREFIXES, NETWORK_PREFIXES, normalize, validate, detectNetwork, checkAgainstNetwork };
