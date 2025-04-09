const axios = require('axios');
const fs = require('fs-extra');
const path = require('path');

module.exports = function(RED) {
    function PebbleTimelineDeleteNode(config) {
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

        node.on('input', function(msg, send, done) {
            // Backwards compatibility with Node-RED 0.x
            send = send || function() { node.send.apply(node, arguments) };

            // Get the pin ID to delete
            let pinId;
            // Process parameters in sequence
            Promise.all([
                new Promise(resolve => {
                    RED.util.evaluateNodeProperty(config.pinId, config.pinIdType, node, msg, (err, result) => {
                        if (err) {
                            node.error(`Error evaluating pin ID: ${err.message}`, msg);
                            if (done) done(err);
                            return;
                        }

                        pinId = result;

                        if (!pinId) {
                            node.error("Pin ID is required", msg);
                            if (done) done("Pin ID is required");
                            return;
                        }
                        resolve();
                    });
                }),

                // Check for server override options
                new Promise(resolve => {
                    if (config.apiUrl) {
                        RED.util.evaluateNodeProperty(config.apiUrl, config.apiUrlType, node, msg, (err, result) => {
                            if (!err && result) {
                                node.apiUrlOverride = result;
                            }
                            resolve();
                        });
                    } else {
                        resolve();
                    }
                }),

                new Promise(resolve => {
                    if (config.token) {
                        RED.util.evaluateNodeProperty(config.token, config.tokenType, node, msg, (err, result) => {
                            if (!err && result) {
                                node.tokenOverride = result;
                            }
                            resolve();
                        });
                    } else {
                        resolve();
                    }
                })
            ]).then(() => {
                // Use overrides if provided, otherwise use config node values
                const apiUrl = `${node.apiUrlOverride || configNode.apiUrl}/v1/user/pins/${pinId}`;
                const timelineToken = node.tokenOverride || configNode.credentials.timelineToken;

                if (!timelineToken) {
                    node.error("Timeline token is required", msg);
                    if (done) done("Timeline token is required");
                    return;
                }

                axios.delete(apiUrl, {
                    headers: {
                        'X-User-Token': timelineToken
                    }
                })
                .then(response => {
                    node.status({fill: "green", shape: "dot", text: "Pin deleted"});

                    // Remove the pin from our local storage
                    removePin(pinId, timelineToken);

                    // Prepare the output message
                    msg.payload = {
                        success: true,
                        pinId: pinId,
                        response: response.data
                    };

                    send(msg);
                    if (done) done();
                })
                .catch(error => {
                    node.status({fill: "red", shape: "dot", text: "Error: " + (error.response ? error.response.status : error.message)});

                    msg.payload = {
                        success: false,
                        pinId: pinId,
                        error: error.message,
                        response: error.response ? error.response.data : null
                    };

                    send(msg);
                    if (done) done(error);
                });
            }).catch(err => {
                if (done) done(err);
            });
        });

        // Helper to remove a pin from local storage
        function removePin(pinId, timelineToken) {
            // Ensure we have a valid token
            if (!timelineToken) {
                node.warn("Cannot remove pin: No valid timeline token provided");
                return;
            }

            // Convert token to string to ensure it can be used as an object key
            timelineToken = String(timelineToken);

            // Check if this token has any pins
            if (!pinsData[timelineToken]) {
                return; // No pins for this token
            }

            // Remove the pin with the specified ID from this token's pins
            const initialCount = pinsData[timelineToken].length;
            pinsData[timelineToken] = pinsData[timelineToken].filter(p => p.id !== pinId);

            // Note: Cleanup of old pins is handled in the add node

            // Only write if we actually removed something
            if (pinsData[timelineToken].length !== initialCount) {
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

    RED.nodes.registerType("pebble-timeline-delete", PebbleTimelineDeleteNode, {
        credentials: {}
    });
};
