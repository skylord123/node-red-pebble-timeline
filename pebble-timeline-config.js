module.exports = function(RED) {
    function PebbleTimelineConfigNode(n) {
        RED.nodes.createNode(this, n);
        this.name = n.name;
        this.apiUrl = n.apiUrl;
    }
    
    RED.nodes.registerType("pebble-timeline-config", PebbleTimelineConfigNode, {
        credentials: {
            timelineToken: { type: "password" }
        }
    });
};
