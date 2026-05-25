const store = require('./pebble-timeline-store');

module.exports = function(RED) {
    function PebbleTimelineListNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        const configNode = RED.nodes.getNode(config.config);
        if (!configNode) {
            node.error("No Pebble Timeline configuration found");
            return;
        }

        store.init(RED.settings.userDir);

        node.on('input', function(msg, send, done) {
            send = send || function() { node.send.apply(node, arguments) };

            let startTime = null;
            let endTime = null;
            let apiUrlOverride = null;
            let tokenOverride = null;

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
                    const key = store.resolveKey(configNode, tokenOverride);
                    const pins = store.getPins(key);

                    const filteredPins = pins.filter(pin => {
                        if (startTime !== null && new Date(pin.time) < startTime) return false;
                        if (endTime !== null && new Date(pin.time) > endTime) return false;
                        return true;
                    });

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
        });
    }

    RED.nodes.registerType("pebble-timeline-list", PebbleTimelineListNode, {
        credentials: {}
    });
};
