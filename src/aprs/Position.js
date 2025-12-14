/**
 * Position class - represents location data in APRS packets
 * Ported from C# aprsparser Position.cs
 */

const { CoordinateSet } = require('./CoordinateSet');
const AprsUtil = require('./AprsUtil');

class Position {
    constructor() {
        this.coordinateSet = new CoordinateSet();
        this.ambiguity = 0;
        this.course = 0;
        this.speed = 0;
        this.altitude = 0;
        this.gridsquare = '';
    }

    clear() {
        this.coordinateSet.clear();
        this.ambiguity = 0;
        this.course = 0;
        this.speed = 0;
        this.altitude = 0;
        this.gridsquare = '';
    }

    isValid() {
        return this.coordinateSet.isValid();
    }

    /**
     * Auto-compute grid square if position is valid and grid square is not set
     */
    computeGridSquare() {
        if (this.isValid() && !this.gridsquare) {
            this.gridsquare = AprsUtil.coordSetToGridSquare(this.coordinateSet);
        }
    }
}

module.exports = Position;
