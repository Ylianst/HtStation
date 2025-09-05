/**
 * Coordinate and CoordinateSet classes
 * Ported from C# aprsparser CoordinateSet.cs
 */

const AprsUtil = require('./AprsUtil');

/**
 * Represents a single coordinate (latitude or longitude)
 */
class Coordinate {
    constructor(value = 0, isLat = false, nmea = null) {
        if (nmea !== null) {
            // Parse from NMEA format
            this.nmea = nmea.trim();
            this.value = AprsUtil.convertNmeaToFloat(nmea);
        } else {
            // Set from decimal value
            this.value = value;
            this.nmea = isLat ? AprsUtil.convertLatToNmea(value) : AprsUtil.convertLonToNmea(value);
        }
    }

    clear() {
        this.value = 0;
        this.nmea = '';
    }
}

/**
 * Represents a coordinate pair (latitude and longitude)
 */
class CoordinateSet {
    constructor(lat = 0, lon = 0) {
        if (lat === 0 && lon === 0) {
            this.latitude = new Coordinate();
            this.longitude = new Coordinate();
        } else {
            this.latitude = new Coordinate(lat, true);
            this.longitude = new Coordinate(lon, false);
        }
    }

    clear() {
        this.latitude.clear();
        this.longitude.clear();
    }

    /**
     * Check if coordinates are valid (not 0,0)
     * @returns {boolean} True if valid coordinates
     */
    isValid() {
        return !(this.latitude.value === 0 && this.longitude.value === 0);
    }
}

module.exports = {
    Coordinate,
    CoordinateSet
};
