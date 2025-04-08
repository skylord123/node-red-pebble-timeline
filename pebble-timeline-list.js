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
                    const timelineToken = tokenOverride || configNode.credentials.timelineToken;

                    // Get pins for this token only
                    let pins = [];
                    if (pinsData[timelineToken]) {
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

                    // Clean up old pins (older than 1 month) from all tokens
                    cleanupOldPins(pinsData);

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

        // Helper to clean up pins older than 1 month
        function cleanupOldPins(pinsData) {
            const oneMonthAgo = new Date();
            oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);
            let changed = false;

            // Iterate through all tokens
            Object.keys(pinsData).forEach(token => {
                // Filter out pins older than 1 month
                const initialCount = pinsData[token].length;
                pinsData[token] = pinsData[token].filter(pin => {
                    const storedDate = new Date(pin._stored);
                    return storedDate >= oneMonthAgo;
                });

                // Log if pins were removed
                if (pinsData[token].length < initialCount) {
                    node.debug(`Removed ${initialCount - pinsData[token].length} old pins for token ${token.substring(0, 8)}...`);
                    changed = true;
                }
            });

            // Save the updated pins data if any pins were removed
            if (changed) {
                try {
                    fs.writeFileSync(pinsFile, JSON.stringify(pinsData, null, 2));
                } catch (error) {
                    node.warn(`Error saving pins to file: ${error.message}`);
                }
            }
        }

        node.on('close', function() {
            // Clean up any resources
        });
    }

    RED.nodes.registerType("pebble-timeline-list", PebbleTimelineListNode, {
        credentials: {}
    });
};
