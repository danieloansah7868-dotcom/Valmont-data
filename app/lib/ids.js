/* Order references + idempotent keys */

function genReference(date = new Date()) {
  const yymmdd = date.toISOString().slice(2, 10).replace(/-/g, "");
  return `VD-${yymmdd}-${Math.floor(1000 + Math.random() * 9000)}`;
}

module.exports = { genReference };
