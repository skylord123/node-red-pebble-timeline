const axios = require('axios');
const fs = require('fs-extra');
const path = require('path');

/**
 * Node-RED node for adding pins to the Pebble Timeline API
 *
 * This node supports the Rebble Timeline API for creating pins
 * with all the features described in the Pebble/Rebble documentation.
 *
 * Required pin fields:
 * - id: String (max 64 chars) - Unique identifier for the pin
 * - time: String (ISO date-time) - Start time of the event
 * - layout: Object - Description of the pin's visual appearance
 *   - type: String - The type of layout to use
 *   - title: String - The title of the pin
 *   - tinyIcon: String - URI of the pin's tiny icon
 */
module.exports = function(RED) {
    function PebbleTimelineAddNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        // Get the config node
        const configNode = RED.nodes.getNode(config.config);
        if (!configNode) {
            node.error("No Pebble Timeline configuration found");
            return;
        }

        // Make sure storage directory exists
        const storageDir = path.join(RED.settings.userDir, 'pebble-timeline');
        fs.ensureDirSync(storageDir);
        const pinsFile = path.join(storageDir, 'timeline-pins.json');

        // Load existing pins (organized by token)
        let pinsData = {};
        try {
            if (fs.existsSync(pinsFile)) {
                pinsData = JSON.parse(fs.readFileSync(pinsFile, 'utf8'));
            }
        } catch (error) {
            node.warn(`Error loading pins file: ${error.message}`);
        }

        node.on('input', async function(msg, send, done) {
            // Backwards compatibility with Node-RED 0.x
            send = send || function() { node.send.apply(node, arguments) };

            try {
                // Set initial status
                node.status({fill: "blue", shape: "dot", text: "Processing..."});

                // Create the base pin object from the incoming message
                const pin = {};

                // Add basic required properties from input message if available
                if (msg.payload) {
                    if (typeof msg.payload === 'object') {
                        // Copy relevant properties from payload
                        if (msg.payload.id) pin.id = String(msg.payload.id); // Convert id to string
                        if (msg.payload.time) pin.time = msg.payload.time;
                        if (msg.payload.duration) pin.duration = msg.payload.duration;

                        // Start building the layout
                        if (!pin.layout) pin.layout = {};
                        if (!pin.layout.type) pin.layout.type = "genericPin";

                        // Add layout properties if present in payload
                        if (msg.payload.title) pin.layout.title = msg.payload.title;
                        if (msg.payload.body) pin.layout.body = msg.payload.body;
                        if (msg.payload.subtitle) pin.layout.subtitle = msg.payload.subtitle;
                        if (msg.payload.tinyIcon) pin.layout.tinyIcon = msg.payload.tinyIcon;
                    } else {
                        // If payload is not an object, use it as the body text
                        if (!pin.layout) pin.layout = {};
                        pin.layout.body = String(msg.payload);
                    }
                }

                // Use topic as title if available and not already set
                if (msg.topic && !pin.layout?.title) {
                    if (!pin.layout) pin.layout = {};
                    pin.layout.title = msg.topic;
                }

                // Now override with node configuration if provided
                await applyNodeConfiguration(pin, config, msg, node);

                // Ensure required fields are present
                if (!pin.id) {
                    // Generate a random ID if none provided - IMPORTANT: as a string
                    // ID must be max 64 chars according to the API docs
                    pin.id = `node-red-pin-${Date.now()}`;
                } else {
                    // Ensure ID is a string and max 64 chars
                    pin.id = String(pin.id).substring(0, 64);
                }

                if (!pin.time) {
                    // Use current time if none provided
                    pin.time = new Date().toISOString();
                }

                // Ensure layout exists
                if (!pin.layout) {
                    pin.layout = { type: "genericPin" };
                }

                // Ensure layout has type
                if (!pin.layout.type) {
                    pin.layout.type = "genericPin";
                }

                // Ensure layout has required fields based on type
                if (!pin.layout.title) {
                    pin.layout.title = msg.topic || "Node-RED Pin";
                }

                // Default tinyIcon if not set
                if (!pin.layout.tinyIcon) {
                    // Set default icons based on layout type
                    switch (pin.layout.type) {
                        case "genericPin":
                            pin.layout.tinyIcon = "system://images/NOTIFICATION_FLAG";
                            break;
                        case "calendarPin":
                            pin.layout.tinyIcon = "system://images/TIMELINE_CALENDAR";
                            break;
                        case "sportsPin":
                            pin.layout.tinyIcon = "system://images/TIMELINE_SPORTS";
                            break;
                        case "weatherPin":
                            pin.layout.tinyIcon = "system://images/TIMELINE_WEATHER";
                            break;
                        default:
                            pin.layout.tinyIcon = "system://images/NOTIFICATION_FLAG";
                    }
                }

                // Ensure layout-specific required fields are present
                switch (pin.layout.type) {
                    case "weatherPin":
                        // weatherPin requires locationName
                        if (!pin.layout.locationName) {
                            pin.layout.locationName = "Unknown Location";
                        }
                        break;
                    case "sportsPin":
                        // Ensure sports pin has required fields
                        if (!pin.layout.sportsGameState) {
                            // Default to pre-game if not specified
                            pin.layout.sportsGameState = "pre-game";
                        }
                        break;
                }

                // Validate body text length (max 512 characters according to docs)
                if (pin.layout.body && pin.layout.body.length > 512) {
                    pin.layout.body = pin.layout.body.substring(0, 512);
                    node.warn("Body text truncated to 512 characters");
                }

                // Validate headings and paragraphs
                if (pin.layout.headings && pin.layout.paragraphs) {
                    // Ensure paragraphs equals the number of headings
                    if (pin.layout.headings.length !== pin.layout.paragraphs.length) {
                        node.warn("Number of paragraphs must equal number of headings - adjusting");

                        // Adjust to make them equal
                        if (pin.layout.headings.length > pin.layout.paragraphs.length) {
                            // Add empty paragraphs
                            while (pin.layout.headings.length > pin.layout.paragraphs.length) {
                                pin.layout.paragraphs.push("");
                            }
                        } else {
                            // Trim paragraphs
                            pin.layout.paragraphs = pin.layout.paragraphs.slice(0, pin.layout.headings.length);
                        }
                    }

                    // Check total length of headings (max 128 chars)
                    let headingsLength = pin.layout.headings.join('').length + pin.layout.headings.length - 1;
                    if (headingsLength > 128) {
                        node.warn("Headings total length exceeds 128 characters - truncating");
                        // Truncate headings to fit
                        let newHeadings = [];
                        let totalLength = 0;
                        for (let i = 0; i < pin.layout.headings.length; i++) {
                            let heading = pin.layout.headings[i];
                            if (totalLength + heading.length + 1 > 128) {
                                // Truncate this heading
                                let remaining = 128 - totalLength - 1;
                                if (remaining > 0) {
                                    newHeadings.push(heading.substring(0, remaining) + "...");
                                }
                                break;
                            }
                            newHeadings.push(heading);
                            totalLength += heading.length + 1;
                        }
                        pin.layout.headings = newHeadings;
                        // Also adjust paragraphs to match
                        pin.layout.paragraphs = pin.layout.paragraphs.slice(0, pin.layout.headings.length);
                    }

                    // Check total length of paragraphs (max 1024 chars)
                    let paragraphsLength = pin.layout.paragraphs.join('').length + pin.layout.paragraphs.length - 1;
                    if (paragraphsLength > 1024) {
                        node.warn("Paragraphs total length exceeds 1024 characters - truncating");
                        // Truncate paragraphs to fit
                        let newParagraphs = [];
                        let totalLength = 0;
                        for (let i = 0; i < pin.layout.paragraphs.length; i++) {
                            let paragraph = pin.layout.paragraphs[i];
                            if (totalLength + paragraph.length + 1 > 1024) {
                                // Truncate this paragraph
                                let remaining = 1024 - totalLength - 1;
                                if (remaining > 0) {
                                    newParagraphs.push(paragraph.substring(0, remaining) + "...");
                                }
                                break;
                            }
                            newParagraphs.push(paragraph);
                            totalLength += paragraph.length + 1;
                        }
                        pin.layout.paragraphs = newParagraphs;
                        // Also adjust headings to match
                        pin.layout.headings = pin.layout.headings.slice(0, pin.layout.paragraphs.length);
                    }
                }

                // Validate reminders (max 3 according to docs)
                if (pin.reminders && pin.reminders.length > 3) {
                    pin.reminders = pin.reminders.slice(0, 3);
                    node.warn("Number of reminders truncated to maximum of 3");
                }

                // Check for server override options
                let apiUrlOverride = null;
                let tokenOverride = null;

                // Process API URL override
                if (config.apiUrl && config.apiUrl !== "null") {
                    try {
                        apiUrlOverride = await evaluateSingleProperty(config.apiUrl, config.apiUrlType, node, msg);
                    } catch (err) {
                        node.warn(`Error evaluating API URL override: ${err.message}`);
                    }
                }

                // Process token override
                if (config.token && config.token !== "null") {
                    try {
                        tokenOverride = await evaluateSingleProperty(config.token, config.tokenType, node, msg);
                    } catch (err) {
                        node.warn(`Error evaluating token override: ${err.message}`);
                    }
                }

                // Use overrides if provided, otherwise use config node values
                const apiUrl = `${apiUrlOverride || configNode.apiUrl}/v1/user/pins/${pin.id}`;
                const timelineToken = tokenOverride || configNode.credentials.timelineToken;

                if (!timelineToken) {
                    const errMsg = "Timeline token is required";
                    node.status({fill: "red", shape: "dot", text: "Missing token"});
                    // Only use done callback for errors, don't include error in message
                    if (done) done(errMsg);
                    return;
                }

                // Debug: Log final pin data
                node.debug(`Sending pin: ${JSON.stringify(pin, null, 2)}`);
                node.debug(`API URL: ${apiUrl}`);

                // Final validation of the pin object
                validatePin(pin, node);

                axios.put(apiUrl, pin, {
                    headers: {
                        'Content-Type': 'application/json',
                        'X-User-Token': timelineToken
                    }
                })
                    .then(response => {
                        // Set successful status - using "OK" as requested
                        node.status({fill: "green", shape: "dot", text: "OK"});

                        // Store the pin in our local storage
                        storePin(pin, timelineToken);

                        // Prepare the output message
                        msg.payload = {
                            success: true,
                            pin: pin,
                            response: response.data
                        };

                        send(msg);
                        if (done) done();
                    })
                    .catch(error => {
                        // Set error status
                        node.status({fill: "red", shape: "dot", text: "Error: " + (error.response ? error.response.status : error.message)});

                        // Debug: Log detailed error information
                        if (error.response) {
                            node.debug(`Error response: ${JSON.stringify(error.response.data)}`);
                        }

                        // Prepare error output without throwing an error to done callback
                        msg.payload = {
                            success: false,
                            error: error.message,
                            response: error.response ? error.response.data : null
                        };

                        send(msg);
                        // Don't use done callback for errors from API, as we're handling them in the output
                        if (done) done();
                    });
            } catch (err) {
                // For unexpected errors, use both the done callback and send the error
                node.status({fill: "red", shape: "dot", text: "Error: " + err.message});

                msg.payload = {
                    success: false,
                    error: err.message
                };

                // Send the error in the message but DON'T pass it to done
                send(msg);
                if (done) done();
            }
        });

        // Helper to store a pin in local storage
        function storePin(pin, timelineToken) {
            // Ensure we have a valid token
            if (!timelineToken) {
                node.warn("Cannot store pin: No valid timeline token provided");
                return;
            }

            // Convert token to string to ensure it can be used as an object key
            timelineToken = String(timelineToken);

            // Initialize the token's pins array if it doesn't exist
            if (!pinsData[timelineToken]) {
                pinsData[timelineToken] = [];
            }

            // Remove any existing pin with the same ID for this token
            pinsData[timelineToken] = pinsData[timelineToken].filter(p => p.id !== pin.id);

            // Add the new pin with a timestamp for when it was added
            pinsData[timelineToken].push({
                ...pin,
                _stored: new Date().toISOString()
            });

            // Clean up old pins (older than 1 month) from all tokens
            cleanupOldPins();

            // Write the pins to the file
            try {
                fs.writeFileSync(pinsFile, JSON.stringify(pinsData, null, 2));
            } catch (error) {
                node.warn(`Error saving pins to file: ${error.message}`);
            }
        }

        // Helper to clean up pins older than 1 month
        function cleanupOldPins() {
            const oneMonthAgo = new Date();
            oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);
            let changed = false;

            // Iterate through all tokens
            Object.keys(pinsData).forEach(token => {
                // Make sure the token's data is an array
                if (!Array.isArray(pinsData[token])) {
                    pinsData[token] = [];
                    return;
                }

                // Filter out pins older than 1 month
                const initialCount = pinsData[token].length;
                pinsData[token] = pinsData[token].filter(pin => {
                    // Make sure pin has _stored property
                    if (!pin || !pin._stored) return false;

                    try {
                        const storedDate = new Date(pin._stored);
                        return storedDate >= oneMonthAgo;
                    } catch (e) {
                        // If date parsing fails, remove the pin
                        return false;
                    }
                });

                // Log if pins were removed
                if (pinsData[token].length < initialCount) {
                    node.debug(`Removed ${initialCount - pinsData[token].length} old pins for token ${token.substring(0, 8)}...`);
                    changed = true;
                }
            });

            // No need to save here as the calling function will save the file
            return changed;
        }

        // Apply node configuration to the pin
        async function applyNodeConfiguration(pin, config, msg, node) {
            try {
                // Basic pin properties from configuration
                const configId = await evaluateSingleProperty(config.pinId, config.pinIdType, node, msg);
                if (configId !== undefined && configId !== null) pin.id = String(configId); // Convert to string

                const configTime = await evaluateSingleProperty(config.time, config.timeType, node, msg);
                if (configTime !== undefined && configTime !== null) pin.time = configTime;

                const configDuration = await evaluateSingleProperty(config.duration, config.durationType, node, msg);
                if (configDuration !== undefined && configDuration !== null) pin.duration = Number(configDuration);

                // Ensure layout exists
                if (!pin.layout) pin.layout = {};

                // Set layout type from configuration
                pin.layout.type = config.layoutType;

                // Add layout properties from configuration
                const configTitle = await evaluateSingleProperty(config.title, config.titleType, node, msg);
                if (configTitle !== undefined && configTitle !== null) pin.layout.title = configTitle;

                const configSubtitle = await evaluateSingleProperty(config.subtitle, config.subtitleType, node, msg);
                if (configSubtitle !== undefined && configSubtitle !== null) pin.layout.subtitle = configSubtitle;

                const configBody = await evaluateSingleProperty(config.body, config.bodyType, node, msg);
                if (configBody !== undefined && configBody !== null) pin.layout.body = configBody;

                const configTinyIcon = await evaluateSingleProperty(config.tinyIcon, config.tinyIconType, node, msg);
                if (configTinyIcon !== undefined && configTinyIcon !== null) pin.layout.tinyIcon = configTinyIcon;

                const configSmallIcon = await evaluateSingleProperty(config.smallIcon, config.smallIconType, node, msg);
                if (configSmallIcon !== undefined && configSmallIcon !== null) pin.layout.smallIcon = configSmallIcon;

                const configLargeIcon = await evaluateSingleProperty(config.largeIcon, config.largeIconType, node, msg);
                if (configLargeIcon !== undefined && configLargeIcon !== null) pin.layout.largeIcon = configLargeIcon;

                // Colors
                const configPrimaryColor = await evaluateSingleProperty(config.primaryColor, config.primaryColorType, node, msg);
                if (configPrimaryColor !== undefined && configPrimaryColor !== null) pin.layout.primaryColor = configPrimaryColor;

                const configSecondaryColor = await evaluateSingleProperty(config.secondaryColor, config.secondaryColorType, node, msg);
                if (configSecondaryColor !== undefined && configSecondaryColor !== null) pin.layout.secondaryColor = configSecondaryColor;

                const configBackgroundColor = await evaluateSingleProperty(config.backgroundColor, config.backgroundColorType, node, msg);
                if (configBackgroundColor !== undefined && configBackgroundColor !== null) pin.layout.backgroundColor = configBackgroundColor;

                // Layout specific properties
                if (config.layoutType === 'calendarPin' || config.layoutType === 'weatherPin') {
                    const configLocationName = await evaluateSingleProperty(config.locationName, config.locationNameType, node, msg);
                    if (configLocationName !== undefined && configLocationName !== null) pin.layout.locationName = configLocationName;
                }

                if (config.layoutType === 'weatherPin') {
                    const configShortTitle = await evaluateSingleProperty(config.shortTitle, config.shortTitleType, node, msg);
                    if (configShortTitle !== undefined && configShortTitle !== null) pin.layout.shortTitle = configShortTitle;

                    const configShortSubtitle = await evaluateSingleProperty(config.shortSubtitle, config.shortSubtitleType, node, msg);
                    if (configShortSubtitle !== undefined && configShortSubtitle !== null) pin.layout.shortSubtitle = configShortSubtitle;

                    if (config.displayTime !== 'pin') {
                        pin.layout.displayTime = config.displayTime;
                    }
                }

                if (config.layoutType === 'sportsPin') {
                    const configRankAway = await evaluateSingleProperty(config.rankAway, config.rankAwayType, node, msg);
                    if (configRankAway !== undefined && configRankAway !== null) pin.layout.rankAway = String(configRankAway);

                    const configRankHome = await evaluateSingleProperty(config.rankHome, config.rankHomeType, node, msg);
                    if (configRankHome !== undefined && configRankHome !== null) pin.layout.rankHome = String(configRankHome);

                    const configNameAway = await evaluateSingleProperty(config.nameAway, config.nameAwayType, node, msg);
                    if (configNameAway !== undefined && configNameAway !== null) pin.layout.nameAway = String(configNameAway);

                    const configNameHome = await evaluateSingleProperty(config.nameHome, config.nameHomeType, node, msg);
                    if (configNameHome !== undefined && configNameHome !== null) pin.layout.nameHome = String(configNameHome);

                    const configRecordAway = await evaluateSingleProperty(config.recordAway, config.recordAwayType, node, msg);
                    if (configRecordAway !== undefined && configRecordAway !== null) pin.layout.recordAway = String(configRecordAway);

                    const configRecordHome = await evaluateSingleProperty(config.recordHome, config.recordHomeType, node, msg);
                    if (configRecordHome !== undefined && configRecordHome !== null) pin.layout.recordHome = String(configRecordHome);

                    const configScoreAway = await evaluateSingleProperty(config.scoreAway, config.scoreAwayType, node, msg);
                    if (configScoreAway !== undefined && configScoreAway !== null) pin.layout.scoreAway = String(configScoreAway);

                    const configScoreHome = await evaluateSingleProperty(config.scoreHome, config.scoreHomeType, node, msg);
                    if (configScoreHome !== undefined && configScoreHome !== null) pin.layout.scoreHome = String(configScoreHome);

                    pin.layout.sportsGameState = config.sportsGameState;
                }

                // Advanced options
                const configHeadings = await evaluateSingleProperty(config.headings, config.headingsType, node, msg);
                if (configHeadings !== undefined && configHeadings !== null && configHeadings !== "null") {
                    pin.layout.headings = Array.isArray(configHeadings) ? configHeadings : JSON.parse(configHeadings);
                }

                const configParagraphs = await evaluateSingleProperty(config.paragraphs, config.paragraphsType, node, msg);
                if (configParagraphs !== undefined && configParagraphs !== null && configParagraphs !== "null") {
                    pin.layout.paragraphs = Array.isArray(configParagraphs) ? configParagraphs : JSON.parse(configParagraphs);
                }

                const configLastUpdated = await evaluateSingleProperty(config.lastUpdated, config.lastUpdatedType, node, msg);
                if (configLastUpdated !== undefined && configLastUpdated !== null && configLastUpdated !== "null") {
                    pin.layout.lastUpdated = configLastUpdated;
                }

                // Handle create notification
                if (config.createNotification) {
                    const createNotification = {
                        layout: {
                            type: 'genericNotification'
                        }
                    };

                    const configCreateTitle = await evaluateSingleProperty(config.createNotificationTitle, config.createNotificationTitleType, node, msg);
                    if (configCreateTitle !== undefined && configCreateTitle !== null) createNotification.layout.title = configCreateTitle;

                    const configCreateBody = await evaluateSingleProperty(config.createNotificationBody, config.createNotificationBodyType, node, msg);
                    if (configCreateBody !== undefined && configCreateBody !== null) createNotification.layout.body = configCreateBody;

                    const configCreateIcon = await evaluateSingleProperty(config.createNotificationTinyIcon, config.createNotificationTinyIconType, node, msg);
                    if (configCreateIcon !== undefined && configCreateIcon !== null) {
                        createNotification.layout.tinyIcon = configCreateIcon;
                    } else {
                        // Default tinyIcon for notification
                        createNotification.layout.tinyIcon = "system://images/NOTIFICATION_FLAG";
                    }

                    // Set default title if not provided
                    if (!createNotification.layout.title) {
                        createNotification.layout.title = "New Event";
                    }

                    // Validate notification body length
                    if (createNotification.layout.body && createNotification.layout.body.length > 512) {
                        createNotification.layout.body = createNotification.layout.body.substring(0, 512);
                        node.warn("Notification body text truncated to 512 characters");
                    }

                    pin.createNotification = createNotification;
                }

                // Handle update notification
                if (config.updateNotification) {
                    const updateNotification = {
                        layout: {
                            type: 'genericNotification'
                        }
                    };

                    const configUpdateTitle = await evaluateSingleProperty(config.updateNotificationTitle, config.updateNotificationTitleType, node, msg);
                    if (configUpdateTitle !== undefined && configUpdateTitle !== null) updateNotification.layout.title = configUpdateTitle;

                    const configUpdateBody = await evaluateSingleProperty(config.updateNotificationBody, config.updateNotificationBodyType, node, msg);
                    if (configUpdateBody !== undefined && configUpdateBody !== null) updateNotification.layout.body = configUpdateBody;

                    const configUpdateIcon = await evaluateSingleProperty(config.updateNotificationTinyIcon, config.updateNotificationTinyIconType, node, msg);
                    if (configUpdateIcon !== undefined && configUpdateIcon !== null) {
                        updateNotification.layout.tinyIcon = configUpdateIcon;
                    } else {
                        // Default tinyIcon for notification
                        updateNotification.layout.tinyIcon = "system://images/NOTIFICATION_FLAG";
                    }

                    const configUpdateTime = await evaluateSingleProperty(config.updateNotificationTime, config.updateNotificationTimeType, node, msg);
                    if (configUpdateTime !== undefined && configUpdateTime !== null) updateNotification.time = configUpdateTime;

                    // Set default title if not provided
                    if (!updateNotification.layout.title) {
                        updateNotification.layout.title = "Event Updated";
                    }

                    // Validate notification body length
                    if (updateNotification.layout.body && updateNotification.layout.body.length > 512) {
                        updateNotification.layout.body = updateNotification.layout.body.substring(0, 512);
                        node.warn("Update notification body text truncated to 512 characters");
                    }

                    // Ensure update notification has a time field
                    if (!updateNotification.time) {
                        updateNotification.time = new Date().toISOString();
                    }

                    pin.updateNotification = updateNotification;
                }

                // Handle reminders
                if (config.reminders) {
                    let reminderData = await evaluateSingleProperty(config.reminderData, config.reminderDataType, node, msg);
                    if (reminderData !== undefined && reminderData !== null && reminderData !== "null") {
                        if (typeof reminderData === 'string') {
                            try {
                                reminderData = JSON.parse(reminderData);
                            } catch (e) {
                                node.warn(`Failed to parse reminders: ${e.message}`);
                            }
                        }

                        if (Array.isArray(reminderData)) {
                            // Limit to max 3 reminders as per API docs
                            if (reminderData.length > 3) {
                                reminderData = reminderData.slice(0, 3);
                                node.warn("Number of reminders limited to 3 as per API requirements");
                            }

                            // Validate and fix each reminder
                            const processedReminders = reminderData.map(reminder => {
                                // Ensure required fields
                                if (!reminder.time) {
                                    node.warn("Reminder missing required 'time' field - using current time");
                                    reminder.time = new Date().toISOString();
                                }

                                if (!reminder.layout) reminder.layout = {};
                                if (!reminder.layout.type) reminder.layout.type = 'genericReminder';
                                if (!reminder.layout.title) reminder.layout.title = 'Reminder';
                                if (!reminder.layout.tinyIcon) reminder.layout.tinyIcon = 'system://images/NOTIFICATION_REMINDER';
                                return reminder;
                            });

                            pin.reminders = processedReminders;
                        }
                    }
                }

                // Handle actions
                if (config.actions) {
                    let actionData = await evaluateSingleProperty(config.actionData, config.actionDataType, node, msg);
                    if (actionData !== undefined && actionData !== null && actionData !== "null") {
                        if (typeof actionData === 'string') {
                            try {
                                actionData = JSON.parse(actionData);
                            } catch (e) {
                                node.warn(`Failed to parse actions: ${e.message}`);
                            }
                        }

                        if (Array.isArray(actionData)) {
                            // Validate each action
                            const processedActions = actionData.map(action => {
                                // Ensure required fields
                                if (!action.title) {
                                    node.warn("Action missing required 'title' field - adding default");
                                    action.title = "Action";
                                }

                                if (!action.type) {
                                    node.warn("Action missing required 'type' field - defaulting to openWatchApp");
                                    action.type = "openWatchApp";

                                    // Add launchCode if it's openWatchApp type and missing
                                    if (!action.launchCode) {
                                        action.launchCode = 0;
                                    }
                                }

                                // Validate HTTP action
                                if (action.type === "http") {
                                    if (!action.url) {
                                        node.warn("HTTP action missing required 'url' field");
                                        action.url = "https://example.com";
                                    }

                                    // Set default method if not provided
                                    if (!action.method) {
                                        action.method = "POST";
                                    }

                                    // Validate method with body
                                    if ((action.bodyText || action.bodyJSON) &&
                                        (action.method === "GET" || action.method === "DELETE")) {
                                        node.warn(`HTTP ${action.method} method cannot have a body - removing body`);
                                        delete action.bodyText;
                                        delete action.bodyJSON;
                                    }

                                    // Ensure bodyText and bodyJSON are not both present
                                    if (action.bodyText && action.bodyJSON) {
                                        node.warn("HTTP action cannot have both bodyText and bodyJSON - removing bodyText");
                                        delete action.bodyText;
                                    }
                                }

                                return action;
                            });

                            pin.actions = processedActions;
                        }
                    }
                }
            } catch (err) {
                node.warn(`Error applying configuration: ${err.message}`);
            }
        }

        // Helper function to evaluate a single property and return a Promise
        function evaluateSingleProperty(value, type, node, msg) {
            return new Promise((resolve, reject) => {
                if (!value || value === "null" || !type) {
                    resolve(undefined);
                    return;
                }

                RED.util.evaluateNodeProperty(value, type, node, msg, (err, result) => {
                    if (err) {
                        reject(err);
                    } else {
                        resolve(result);
                    }
                });
            });
        }

        // Helper function to validate the final pin object
        function validatePin(pin, node) {
            // Check required fields
            if (!pin.id) {
                node.warn("Pin missing required 'id' field");
            } else if (pin.id.length > 64) {
                pin.id = pin.id.substring(0, 64);
                node.warn("Pin ID truncated to 64 characters");
            }

            if (!pin.time) {
                node.warn("Pin missing required 'time' field");
            }

            if (!pin.layout) {
                node.warn("Pin missing required 'layout' field");
            } else {
                if (!pin.layout.type) {
                    node.warn("Pin layout missing required 'type' field");
                }

                if (!pin.layout.title) {
                    node.warn("Pin layout missing required 'title' field");
                }

                if (!pin.layout.tinyIcon) {
                    node.warn("Pin layout missing required 'tinyIcon' field");
                }
            }
        }

        node.on('close', function() {
            // Clean up any resources
        });
    }

    RED.nodes.registerType("pebble-timeline-add", PebbleTimelineAddNode, {
        credentials: {}
    });
};