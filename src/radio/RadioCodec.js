// RadioCodec.js
// Contains all encoding and decoding logic for radio commands and payloads

const { getShort, getInt } = require('../utils');

module.exports = {
    decodeHtStatus(msg) {
        if (!msg || typeof msg.length !== 'number' || msg.length < 7) return {};
        const b5 = msg[5], b6 = msg[6];
        let rssi = null, curr_region = null, curr_channel_id_upper = null;
        if (msg.length >= 9) {
            rssi = (msg[7] >> 4);
            curr_region = ((msg[7] & 0x0F) << 2) + (msg[8] >> 6);
            curr_channel_id_upper = ((msg[8] & 0x3C) >> 2);
        } else {
            rssi = 0;
            curr_region = 0;
            curr_channel_id_upper = 0;
        }
        const curr_ch_id_lower = (b6 >> 4);
        const curr_ch_id = (curr_channel_id_upper << 4) + curr_ch_id_lower;
        return {
            raw: Array.from(msg),
            is_power_on: (b5 & 0x80) !== 0,
            is_in_tx: (b5 & 0x40) !== 0,
            is_sq: (b5 & 0x20) !== 0,
            is_in_rx: (b5 & 0x10) !== 0,
            double_channel: (b5 & 0x0C) >> 2,
            is_scan: (b5 & 0x02) !== 0,
            is_radio: (b5 & 0x01) !== 0,
            curr_ch_id_lower,
            is_gps_locked: (b6 & 0x08) !== 0,
            is_hfp_connected: (b6 & 0x04) !== 0,
            is_aoc_connected: (b6 & 0x02) !== 0,
            channel_id: curr_ch_id,
            curr_ch_id,
            rssi,
            curr_region,
            curr_channel_id_upper,
        };
    },
    decodeBssSettings(msg) {
        if (!msg || typeof msg.length !== 'number' || msg.length < 51) return {};
        const decodeAscii = (arr, start, len) => String.fromCharCode(...arr.slice(start, start + len)).replace(/\0+$/, '');
        return {
            MaxFwdTimes: (msg[5] & 0xF0) >> 4,
            TimeToLive: msg[5] & 0x0F,
            PttReleaseSendLocation: (msg[6] & 0x80) !== 0,
            PttReleaseSendIdInfo: (msg[6] & 0x40) !== 0,
            PttReleaseSendBssUserId: (msg[6] & 0x20) !== 0,
            ShouldShareLocation: (msg[6] & 0x10) !== 0,
            SendPwrVoltage: (msg[6] & 0x08) !== 0,
            PacketFormat: (msg[6] & 0x04) >> 2,
            AllowPositionCheck: (msg[6] & 0x02) !== 0,
            AprsSsid: (msg[7] & 0xF0) >> 4,
            LocationShareInterval: msg[8] * 10,
            BssUserIdLower: (msg[9]) | (msg[10] << 8) | (msg[11] << 16) | (msg[12] << 24),
            PttReleaseIdInfo: decodeAscii(msg, 13, 12),
            BeaconMessage: decodeAscii(msg, 25, 18),
            AprsSymbol: decodeAscii(msg, 43, 2),
            AprsCallsign: decodeAscii(msg, 45, 6),
        };
    },
    decodeDevInfo(msg) {
        if (!msg || typeof msg.length !== 'number' || msg.length < 15) return {};
        return {
            raw: Array.from(msg),
            vendor_id: msg[5],
            product_id: getShort(msg, 6),
            hw_ver: msg[8],
            soft_ver: getShort(msg, 9),
            support_radio: ((msg[11] & 0x80) !== 0),
            support_medium_power: ((msg[11] & 0x40) !== 0),
            fixed_loc_speaker_vol: ((msg[11] & 0x20) !== 0),
            not_support_soft_power_ctrl: ((msg[11] & 0x10) !== 0),
            have_no_speaker: ((msg[11] & 0x08) !== 0),
            have_hm_speaker: ((msg[11] & 0x04) !== 0),
            region_count: ((msg[11] & 0x03) << 4) + ((msg[12] & 0xF0) >> 4),
            support_noaa: ((msg[12] & 0x08) !== 0),
            gmrs: ((msg[12] & 0x04) !== 0),
            support_vfo: ((msg[12] & 0x02) !== 0),
            support_dmr: ((msg[12] & 0x01) !== 0),
            channel_count: msg[13],
            freq_range_count: (msg[14] & 0xF0) >> 4,
        };
    },
    decodeChannelInfo(msg) {
        if (!msg || typeof msg.length !== 'number' || msg.length < 30) return {};
        const decodeAscii = (arr, start, len) => String.fromCharCode(...arr.slice(start, start + len)).replace(/\0+$/, '');
        return {
            raw: Array.from(msg),
            channel_id: msg[5],
            tx_mod: (msg[6] >> 6),
            tx_freq: getInt(msg, 6) & 0x3FFFFFFF,
            rx_mod: (msg[10] >> 6),
            rx_freq: getInt(msg, 10) & 0x3FFFFFFF,
            tx_sub_audio: getShort(msg, 14),
            rx_sub_audio: getShort(msg, 16),
            scan: (msg[18] & 0x80) !== 0,
            tx_at_max_power: (msg[18] & 0x40) !== 0,
            talk_around: (msg[18] & 0x20) !== 0,
            bandwidth: ((msg[18] & 0x10) !== 0) ? 1 : 0,
            pre_de_emph_bypass: (msg[18] & 0x08) !== 0,
            sign: (msg[18] & 0x04) !== 0,
            tx_at_med_power: (msg[18] & 0x02) !== 0,
            tx_disable: (msg[18] & 0x01) !== 0,
            fixed_freq: (msg[19] & 0x80) !== 0,
            fixed_bandwidth: (msg[19] & 0x40) !== 0,
            fixed_tx_power: (msg[19] & 0x20) !== 0,
            mute: (msg[19] & 0x10) !== 0,
            name_str: decodeAscii(msg, 20, 10),
        };
    },
    decodeRadioSettings(msg) {
        if (!msg || typeof msg.length !== 'number' || msg.length < 22) return {};
        return {
            rawData: Array.from(msg),
            channel_a: ((msg[5] & 0xF0) >> 4) + (msg[14] & 0xF0),
            channel_b: (msg[5] & 0x0F) + ((msg[14] & 0x0F) << 4),
            scan: (msg[6] & 0x80) !== 0,
            aghfp_call_mode: (msg[6] & 0x40) !== 0,
            double_channel: (msg[6] & 0x30) >> 4,
            squelch_level: (msg[6] & 0x0F),
            tail_elim: (msg[7] & 0x80) !== 0,
            auto_relay_en: (msg[7] & 0x40) !== 0,
            auto_power_on: (msg[7] & 0x20) !== 0,
            keep_aghfp_link: (msg[7] & 0x10) !== 0,
            mic_gain: (msg[7] & 0x0E) >> 1,
            tx_hold_time: ((msg[7] & 0x01) << 4) + ((msg[8] & 0xE0) >> 4),
            tx_time_limit: (msg[8] & 0x1F),
            local_speaker: msg[9] >> 6,
            bt_mic_gain: (msg[9] & 0x38) >> 3,
            adaptive_response: (msg[9] & 0x04) !== 0,
            dis_tone: (msg[9] & 0x02) !== 0,
            power_saving_mode: (msg[9] & 0x01) !== 0,
            auto_power_off: msg[10] >> 4,
            auto_share_loc_ch: (msg[10] & 0x1F),
            hm_speaker: msg[11] >> 6,
            positioning_system: (msg[11] & 0x3C) >> 2,
            time_offset: ((msg[11] & 0x03) << 4) + ((msg[12] & 0xF0) >> 4),
            use_freq_range_2: (msg[12] & 0x08) !== 0,
            ptt_lock: (msg[12] & 0x04) !== 0,
            leading_sync_bit_en: (msg[12] & 0x02) !== 0,
            pairing_at_power_on: (msg[12] & 0x01) !== 0,
            screen_timeout: msg[13] >> 3,
            vfo_x: (msg[13] & 0x06) >> 1,
            imperial_unit: (msg[13] & 0x01) !== 0,
            wx_mode: msg[15] >> 6,
            noaa_ch: (msg[15] & 0x3C) >> 2,
            vfol_tx_power_x: (msg[15] & 0x03),
            vfo2_tx_power_x: (msg[16] >> 6),
            dis_digital_mute: (msg[16] & 0x20) !== 0,
            signaling_ecc_en: (msg[16] & 0x10) !== 0,
            ch_data_lock: (msg[16] & 0x08) !== 0,
            vfo1_mod_freq_x: getInt(msg, 17),
            vfo2_mod_freq_x: getInt(msg, 21),
        };
    }
};
