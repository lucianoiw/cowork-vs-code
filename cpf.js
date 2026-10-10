function checkDigit(digits) {
  let total = 0;
  for (let i = 0; i < digits.length; i++) {
    total += Number(digits[i]) * (digits.length + 1 - i);
  }
  return ((total * 10) % 11) % 10;
}

function isValidCpf(value) {
  if (typeof value !== 'string') return false;
  if (!/^(\d{11}|\d{3}\.\d{3}\.\d{3}-\d{2})$/.test(value)) return false;

  const digits = value.replace(/\D/g, '');
  if (/^(\d)\1{10}$/.test(digits)) return false;

  return (
    checkDigit(digits.slice(0, 9)) === Number(digits[9]) &&
    checkDigit(digits.slice(0, 10)) === Number(digits[10])
  );
}

module.exports = { isValidCpf };
