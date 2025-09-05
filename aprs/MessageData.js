/**
 * MessageData class - represents APRS message data
 * Ported from C# aprsparser MessageData.cs
 */

const MessageType = {
    Unknown: 'Unknown',
    Message: 'Message',
    Ack: 'Ack',
    Reject: 'Reject'
};

class MessageData {
    constructor() {
        this.addressee = '';
        this.msgType = MessageType.Unknown;
        this.seqId = '';
        this.msgText = '';
    }

    clear() {
        this.addressee = '';
        this.msgType = MessageType.Unknown;
        this.seqId = '';
        this.msgText = '';
    }
}

module.exports = {
    MessageData,
    MessageType
};
