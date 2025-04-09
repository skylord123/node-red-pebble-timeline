const fs = require('fs-extra');
const path = require('path');

module.exports = function(RED) {
    function PebbleTimelineListNode(config) {
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

        node.on('input', function(msg, send, done) {
            // Backwards compatibility with Node-RED 0.x
            send = send || function() { node.send.apply(node, arguments) };

            let startTime = null;
            let endTime = null;
            let apiUrlOverride = null;
            let tokenOverride = null;

            // Process filter parameters in sequence
            Promise.resolve()
                .then(() => {
                    return new Promise((resolve) => {
                        if (config.apiUrl) {
                            RED.util.evaluateNodeProperty(config.apiUrl, config.apiUrlType, node, msg, (err, result) => {
                                if (!err && result) {
                                    apiUrlOverride = result;
                                }
                                resolve();
                            });
                        } else {
                            resolve();
                        }
                    });
                })
                .then(() => {
                    return new Promise((resolve) => {
                        if (config.token) {
                            RED.util.evaluateNodeProperty(config.token, config.tokenType, node, msg, (err, result) => {
                                if (!err && result) {
                                    tokenOverride = result;
                                }
                                resolve();
                            });
                        } else {
                            resolve();
                        }
                    });
                })
                .then(() => {
                    return new Promise((resolve) => {
                        if (config.startTime) {
                            RED.util.evaluateNodeProperty(config.startTime, config.startTimeType, node, msg, (err, result) => {
                                if (!err && result) {
                                    startTime = new Date(result);
                                    if (isNaN(startTime.getTime())) {
                                        node.warn("Invalid start time format");
                                        startTime = null;
                                    }
                                }
                                resolve();
                            });
                        } else {
                            resolve();
                        }
                    });
                })
                .then(() => {
                    return new Promise((resolve) => {
                        if (config.endTime) {
                            RED.util.evaluateNodeProperty(config.endTime, config.endTimeType, node, msg, (err, result) => {
                                if (!err && result) {
                                    endTime = new Date(result);
                                    if (isNaN(endTime.getTime())) {
                                        node.warn("Invalid end time format");
                                        endTime = null;
                                    }
                                }
                                resolve();
                            });
                        } else {
                            resolve();
                        }
                    });
                })
                .then(() => {
                    // Load the pins
                    let pinsData = {};
                    try {
                        if (fs.existsSync(pinsFile)) {
                            pinsData = JSON.parse(fs.readFileSync(pinsFile, 'utf8'));
                        }
                    } catch (error) {
                        node.warn(`Error loading pins file: ${error.message}`);
                    }

                    // Get the timeline token to use
                    let timelineToken = tokenOverride || configNode.credentials.timelineToken;

                    // Ensure we have a valid token
                    if (!timelineToken) {
                        node.warn("No valid timeline token provided");
                        timelineToken = "default"; // Use a default key to avoid errors
                    }

                    // Convert token to string to ensure it can be used as an object key
                    timelineToken = String(timelineToken);

                    // Get pins for this token only
                    let pins = [];
                    if (pinsData[timelineToken] && Array.isArray(pinsData[timelineToken])) {
                        pins = pinsData[timelineToken];
                    }

                    // Apply filters
                    const filteredPins = pins.filter(pin => {
                        let include = true;

                        if (startTime !== null) {
                            const pinTime = new Date(pin.time);
                            if (pinTime < startTime) {
                                include = false;
                            }
                        }

                        if (endTime !== null) {
                            const pinTime = new Date(pin.time);
                            if (pinTime > endTime) {
                                include = false;
                            }
                        }

                        return include;
                    });

                    // Note: Cleanup of old pins is handled in the add node

                    // Create output message
                    msg.payload = filteredPins;
                    msg.count = filteredPins.length;

                    node.status({fill: "green", shape: "dot", text: `${filteredPins.length} pins found`});

                    send(msg);
                    if (done) done();
                })
                .catch(error => {
                    node.error(`Error listing pins: ${error.message}`, msg);
                    if (done) done(error);
                });
        });

        node.on('close', function() {
            // Clean up any resources
        });
    }

    RED.nodes.registerType("pebble-timeline-list", PebbleTimelineListNode, {
        credentials: {}
    });
};
