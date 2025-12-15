/**
 * AprsUtil - Utility functions for APRS processing
 * Ported from C# aprsparser AprsUtil.cs
 */

/**
 * Generate APRS validation code for a callsign (for server login)
 * @param {string} callsign - Callsign to generate code for
 * @returns {string} Validation code
 */
function aprsValidationCode(callsign) {
    let hash = 0x73e2; // magic number
    let cs = callsign.toUpperCase().trim();
    
    // Get just the callsign, no SSID
    const parts = cs.split('-');
    cs = parts[0];
    const len = cs.length;
    
    // In case callsign is odd length, add null
    cs += '\0';
    
    // Perform the hash
    for (let i = 0; i < len; i += 2) {
        hash = (cs.charCodeAt(i) << 8) ^ hash;
        if (i + 1 < cs.length) {
            hash = cs.charCodeAt(i + 1) ^ hash;
        }
    }
    
    return (hash & 0x7fff).toString();
}

/**
 * Build string to send to an APRS server for login
 * @param {string} callsign - Callsign
 * @param {string} product - Software product name
 * @param {string} version - Software version
 * @returns {string} Login string
 */
function getServerLogonString(callsign, product, version) {
    return `user ${callsign} pass ${aprsValidationCode(callsign)} vers ${product} ${version}`;
}

/**
 * Convert latitude/longitude to Maidenhead grid square
 * @param {number} lat - Latitude in decimal degrees
 * @param {number} lon - Longitude in decimal degrees
 * @returns {string} 6-character grid square
 */
function latLonToGridSquare(lat, lon) {
    let locator = '';
    
    lat += 90;
    lon += 180;
    
    let v = Math.floor(lon / 20);
    lon -= v * 20;
    locator += String.fromCharCode(65 + v); // 'A' + v
    
    v = Math.floor(lat / 10);
    lat -= v * 10;
    locator += String.fromCharCode(65 + v); // 'A' + v
    
    locator += Math.floor(lon / 2).toString();
    locator += Math.floor(lat).toString();
    
    lon -= Math.floor(lon / 2) * 2;
    lat -= Math.floor(lat);
    
    locator += String.fromCharCode(65 + Math.floor(lon * 12)); // 'A' + (lon * 12)
    locator += String.fromCharCode(65 + Math.floor(lat * 24)); // 'A' + (lat * 24)
    
    return locator;
}

/**
 * Convert latitude/longitude from CoordinateSet to grid square
 * @param {CoordinateSet} coordinateSet - Coordinate set object
 * @returns {string} 6-character grid square
 */
function coordSetToGridSquare(coordinateSet) {
    return latLonToGridSquare(coordinateSet.latitude.value, coordinateSet.longitude.value);
}

/**
 * Convert grid square to latitude/longitude
 * @param {string} locator - 4 or 6 character grid square
 * @returns {CoordinateSet|null} Coordinate set or null if invalid
 */
function gridSquareToLatLon(locator) {
    const { CoordinateSet } = require('./CoordinateSet');
    
    locator = locator.toUpperCase();
    if (locator.length === 4) {
        locator += 'IL'; // somewhere near the center of the grid
    }
    
    if (!locator.match(/^[A-R]{2}[0-9]{2}[A-X]{2}$/)) {
        return null;
    }
    
    const coordinates = new CoordinateSet();
    coordinates.longitude.value = (locator.charCodeAt(0) - 65) * 20 + 
                                 (locator.charCodeAt(2) - 48) * 2 + 
                                 (locator.charCodeAt(4) - 65 + 0.5) / 12 - 180;
    coordinates.latitude.value = (locator.charCodeAt(1) - 65) * 10 + 
                                (locator.charCodeAt(3) - 48) + 
                                (locator.charCodeAt(5) - 65 + 0.5) / 24 - 90;
    
    return coordinates;
}

/**
 * Convert decimal degrees to NMEA format
 * @param {number} d - Decimal degrees
 * @param {string} direction - N/S/E/W
 * @param {boolean} isLat - True if latitude
 * @returns {string} NMEA format string
 */
function convertToNmea(d, direction, isLat) {
    // Break into degrees and minutes
    const l = Math.abs(d);
    const degrees = Math.floor(l);
    const minutes = (l - degrees) * 60;
    
    // Format degrees
    const sD = isLat ? degrees.toString().padStart(2, '0') : degrees.toString().padStart(3, '0');
    
    // Format minutes
    const sM = minutes.toFixed(2).padStart(5, '0');
    
    // Put it back together - NMEA format
    return sD + sM + direction;
}

/**
 * Convert latitude to NMEA format
 * @param {number} lat - Latitude in decimal degrees
 * @returns {string} NMEA format latitude
 */
function convertLatToNmea(lat) {
    const cd = lat < 0 ? 'S' : 'N';
    return convertToNmea(lat, cd, true);
}

/**
 * Convert longitude to NMEA format
 * @param {number} lon - Longitude in decimal degrees
 * @returns {string} NMEA format longitude
 */
function convertLonToNmea(lon) {
    const cd = lon < 0 ? 'W' : 'E';
    return convertToNmea(lon, cd, false);
}

/**
 * Convert NMEA/APRS format to decimal degrees
 * @param {string} nmea - NMEA/APRS format coordinate string
 * @returns {number} Decimal degrees
 */
function convertNmeaToFloat(nmea) {
    try {
        if (!nmea || nmea.length === 0) return 0;
        
        nmea = nmea.trim();
        const upper = nmea.toUpperCase();
        
        // Get direction from last character
        const lastChar = upper[upper.length - 1];
        const isNegative = (lastChar === 'S' || lastChar === 'W');
        
        // Remove direction character
        const coordStr = nmea.substring(0, nmea.length - 1);
        
        let degrees = 0;
        let minutes = 0;
        
        // Determine if this is latitude (DDMM.HH) or longitude (DDDMM.HH)
        // Latitude: 2 digit degrees (DD), longitude: 3 digit degrees (DDD)
        if (lastChar === 'N' || lastChar === 'S') {
            // Latitude: DDMM.HH format (e.g., "4523.45")
            degrees = parseFloat(coordStr.substring(0, 2));
            minutes = parseFloat(coordStr.substring(2));
        } else if (lastChar === 'E' || lastChar === 'W') {
            // Longitude: DDDMM.HH format (e.g., "12245.67")
            degrees = parseFloat(coordStr.substring(0, 3));
            minutes = parseFloat(coordStr.substring(3));
        } else {
            // Invalid format
            return 0;
        }
        
        // Convert to decimal degrees
        let result = degrees + (minutes / 60);
        
        // Apply direction
        if (isNegative) {
            result = -result;
        }
        
        return result;
    } catch (error) {
        return 0;
    }
}

module.exports = {
    aprsValidationCode,
    getServerLogonString,
    latLonToGridSquare,
    coordSetToGridSquare,
    gridSquareToLatLon,
    convertToNmea,
    convertLatToNmea,
    convertLonToNmea,
    convertNmeaToFloat
};
