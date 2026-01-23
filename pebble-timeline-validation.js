/**
 * Local validation module for Pebble Timeline pins
 * Based on the validation logic from rebble-timeline-sync
 * https://github.com/pebble-dev/rebble-timeline-sync
 */

const ISO_FORMAT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const ISO_FORMAT_MSEC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/**
 * Parse ISO 8601 time string
 * @param {string} timeStr - ISO 8601 formatted time string
 * @returns {Date} Parsed date object
 */
function parseTime(timeStr) {
    if (!timeStr || typeof timeStr !== 'string') {
        throw new Error('Invalid time string');
    }
    
    if (!ISO_FORMAT.test(timeStr) && !ISO_FORMAT_MSEC.test(timeStr)) {
        throw new Error('Time must be in ISO 8601 format');
    }
    
    const date = new Date(timeStr);
    if (isNaN(date.getTime())) {
        throw new Error('Invalid date');
    }
    
    return date;
}

/**
 * Validate that a time is within acceptable range
 * Time must not be more than two days in the past, or a year in the future
 * @param {Date} time - Date object to validate
 * @returns {boolean} True if time is valid
 */
function timeValid(time) {
    const now = new Date();
    const twoDaysAgo = new Date(now.getTime() - (2 * 24 * 60 * 60 * 1000));
    const oneYearFromNow = new Date(now.getTime() + (366 * 24 * 60 * 60 * 1000));
    
    if (time < twoDaysAgo || time > oneYearFromNow) {
        return false;
    }
    
    return true;
}

/**
 * Validate a timeline pin
 * Based on pin_valid from rebble-timeline-sync/timeline_sync/utils.py
 * @param {string} pinId - The pin ID from the URL/request
 * @param {object} pinJson - The pin object to validate
 * @returns {object} Object with valid (boolean) and error (string) properties
 */
function pinValid(pinId, pinJson) {
    try {
        // Check that pin JSON exists
        if (!pinJson || typeof pinJson !== 'object') {
            return { valid: false, error: 'parse_failure_or_missing_pin' };
        }
        
        // Check that pin ID matches
        if (pinJson.id !== pinId) {
            return { valid: false, error: 'id_mismatch' };
        }
        
        // Validate main pin time
        if (!pinJson.time) {
            return { valid: false, error: 'missing_time' };
        }
        
        let pinTime;
        try {
            pinTime = parseTime(pinJson.time);
        } catch (e) {
            return { valid: false, error: 'invalid_time_format' };
        }
        
        if (!timeValid(pinTime)) {
            return { valid: false, error: 'invalid_time' };
        }
        
        // Validate createNotification - should NOT have a time attribute
        if (pinJson.createNotification && pinJson.createNotification.time) {
            return { valid: false, error: 'invalid_time_attribute' };
        }
        
        // Validate updateNotification time if present
        if (pinJson.updateNotification && pinJson.updateNotification.time) {
            let updateTime;
            try {
                updateTime = parseTime(pinJson.updateNotification.time);
            } catch (e) {
                return { valid: false, error: 'invalid_update_notification_time_format' };
            }
            
            if (!timeValid(updateTime)) {
                return { valid: false, error: 'invalid_time_for_update' };
            }
        }
        
        // Validate reminders
        if (pinJson.reminders) {
            if (!Array.isArray(pinJson.reminders)) {
                return { valid: false, error: 'reminders_not_array' };
            }
            
            if (pinJson.reminders.length > 3) {
                return { valid: false, error: 'too_many_reminders' };
            }
            
            for (let i = 0; i < pinJson.reminders.length; i++) {
                const reminder = pinJson.reminders[i];
                if (!reminder.time) {
                    return { valid: false, error: `reminder_${i}_missing_time` };
                }
                
                let reminderTime;
                try {
                    reminderTime = parseTime(reminder.time);
                } catch (e) {
                    return { valid: false, error: `reminder_${i}_invalid_time_format` };
                }
                
                if (!timeValid(reminderTime)) {
                    return { valid: false, error: 'invalid_reminder_time' };
                }
            }
        }
        
        return { valid: true };
        
    } catch (error) {
        return { valid: false, error: 'miscellaneous_failure: ' + error.message };
    }
}

module.exports = {
    pinValid,
    parseTime,
    timeValid
};

