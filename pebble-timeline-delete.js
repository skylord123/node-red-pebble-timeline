const axios = require('axios');
const store = require('./pebble-timeline-store');

module.exports = function(RED) {
    function PebbleTimelineDeleteNode(config) {
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

            let pinId;
            let apiUrlOverride = null;
            let tokenOverride = null;

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

                new Promise(resolve => {
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
                }),

                new Promise(resolve => {
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
                })
            ]).then(async () => {
                const baseApiUrl = apiUrlOverride || configNode.apiUrl;
                const timelineToken = tokenOverride || configNode.credentials.timelineToken;
                const storeKey = store.resolveKey(configNode, tokenOverride);

                const isLocalMode = !baseApiUrl || baseApiUrl.trim() === '';

                if (isLocalMode) {
                    node.debug(`Local emulation mode - deleting pin locally`);

                    try {
                        await store.removePin(storeKey, pinId);
                    } catch (e) {
                        node.warn(`Error removing pin from local storage: ${e.message}`);
                    }

                    node.status({fill: "green", shape: "dot", text: "Pin deleted (local)"});

                    msg.payload = {
                        success: true,
                        pinId: pinId,
                        mode: 'local',
                        message: 'Pin deleted from local storage'
                    };

                    send(msg);
                    if (done) done();
                } else {
                    const apiUrl = `${baseApiUrl}/v1/user/pins/${pinId}`;

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
                    .then(async response => {
                        node.status({fill: "green", shape: "dot", text: "Pin deleted"});

                        try {
                            await store.removePin(storeKey, pinId);
                        } catch (e) {
                            node.warn(`Error removing pin from local storage: ${e.message}`);
                        }

                        msg.payload = {
                            success: true,
                            pinId: pinId,
                            response: response.data
                        };

                        send(msg);
                        if (done) done();
                    })
                    .catch(async error => {
                        if (error.response && error.response.status === 404) {
                            node.warn(`Pin ${pinId} not found on server (404) - assuming already deleted`);
                            node.status({fill: "yellow", shape: "dot", text: "Pin already deleted"});

                            try {
                                await store.removePin(storeKey, pinId);
                            } catch (e) {
                                node.warn(`Error removing pin from local storage: ${e.message}`);
                            }

                            msg.payload = {
                                success: true,
                                pinId: pinId,
                                alreadyDeleted: true,
                                message: "Pin not found on server, removed from local storage"
                            };

                            send(msg);
                            if (done) done();
                        } else {
                            node.status({fill: "red", shape: "dot", text: "Error: " + (error.response ? error.response.status : error.message)});

                            msg.payload = {
                                success: false,
                                pinId: pinId,
                                error: error.message,
                                response: error.response ? error.response.data : null
                            };

                            send(msg);
                            if (done) done(error);
                        }
                    });
                }
            }).catch(err => {
                if (done) done(err);
            });
        });

        node.on('close', function() {
        });
    }

    RED.nodes.registerType("pebble-timeline-delete", PebbleTimelineDeleteNode, {
        credentials: {}
    });
};
