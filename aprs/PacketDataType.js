/**
 * PacketDataType - APRS packet type definitions and decoder
 * Ported from C# aprsparser PacketDataType.cs
 */

const PacketDataType = {
    Unknown: 'Unknown',
    Beacon: 'Beacon',                    //
    MicECurrent: 'MicECurrent',         //#$1C Current Mic-E Data (Rev 0 beta)
    MicEOld: 'MicEOld',                 //#$1D Old Mic-E Data (Rev 0 beta)
    Position: 'Position',               //'!'  Position without timestamp (no APRS messaging), or Ultimeter 2000 WX Station
    PeetBrosUII1: 'PeetBrosUII1',       //'#'  Peet Bros U-II Weather Station
    RawGPSorU2K: 'RawGPSorU2K',         //'$'  Raw GPS data or Ultimeter 2000
    MicroFinder: 'MicroFinder',         //'%'  Agrelo DFJr / MicroFinder
    MapFeature: 'MapFeature',           //'&'  [Reserved - Map Feature]
    TMD700: 'TMD700',                   //'''' Old Mic-E Data (but current for TM-D700)
    Item: 'Item',                       //')'  Item
    PeetBrosUII2: 'PeetBrosUII2',       //'*'  Peet Bros U-II Weather Station
    ShelterData: 'ShelterData',         //'+'  [Reserved - Shelter data with time]
    InvalidOrTestData: 'InvalidOrTestData', //','  Invalid data or test data
    SpaceWeather: 'SpaceWeather',       //'.'  [Reserved - Space Weather]
    PositionTime: 'PositionTime',       //'/'  Position with timestamp (no APRS messaging)
    Message: 'Message',                 //':'  Message
    Object: 'Object',                   //';'  Object
    StationCapabilities: 'StationCapabilities', //'<'  Station Capabilities
    PositionMsg: 'PositionMsg',         //'='  Position without timestamp (with APRS messaging)
    Status: 'Status',                   //'>'  Status
    Query: 'Query',                     //'?'  Query
    PositionTimeMsg: 'PositionTimeMsg', //'@'  Position with timestamp (with APRS messaging)
    Telemetry: 'Telemetry',             //'T'  Telemetry data
    MaidenheadGridLoc: 'MaidenheadGridLoc', //'['  Maidenhead grid locator beacon (obsolete)
    WeatherReport: 'WeatherReport',     //'_'  Weather Report (without position)
    MicE: 'MicE',                       //'`'  Current Mic-E data
    UserDefined: 'UserDefined',         //'{'  User-Defined APRS packet format
    ThirdParty: 'ThirdParty'            //'}'  Third-party traffic
};

/**
 * Get packet data type from first character of information field
 * @param {string} ch - First character of APRS information field
 * @returns {string} PacketDataType enum value
 */
function getDataType(ch) {
    switch (ch) {
        case '\x00': return PacketDataType.Unknown;
        case ' ': return PacketDataType.Beacon;
        case '\x1C': return PacketDataType.MicECurrent;
        case '\x1D': return PacketDataType.MicEOld;
        case '!': return PacketDataType.Position;
        case '#': return PacketDataType.PeetBrosUII1;
        case '$': return PacketDataType.RawGPSorU2K;
        case '%': return PacketDataType.MicroFinder;
        case '&': return PacketDataType.MapFeature;
        case '\'': return PacketDataType.TMD700;
        case ')': return PacketDataType.Item;
        case '*': return PacketDataType.PeetBrosUII2;
        case '+': return PacketDataType.ShelterData;
        case ',': return PacketDataType.InvalidOrTestData;
        case '.': return PacketDataType.SpaceWeather;
        case '/': return PacketDataType.PositionTime;
        case ':': return PacketDataType.Message;
        case ';': return PacketDataType.Object;
        case '<': return PacketDataType.StationCapabilities;
        case '=': return PacketDataType.PositionMsg;
        case '>': return PacketDataType.Status;
        case '?': return PacketDataType.Query;
        case '@': return PacketDataType.PositionTimeMsg;
        case 'T': return PacketDataType.Telemetry;
        case '[': return PacketDataType.MaidenheadGridLoc;
        case '_': return PacketDataType.WeatherReport;
        case '`': return PacketDataType.MicE;
        case '{': return PacketDataType.UserDefined;
        case '}': return PacketDataType.ThirdParty;
        default: return PacketDataType.Unknown;
    }
}

module.exports = {
    PacketDataType,
    getDataType
};
