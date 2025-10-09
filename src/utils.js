/**
 * Reads a 4-byte unsigned integer (big-endian) from a Buffer or byte array at the given offset.
 * @param {Buffer|Uint8Array|Array} bytes - The buffer or array to read from.
 * @param {number} offset - The offset to start reading.
 * @returns {number} The 4-byte unsigned integer.
 */
const getInt = (bytes, offset = 0) => {
  if (!bytes || typeof bytes.length !== 'number' || offset + 3 >= bytes.length) return 0;
  return (bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3];
};
/**
 * A collection of common utility functions.
 * @file utils.js
 * @description This file has been updated to use the CommonJS module system for compatibility with Node.js.
 */

/**
 * Capitalizes the first letter of a string.
 * @param {string} str - The input string.
 * @returns {string} The string with the first letter capitalized.
 */
const capitalize = (str) => {
  if (typeof str !== 'string' || str.length === 0) {
    return '';
  }
  return str.charAt(0).toUpperCase() + str.slice(1);
};

/**
 * Generates a random integer between a minimum and maximum value (inclusive).
 * @param {number} min - The minimum value.
 * @param {number} max - The maximum value.
 * @returns {number} A random integer.
 */
const getRandomInt = (min, max) => {
  if (typeof min !== 'number' || typeof max !== 'number' || min > max) {
    throw new Error('Invalid input: min and max must be numbers, and min must be less than or equal to max.');
  }
  min = Math.ceil(min);
  max = Math.floor(max);
  return Math.floor(Math.random() * (max - min + 1)) + min;
};

/**
 * Formats a number with commas as thousands separators.
 * @param {number} num - The number to format.
 * @returns {string} The formatted number string.
 */
const formatNumberWithCommas = (num) => {
  if (typeof num !== 'number') {
    return '';
  }
  return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
};

/**
 * Debounces a function call, so it only runs after a certain delay.
 * @param {function} func - The function to debounce.
 * @param {number} delay - The delay in milliseconds.
 * @returns {function} The debounced function.
 */
const debounce = (func, delay) => {
  let timeoutId;
  return (...args) => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => {
      func.apply(this, args);
    }, delay);
  };
};

/**
 * Converts an integer to a Buffer of specified length (big-endian).
 * @param {number} value - The integer value to convert.
 * @param {number} length - The number of bytes for the buffer.
 * @returns {Buffer} The buffer containing the bytes.
 */
const intToBytes = (value, length) => {
  const buf = Buffer.alloc(length);
  for (let i = 0; i < length; i++) {
    buf[length - 1 - i] = (value >> (8 * i)) & 0xFF;
  }
  return buf;
};

/**
 * Converts a Buffer or byte array to a hexadecimal string.
 * @param {Buffer|Uint8Array|Array} bytes - The bytes to convert.
 * @returns {string} Hexadecimal string representation.
 */

const bytesToHex = (bytes) => {
  if (!bytes || typeof bytes !== 'object' || typeof bytes.length !== 'number') return '';
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
};

/**
 * Reads a 2-byte unsigned integer (big-endian) from a Buffer or byte array at the given offset.
 * @param {Buffer|Uint8Array|Array} bytes - The buffer or array to read from.
 * @param {number} offset - The offset to start reading.
 * @returns {number} The 2-byte unsigned integer.
 */
const getShort = (bytes, offset = 0) => {
  if (!bytes || typeof bytes.length !== 'number' || offset + 1 >= bytes.length) return 0;
  return (bytes[offset] << 8) | bytes[offset + 1];
};

/**
 * Exports the utility functions for use in other CommonJS modules.
 */
module.exports = {
  capitalize,
  getRandomInt,
  formatNumberWithCommas,
  debounce,
  intToBytes,
  bytesToHex,
  getShort,
  getInt,
};
