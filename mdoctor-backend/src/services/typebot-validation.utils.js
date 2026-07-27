function compactWhitespace(value) {
  return String(value ?? '').trim().replace(/\s+/g, ' ');
}

function digitsOnly(value) {
  return String(value ?? '').replace(/\D/g, '');
}

module.exports = {
  compactWhitespace,
  digitsOnly
};
